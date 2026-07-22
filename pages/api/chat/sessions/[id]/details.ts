import { NextApiRequest, NextApiResponse } from "next";
import pool from "@/lib/db";
import { getUserIdFromRequest } from "@/lib/auth";
import { getUserPermissions, isSuperAdmin, isTenantAdmin, isDeptAdmin } from "@/lib/permissions";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  // 认证检查
  const currentUserId = getUserIdFromRequest(req);
  if (!currentUserId) {
    return res.status(401).json({ error: "未登录" });
  }

  try {
    const { id } = req.query;

    if (!id) {
      return res.status(400).json({ error: "Session ID is required" });
    }

    // 获取当前用户权限信息
    const userPerms = await getUserPermissions(currentUserId);
    if (!userPerms) {
      return res.status(404).json({ error: "用户不存在" });
    }

    // 检查用户角色
    const superAdmin = await isSuperAdmin(currentUserId);
    const tenantAdmin = await isTenantAdmin(currentUserId);
    const deptAdmin = await isDeptAdmin(currentUserId);

    // 获取会话基本信息，同时获取知识库信息
    // owner_tenant_id / owner_dept_id 仅用于鉴权，不出现在响应体里
    const sessionQuery = `
      SELECT
        cs.id,
        cs.created_at,
        cs.updated_at,
        cs.user_id,
        cs.summary,
        cs.dataset_ids,
        u.nickname as user_nickname,
        u.username as user_username,
        u.email as user_email,
        u.tenant_id as owner_tenant_id,
        u.dept_id as owner_dept_id,
        d.name as dept_name,
        d.code as dept_code,
        CASE
          WHEN cs.dataset_ids IS NULL OR array_length(cs.dataset_ids, 1) IS NULL THEN '[]'::json
          ELSE COALESCE(
            json_agg(
              DISTINCT jsonb_build_object(
                'id', ds.id::text,
                'name', ds.name
              )
            ) FILTER (WHERE ds.id IS NOT NULL),
            '[]'::json
          )
        END as datasets
      FROM chat_session cs
      LEFT JOIN users u ON cs.user_id = u.id
      LEFT JOIN dept d ON u.dept_id = d.id
      LEFT JOIN LATERAL unnest(
        CASE
          WHEN cs.dataset_ids IS NULL OR array_length(cs.dataset_ids, 1) IS NULL
          THEN ARRAY[]::text[]
          ELSE cs.dataset_ids
        END
      ) AS dataset_id ON true
      LEFT JOIN datasets ds ON ds.id::text = dataset_id
      WHERE cs.id = $1
      GROUP BY cs.id, cs.created_at, cs.updated_at, cs.user_id, cs.summary, cs.dataset_ids,
               u.nickname, u.username, u.email, u.tenant_id, u.dept_id, d.name, d.code
    `;

    const sessionResult = await pool.query(sessionQuery, [id]);

    if (sessionResult.rows.length === 0) {
      return res.status(404).json({ error: "Session not found" });
    }

    const session = sessionResult.rows[0];

    // 鉴权：先查到 session 再判 403，让"不存在"得到 404、"别人的"得到 403
    if (!superAdmin) {
      if (tenantAdmin && userPerms.tenantId) {
        if (session.owner_tenant_id !== userPerms.tenantId) {
          return res.status(403).json({ error: "无权查看该会话" });
        }
      } else if (deptAdmin && userPerms.deptId) {
        if (session.owner_dept_id !== userPerms.deptId) {
          return res.status(403).json({ error: "无权查看该会话" });
        }
      } else {
        if (session.user_id !== currentUserId) {
          return res.status(403).json({ error: "无权查看该会话" });
        }
      }
    }

    // 解析知识库数组，过滤掉 null 值
    const datasets = (session.datasets || []).filter((ds: any) => ds && ds.id && ds.name);

    // 获取会话详情
    const detailsQuery = `
      SELECT
        id,
        session_id,
        question,
        answer,
        submitted_at,
        answered_at,
        duration_ms,
        feedback,
        vote_good,
        vote_bad,
        "references",
        segments_ids,
        segment_similarities
      FROM chat_session_detail
      WHERE session_id = $1
      ORDER BY submitted_at ASC
    `;

    const detailsResult = await pool.query(detailsQuery, [id]);

    // 获取所有引用的文件信息
    const allFileIds = detailsResult.rows
      .filter((detail) => detail.references && detail.references.length > 0)
      .flatMap((detail) => detail.references);

    let fileInfoMap: { [key: number]: any } = {};
    if (allFileIds.length > 0) {
      const fileQuery = `
        SELECT id, filename, originalname, mimetype, path
        FROM knowledge_files
        WHERE id = ANY($1)
      `;
      const fileResult = await pool.query(fileQuery, [allFileIds]);
      fileInfoMap = fileResult.rows.reduce((map: { [key: number]: any }, file: any) => {
        map[file.id] = file;
        return map;
      }, {});
    }

    // 格式化结果（owner_tenant_id / owner_dept_id 不外泄）
    const sessionData = {
      id: session.id,
      createdAt: session.created_at,
      updatedAt: session.updated_at,
      userId: session.user_id,
      summary: session.summary,
      datasetIds: session.dataset_ids || [],
      datasets: datasets.map((ds: any) => ({ id: ds.id, name: ds.name })),
      user: {
        nickname: session.user_nickname,
        username: session.user_username,
        email: session.user_email,
      },
      dept: {
        name: session.dept_name,
        code: session.dept_code,
      },
      details: detailsResult.rows.map((detail) => ({
        id: detail.id,
        sessionId: detail.session_id,
        question: detail.question,
        answer: detail.answer,
        submittedAt: detail.submitted_at,
        answeredAt: detail.answered_at,
        durationMs: detail.duration_ms,
        feedback: detail.feedback,
        voteGood: detail.vote_good,
        voteBad: detail.vote_bad,
        references: detail.references
          ? detail.references.map((fileId: number) => fileInfoMap[fileId]).filter(Boolean)
          : [],
        segmentsIds: detail.segments_ids,
        segmentSimilarities: detail.segment_similarities,
      })),
    };

    res.status(200).json(sessionData);
  } catch (error) {
    console.error("Error fetching session details:", error);
    const errorMessage = error instanceof Error ? error.message : String(error);
    res.status(500).json({ error: "Internal server error", details: errorMessage });
  }
}
