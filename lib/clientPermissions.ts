// 客户端权限检查函数（用于客户端组件）

// 检查用户是否为超级管理员
export function checkSuperAdmin(user: any): boolean {
  if (!user) return false;

  // 检查 isSuperAdmin 字段
  if (user.isSuperAdmin) return true;

  // 检查 roles 数组
  if (user.roles && Array.isArray(user.roles)) {
    return user.roles.some((role: any) =>
      typeof role === "string" ? role === "超级管理员" : role.name === "超级管理员"
    );
  }

  return false;
}

// 检查用户是否为租户管理员
export function checkTenantAdmin(user: any): boolean {
  if (!user) return false;

  // 检查 isTenantAdmin 字段
  if (user.isTenantAdmin) return true;

  // 检查 roles 数组
  if (user.roles && Array.isArray(user.roles)) {
    return user.roles.some((role: any) =>
      typeof role === "string" ? role === "租户管理员" : role.name === "租户管理员"
    );
  }

  return false;
}

// 检查用户是否为部门管理员
export function checkDeptAdmin(user: any): boolean {
  if (!user) return false;

  // 检查 isDeptAdmin 字段
  if (user.isDeptAdmin) return true;

  // 检查 roles 数组
  if (user.roles && Array.isArray(user.roles)) {
    return user.roles.some((role: any) =>
      typeof role === "string" ? role === "部门管理员" : role.name === "部门管理员"
    );
  }

  return false;
}

// 检查用户是否可以管理组织
export function canManageOrganization(user: any): boolean {
  return checkSuperAdmin(user) || checkTenantAdmin(user);
}

// 检查用户是否可以管理租户
export function canManageTenant(user: any, tenantId: number): boolean {
  if (checkSuperAdmin(user)) return true;

  if (checkTenantAdmin(user) && user.tenant_id === tenantId) return true;

  return false;
}

// 检查用户是否可以管理部门
export function canManageDept(user: any, deptId: number): boolean {
  if (checkSuperAdmin(user)) return true;

  if (checkTenantAdmin(user)) {
    // 租户管理员可以管理自己租户下的所有部门
    // 这里需要根据实际业务逻辑判断
    return true;
  }

  if (checkDeptAdmin(user) && user.dept_id === deptId) return true;

  return false;
}
