/**
 * 租户的"叶子部门"查询。
 *
 * 用于流程管理手册封面"文件接收部门（标记 Y）"表：
 *  - 按当前用户的 tenant_id（或超管 fallback 到 ZN_DEFAULT_TENANT_CODE）
 *  - 取该租户下 status=active 且没有 active 子部门的部门
 *  - 按 dept.code 升序返回部门名
 *
 * 链路：ragent (此 helper) → znpm 透传 → docfuse 写到 docx 封面表
 */

import pool from "@/lib/db";
import { getUserPermissions } from "@/lib/permissions";

const DEFAULT_TENANT_ENV = "ZN_DEFAULT_TENANT_CODE";
const DEFAULT_TENANT_FALLBACK = "ZSH";

/**
 * 解析"当前用户应使用的 tenant_id"。
 *
 * - 普通用户/租户管理员：使用其 users.tenant_id
 * - 超级管理员（无 tenant_id）：fallback 到环境变量 ZN_DEFAULT_TENANT_CODE
 *   （未配置时回退到 'ZSH'）。
 *
 * 找不到任何匹配租户时抛错——业务方应转 5xx，避免静默使用错误的租户。
 */
export async function resolveTenantId(userId: number): Promise<number> {
  const perms = await getUserPermissions(userId);
  if (perms?.tenantId) return perms.tenantId;

  const code = process.env[DEFAULT_TENANT_ENV] || DEFAULT_TENANT_FALLBACK;
  const r = await pool.query<{ id: number }>(
    `SELECT id FROM tenant WHERE code = $1 AND status = 'active' LIMIT 1`,
    [code],
  );
  if (r.rowCount === 0) {
    throw new Error(`默认租户 ${code} 不存在或未启用（环境变量 ${DEFAULT_TENANT_ENV}）`);
  }
  return r.rows[0].id;
}

/**
 * 查询指定租户的"叶子部门"名称列表（按 dept.code 升序）。
 *
 * 叶子定义：自身 status='active' 且不存在 status='active' 的子部门。
 * 同一租户内 dept.code 唯一，所以排序稳定。
 */
export async function getLeafDepartmentNames(tenantId: number): Promise<string[]> {
  const r = await pool.query<{ name: string }>(
    `SELECT d.name
       FROM dept d
      WHERE d.tenant_id = $1
        AND d.status = 'active'
        AND NOT EXISTS (
          SELECT 1 FROM dept c
           WHERE c.parent_id = d.id AND c.status = 'active'
        )
      ORDER BY d.code ASC`,
    [tenantId],
  );
  return r.rows.map((x) => x.name);
}
