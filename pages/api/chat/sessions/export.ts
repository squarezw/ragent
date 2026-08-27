import { NextApiRequest, NextApiResponse } from "next";
import { getUserIdFromRequest } from "@/lib/auth";
import pool from "@/lib/db";
import { buildVisibilityScope, deptIdsAtOrBelow } from "@/lib/visibilityScope";
import * as XLSX from "xlsx";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    // 认证检查
    const currentUserId = getUserIdFromRequest(req);
    if (!currentUserId) {
      return res.status(401).json({ error: "未登录" });
    }

    // 可见范围：全站唯一的一份阶梯在 lib/visibilityScope.ts。
    // 这个接口原先与会话列表逐行同构、同样漏了排除更高权限角色，
    // 而它导出的是**全文问答内容**落盘 xlsx，泄漏面比列表页大。
    const scope = await buildVisibilityScope(
      currentUserId,
      { userIdCol: "cs.user_id", userAlias: "u" },
      1
    );
    if (!scope) {
      return res.status(404).json({ error: "用户不存在" });
    }
    const { perms: userPerms, tier } = scope;
    const superAdmin = tier === "super";
    const tenantAdmin = tier === "tenant";
    const deptAdmin = tier === "dept";

    const { startDate, endDate, userId, deptId, tenantId, search, feedback } = req.query;

    // 构建查询条件
    const whereConditions = [...scope.conditions];
    const queryParams = [...scope.params];
    let paramIndex = scope.nextIndex;

    // 时间范围筛选
    if (startDate) {
      whereConditions.push(`cs.created_at >= $${paramIndex}`);
      queryParams.push(startDate);
      paramIndex++;
    }
    if (endDate) {
      whereConditions.push(`cs.created_at <= $${paramIndex}`);
      queryParams.push(endDate);
      paramIndex++;
    }

    // 用户筛选（需要权限检查）
    if (userId) {
      const targetUserId = Number(userId);
      // 超级管理员可以查看任何用户
      // 租户管理员只能查看本租户的用户
      // 部门管理员只能查看本部门的用户
      if (!superAdmin) {
        if (tenantAdmin && userPerms.tenantId) {
          // 验证目标用户是否在同一租户
          const targetUserRes = await pool.query("SELECT tenant_id FROM users WHERE id = $1", [
            targetUserId,
          ]);
          if (
            targetUserRes.rows.length === 0 ||
            targetUserRes.rows[0].tenant_id !== userPerms.tenantId
          ) {
            return res.status(403).json({ error: "无权导出该用户的会话" });
          }
        } else if (deptAdmin && userPerms.deptId) {
          // 验证目标用户是否在本部门**子树**内 —— 与 buildVisibilityScope 同一口径
          const targetUserRes = await pool.query("SELECT dept_id FROM users WHERE id = $1", [
            targetUserId,
          ]);
          const scopeDepts = await deptIdsAtOrBelow(userPerms.deptId);
          if (
            targetUserRes.rows.length === 0 ||
            !scopeDepts.includes(targetUserRes.rows[0].dept_id)
          ) {
            return res.status(403).json({ error: "无权导出该用户的会话" });
          }
        } else {
          // 普通用户只能导出自己的会话
          if (targetUserId !== currentUserId) {
            return res.status(403).json({ error: "无权导出该用户的会话" });
          }
        }
      }
      whereConditions.push(`cs.user_id = $${paramIndex}`);
      queryParams.push(targetUserId);
      paramIndex++;
    }

    // 部门筛选（需要权限检查）
    if (deptId) {
      const targetDeptId = Number(deptId);
      if (!superAdmin) {
        if (tenantAdmin && userPerms.tenantId) {
          // 租户管理员只能查看本租户下的部门
          const deptRes = await pool.query("SELECT tenant_id FROM dept WHERE id = $1", [
            targetDeptId,
          ]);
          if (deptRes.rows.length === 0 || deptRes.rows[0].tenant_id !== userPerms.tenantId) {
            return res.status(403).json({ error: "无权导出该部门的会话" });
          }
        } else if (deptAdmin && userPerms.deptId) {
          // 部门管理员可查看本部门及其下级
          const scopeDepts = await deptIdsAtOrBelow(userPerms.deptId);
          if (!scopeDepts.includes(targetDeptId)) {
            return res.status(403).json({ error: "无权导出该部门的会话" });
          }
        } else {
          // 普通用户不能按部门筛选
          return res.status(403).json({ error: "无权按部门筛选会话" });
        }
      }
      whereConditions.push(`u.dept_id = $${paramIndex}`);
      queryParams.push(targetDeptId);
      paramIndex++;
    }

    // 租户筛选（只有超级管理员可以按租户筛选）
    if (tenantId) {
      const targetTenantId = Number(tenantId);
      if (!superAdmin) {
        return res.status(403).json({ error: "无权按租户筛选会话" });
      }
      whereConditions.push(`u.tenant_id = $${paramIndex}`);
      queryParams.push(targetTenantId);
      paramIndex++;
    }

    // 搜索条件
    if (search) {
      whereConditions.push(
        `(cs.summary ILIKE $${paramIndex} OR u.nickname ILIKE $${paramIndex} OR u.username ILIKE $${paramIndex})`
      );
      queryParams.push(`%${search}%`);
      paramIndex++;
    }

    // 反馈筛选条件
    if (feedback) {
      if (feedback === "good") {
        whereConditions.push(
          `EXISTS (SELECT 1 FROM chat_session_detail csd WHERE csd.session_id = cs.id AND csd.vote_good = true)`
        );
      } else if (feedback === "bad") {
        whereConditions.push(
          `EXISTS (SELECT 1 FROM chat_session_detail csd WHERE csd.session_id = cs.id AND csd.vote_bad = true)`
        );
      }
    }

    const whereClause = whereConditions.length > 0 ? `WHERE ${whereConditions.join(" AND ")}` : "";

    // 获取所有会话数据（不分页）
    const sessionsQuery = `
      SELECT 
        cs.id,
        cs.created_at,
        cs.updated_at,
        cs.user_id,
        cs.summary,
        cs.app_id,
        u.nickname as user_nickname,
        u.username as user_username,
        u.email as user_email,
        d.name as dept_name,
        d.code as dept_code,
        a.name as app_name,
        COUNT(csd.id) as detail_count,
        AVG(csd.duration_ms) as avg_duration,
        SUM(CASE WHEN csd.vote_good = true THEN 1 ELSE 0 END) as good_votes,
        SUM(CASE WHEN csd.vote_bad = true THEN 1 ELSE 0 END) as bad_votes
      FROM chat_session cs
      LEFT JOIN users u ON cs.user_id = u.id
      LEFT JOIN dept d ON u.dept_id = d.id
      LEFT JOIN apps a ON cs.app_id = a.id
      LEFT JOIN chat_session_detail csd ON cs.id = csd.session_id
      ${whereClause}
      GROUP BY cs.id, cs.created_at, cs.updated_at, cs.user_id, cs.summary, cs.app_id, u.nickname, u.username, u.email, d.name, d.code, a.name
      ORDER BY cs.created_at DESC
    `;

    const sessionsResult = await pool.query(sessionsQuery, queryParams);

    // Excel 单元格字符限制
    const EXCEL_MAX_CELL_LENGTH = 32767;
    const truncateText = (text: string | null | undefined, maxLength = EXCEL_MAX_CELL_LENGTH) => {
      if (!text) return "";
      if (text.length <= maxLength) return text;
      return text.slice(0, maxLength - 3) + "...";
    };

    // 格式化数据
    const rows = sessionsResult.rows.map((row) => {
      const avgDurationMs = row.avg_duration ? Math.round(row.avg_duration) : 0;
      const avgDurationMinutes = Math.floor(avgDurationMs / 60000);
      const avgDurationSeconds = Math.floor((avgDurationMs % 60000) / 1000);

      let avgDurationStr = "";
      if (avgDurationMinutes > 0) {
        avgDurationStr = `${avgDurationMinutes}分${avgDurationSeconds}秒`;
      } else {
        avgDurationStr = `${avgDurationSeconds}秒`;
      }

      return [
        row.id,
        row.user_nickname || row.user_username || "",
        row.user_email || "",
        row.dept_name || "",
        row.app_name || "",
        new Date(row.created_at).toLocaleString("zh-CN"),
        truncateText(row.summary),
        parseInt(row.detail_count) || 0,
        avgDurationStr,
        parseInt(row.good_votes) || 0,
        parseInt(row.bad_votes) || 0,
      ];
    });

    // 表头
    const headers = [
      "会话ID",
      "用户昵称",
      "邮箱",
      "部门",
      "应用名称",
      "创建时间",
      "会话摘要",
      "对话数",
      "平均耗时",
      "好评数",
      "差评数",
    ];

    // 创建工作簿
    const workbook = XLSX.utils.book_new();
    const worksheet = XLSX.utils.aoa_to_sheet([headers, ...rows]);

    // 设置列宽
    worksheet["!cols"] = [
      { wch: 10 }, // 会话ID
      { wch: 15 }, // 用户昵称
      { wch: 25 }, // 邮箱
      { wch: 20 }, // 部门
      { wch: 20 }, // 应用名称
      { wch: 20 }, // 创建时间
      { wch: 50 }, // 会话摘要
      { wch: 10 }, // 对话数
      { wch: 12 }, // 平均耗时
      { wch: 10 }, // 好评数
      { wch: 10 }, // 差评数
    ];

    // 添加工作表
    XLSX.utils.book_append_sheet(workbook, worksheet, "会话列表");

    // 生成 Excel 文件
    const excelBuffer = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });

    // 设置响应头
    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    );

    // 生成文件名
    const timestamp = new Date().toISOString().slice(0, 19).replace(/[:.]/g, "-");
    const filename = `会话列表_${timestamp}.xlsx`;
    // 使用RFC 5987编码处理中文文件名
    const encodedFilename = encodeURIComponent(filename);
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${timestamp}.xlsx"; filename*=UTF-8''${encodedFilename}`
    );
    res.setHeader("Content-Length", excelBuffer.length.toString());

    // 发送文件
    res.send(excelBuffer);
  } catch (error) {
    console.error("Error exporting sessions:", error);
    res.status(500).json({ error: "Failed to export sessions" });
  }
}
