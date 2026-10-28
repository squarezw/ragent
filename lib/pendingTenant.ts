/** Shared pending-assignment predicate. Aliases refer to the users row in each query. */
export const PENDING_TENANT_SQL = `(
  COALESCE(u.status = 'active', false)
  AND NOT EXISTS (
    SELECT 1 FROM tenant pending_tenant
    WHERE pending_tenant.id = u.tenant_id AND pending_tenant.status = 'active'
  )
  AND NOT EXISTS (
    SELECT 1 FROM user_roles pending_ur
    JOIN roles pending_role ON pending_role.id = pending_ur.role_id
    WHERE pending_ur.user_id = u.id
      AND pending_role.is_system = true AND pending_role.name = '超级管理员'
  )
)`;
