import pool from "./db";

export interface UserPermissions {
  userId: number;
  tenantId: number | null;
  deptId: number | null;
  roles: Array<{
    id: number;
    name: string;
    isSystem: boolean;
  }>;
  permissions: Array<{
    resourceType: string;
    permission: string;
  }>;
}

/**
 * 获取用户的完整权限信息
 */
export async function getUserPermissions(userId: number): Promise<UserPermissions | null> {
  const client = await pool.connect();
  try {
    // 获取用户基本信息
    const userRes = await client.query(
      `
      SELECT id, tenant_id, dept_id FROM users WHERE id = $1
    `,
      [userId]
    );

    if (userRes.rows.length === 0) {
      return null;
    }

    const user = userRes.rows[0];

    // 获取用户角色
    const rolesRes = await client.query(
      `
      SELECT r.id, r.name, r.is_system, r.tenant_id
      FROM user_roles ur
      JOIN roles r ON ur.role_id = r.id
      WHERE ur.user_id = $1
    `,
      [userId]
    );

    const roles = rolesRes.rows.map((row) => ({
      id: row.id,
      name: row.name,
      isSystem: row.is_system,
      tenantId: row.tenant_id,
    }));

    // 获取角色权限
    const permissionsRes = await client.query(
      `
      SELECT rp.resource_type, rp.permission
      FROM user_roles ur
      JOIN role_permissions rp ON ur.role_id = rp.role_id
      WHERE ur.user_id = $1
    `,
      [userId]
    );

    const permissions = permissionsRes.rows.map((row) => ({
      resourceType: row.resource_type,
      permission: row.permission,
    }));

    return {
      userId: user.id,
      tenantId: user.tenant_id,
      deptId: user.dept_id,
      roles,
      permissions,
    };
  } finally {
    client.release();
  }
}

/**
 * 检查用户是否有特定权限
 */
export async function hasPermission(
  userId: number,
  resourceType: string,
  permission: string
): Promise<boolean> {
  const userPerms = await getUserPermissions(userId);
  if (!userPerms) return false;

  return userPerms.permissions.some(
    (perm) => perm.resourceType === resourceType && perm.permission === permission
  );
}

/**
 * 检查用户是否有管理员权限
 */
export async function hasAdminPermission(userId: number, resourceType: string): Promise<boolean> {
  return hasPermission(userId, resourceType, "admin");
}

/**
 * 检查用户是否是超级管理员
 */
export async function isSuperAdmin(userId: number): Promise<boolean> {
  const userPerms = await getUserPermissions(userId);
  if (!userPerms) return false;

  return userPerms.roles.some((role) => role.name === "超级管理员" && role.isSystem);
}

/**
 * 检查用户是否是租户管理员
 */
export async function isTenantAdmin(userId: number): Promise<boolean> {
  const userPerms = await getUserPermissions(userId);
  if (!userPerms) return false;

  return userPerms.roles.some((role) => role.name === "租户管理员" && role.isSystem);
}

/**
 * 检查用户是否是部门管理员
 */
export async function isDeptAdmin(userId: number): Promise<boolean> {
  const userPerms = await getUserPermissions(userId);
  if (!userPerms) return false;

  return userPerms.roles.some((role) => role.name === "部门管理员" && role.isSystem);
}

/**
 * 检查用户是否可以管理组织（租户或部门）
 */
export async function canManageOrganization(userId: number): Promise<boolean> {
  const userPerms = await getUserPermissions(userId);
  if (!userPerms) return false;

  // 超级管理员可以管理所有组织
  if (await isSuperAdmin(userId)) return true;

  // 租户管理员可以管理自己的租户
  if (await isTenantAdmin(userId)) return true;

  return false;
}

/**
 * 检查用户是否可以管理特定租户
 */
export async function canManageTenant(userId: number, tenantId: number): Promise<boolean> {
  const userPerms = await getUserPermissions(userId);
  if (!userPerms) return false;

  // 超级管理员可以管理所有租户
  if (await isSuperAdmin(userId)) return true;

  // 租户管理员只能管理自己的租户
  if ((await isTenantAdmin(userId)) && userPerms.tenantId === tenantId) return true;

  return false;
}

/**
 * 检查用户是否可以管理特定部门
 */
export async function canManageDept(userId: number, deptId: number): Promise<boolean> {
  const userPerms = await getUserPermissions(userId);
  if (!userPerms) return false;

  // 超级管理员可以管理所有部门
  if (await isSuperAdmin(userId)) return true;

  // 租户管理员可以管理自己租户下的所有部门
  if (await isTenantAdmin(userId)) {
    const client = await pool.connect();
    try {
      const deptRes = await client.query(
        `
        SELECT tenant_id FROM dept WHERE id = $1
      `,
        [deptId]
      );

      if (deptRes.rows.length > 0 && deptRes.rows[0].tenant_id === userPerms.tenantId) {
        return true;
      }
    } finally {
      client.release();
    }
  }

  // 部门管理员可以管理自己的部门及子部门
  if ((await isDeptAdmin(userId)) && userPerms.deptId) {
    const client = await pool.connect();
    try {
      // 检查是否是自己的部门或子部门
      const deptRes = await client.query(
        `
        SELECT path FROM dept WHERE id = $1
      `,
        [deptId]
      );

      const userDeptRes = await client.query(
        `
        SELECT path FROM dept WHERE id = $1
      `,
        [userPerms.deptId]
      );

      if (deptRes.rows.length > 0 && userDeptRes.rows.length > 0) {
        const deptPath = deptRes.rows[0].path;
        const userDeptPath = userDeptRes.rows[0].path;
        // 检查是否是子部门（路径前缀匹配）
        return deptPath.startsWith(userDeptPath);
      }
    } finally {
      client.release();
    }
  }

  return false;
}
