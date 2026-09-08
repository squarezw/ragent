import { NextApiRequest, NextApiResponse } from "next";
import pool from "@/lib/db";
import { getUserIdFromRequest } from "@/lib/auth";
import { buildVisibilityScope, canViewOwner } from "@/lib/visibilityScope";

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
    // 可见范围：与会话列表同一张梯子（lib/visibilityScope.ts）。
    // 列表里看不到、详情却打得开，就是授权漏洞 —— 这里原先漏了排除更高权限角色，
    // 于是部门管理员读得到同部门内超管/租户管理员的**完整问答记录**。
    const scope = await buildVisibilityScope(
      currentUserId,
      { userIdCol: "cs.user_id", userAlias: "u" },
      1
    );
    if (!scope) {
      return res.status(404).json({ error: "用户不存在" });
    }

    // 获取会话基本信息，同时获取知识库信息
    // owner_tenant_id / owner_dept_id 仅用于鉴权，不出现在响应体里
    const sessionQuery = `
      SELECT
        cs.id,
        cs.created_at,
        cs.updated_at,
        cs.user_id,
        cs.app_id,
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
      GROUP BY cs.id, cs.created_at, cs.updated_at, cs.user_id, cs.app_id, cs.summary, cs.dataset_ids,
               u.nickname, u.username, u.email, u.tenant_id, u.dept_id, d.name, d.code
    `;

    const sessionResult = await pool.query(sessionQuery, [id]);

    if (sessionResult.rows.length === 0) {
      return res.status(404).json({ error: "Session not found" });
    }

    const session = sessionResult.rows[0];

    // 鉴权：先查到 session 再判 403，让"不存在"得到 404、"别人的"得到 403
    const allowed = await canViewOwner(scope, {
      userId: session.user_id,
      tenantId: session.owner_tenant_id,
      deptId: session.owner_dept_id,
    });
    if (!allowed) {
      return res.status(403).json({ error: "无权查看该会话" });
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
        segment_similarities,
        prompt_tokens,
        completion_tokens,
        total_tokens,
        llm_calls,
        model_name,
        usage_partial,
          -- 关联子查询要用**外层表名**（本查询没给 chat_session_detail 起别名）。
          -- 写成 detail.id 是把下面 JS 映射里的行变量名当成了 SQL 别名，
          -- PostgreSQL 报 missing FROM-clause entry for table "detail"。
        (SELECT ct.amount FROM credit_transactions ct
          WHERE ct.chat_session_detail_id = chat_session_detail.id
            AND ct.tx_type = 'consume' LIMIT 1) AS credits,
        cache_read_tokens,
        cache_write_tokens
      FROM chat_session_detail
      WHERE session_id = $1
      ORDER BY submitted_at ASC
    `;

    const detailsResult = await pool.query(detailsQuery, [id]);

    // 本会话显式调用过哪些 skill。
    //
    // 口径刻意窄：只统计 execute_skill / load_skill 两条**可观测**路径。
    // 注入未降级时，绑定的 skill 正文每轮都在提示词里，模型有没有采纳不产生
    // 任何信号；把它算作「使用过」是编造。所以叫 skillsInvoked 不叫 skillsUsed。
    //
    // execute 与 load 分开计数：前者在沙箱里跑了脚本并计费，后者只是把正文读进
    // 上下文。合成一个数字，「跑了 5 次脚本」和「读了 5 次说明」就没法区分了。
    const skillsQuery = `
      SELECT r.skill_name, r.kind, COUNT(*)::int AS times,
             MAX(s.display_name) AS display_name
        FROM skill_runs r
        LEFT JOIN skills s ON s.id = r.skill_id
        JOIN chat_session_detail d ON d.id = r.chat_session_detail_id
       WHERE d.session_id = $1
       GROUP BY r.skill_name, r.kind
       ORDER BY times DESC, r.skill_name
    `;
    const skillsResult = await pool.query(skillsQuery, [id]);

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
      // 这条会话属于哪个数字员工。前端加载历史会话时靠它把选择器切回去 ——
      // 在此之前不返回它，于是停在上次选的员工上，继续提问跑在错误的
      // skills / 工具上，而会话视图里那个选择器根本不渲染，用户看不见也改不了。
      // 可能为 null：线上 44% 的会话没记 app_id（老数据 / 企微等入口）。
      appId: session.app_id ?? null,
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
        // 用量：整块给或整块不给。
        //
        // total_tokens 为 NULL = 这一轮**没有记录**（存量对话，或 provider
        // 没回 usage），与「消耗为 0」是两回事。这里给 undefined 而不是把各
        // 字段填 0，前端才能靠「有没有这个对象」决定显示与否 —— 显示成 0
        // 会被当成免费。
        usage:
          detail.total_tokens === null || detail.total_tokens === undefined
            ? undefined
            : {
                promptTokens: detail.prompt_tokens,
                completionTokens: detail.completion_tokens,
                totalTokens: detail.total_tokens,
                llmCalls: detail.llm_calls,
                modelName: detail.model_name,
                partial: detail.usage_partial === true,
                cacheReadTokens: detail.cache_read_tokens,
                // 积分：没有流水就是 undefined（该轮无租户归属 / 早于计费上线），
                // 不要补 0 —— 0 会被读成「这轮免费」
                credits: detail.credits === null ? undefined : String(detail.credits),
                cacheWriteTokens: detail.cache_write_tokens,
              },
      })),
      skillsInvoked: skillsResult.rows.map((r: any) => ({
        skillName: r.skill_name,
        displayName: r.display_name ?? undefined,
        kind: r.kind,
        times: r.times,
      })),
    };

    res.status(200).json(sessionData);
  } catch (error) {
    console.error("Error fetching session details:", error);
    const errorMessage = error instanceof Error ? error.message : String(error);
    res.status(500).json({ error: "Internal server error", details: errorMessage });
  }
}
