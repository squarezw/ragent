/**
 * Skill 的写权限 —— 前端**唯一实现**，与后端 `_can_edit_skill` 一一对应：
 *
 *   作者本人 / 超级管理员 / **本租户**的租户管理员
 *
 * 2026-08-04 发现的问题：Skill 列表的「编辑」「删除」按钮是无条件渲染的。部门管理员
 * 登进去，别人的 skill 上也是两个亮着的按钮 —— 点下去后端 403 拦住（数据是安全的），
 * 但界面在骗人：它先告诉你"你可以改"，再在你动手之后说"不行"。用户会以为是系统坏了，
 * 而不是自己没权限。
 *
 * 内置技能（`is_managed`）是第三条规则，且优先于前两条：平台维护、随镜像更新，
 * 改了会被下次同步静默覆盖，所以连超管也不放行。
 *
 * 角色布尔值由调用方传入（与 `canEditApp` 同形态），不在这里 import clientPermissions：
 * 那个模块是给组件用的，跨 lib 引它会让这个纯函数变得没法单测。
 *
 * ⚠️ 这里只管**显示**。真正的边界在后端 —— 藏起按钮不构成任何安全保证。
 * 改这里时不要以为自己在做安全，安全那半边在服务端。
 */

interface SkillLike {
  user_id?: number | null;
  owner_tenant_id?: number | null;
  /** 平台维护的内置技能 */
  is_managed?: boolean;
}

interface UserLike {
  id?: number | null;
  tenant_id?: number | null;
}

export function canEditSkill(
  skill: SkillLike | null | undefined,
  user: UserLike | null | undefined,
  isSuperAdmin: boolean,
  isTenantAdmin: boolean
): boolean {
  if (!skill) return false;
  // 内置技能：**谁都不能改**，超管也不行。判在最前面——它的答案对所有人一样，
  // 而且比"你没权限"更有信息量（后者会让用户去找管理员要一个谁都没有的权限）。
  // 后端同判据见 app/utils/skill_permissions.py::require_not_managed。
  if (skill.is_managed) return false;
  if (isSuperAdmin) return true;
  if (!user) return false;

  // 作者本人。两边都要有 id 才谈得上"同一个人"：任一为空时按无权限处理，
  // 否则 undefined === undefined 会让人看起来像每个无主 skill 的作者
  if (skill.user_id != null && user.id != null && skill.user_id === user.id) {
    return true;
  }

  // 租户管理员只管自己租户的（与后端 is_reviewer 同口径）。
  // owner_tenant_id 为空的 skill（无主租户）只有超管能碰。
  return (
    isTenantAdmin &&
    user.tenant_id != null &&
    skill.owner_tenant_id != null &&
    user.tenant_id === skill.owner_tenant_id
  );
}
