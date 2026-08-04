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
 * 角色布尔值由调用方传入（与 `canEditApp` 同形态），不在这里 import clientPermissions：
 * 那个模块是给组件用的，跨 lib 引它会让这个纯函数变得没法单测。
 *
 * ⚠️ 这里只管**显示**。真正的边界在后端 —— 藏起按钮不构成任何安全保证。
 * 改这里时不要以为自己在做安全，安全那半边在服务端。
 */

interface SkillLike {
  user_id?: number | null;
  owner_tenant_id?: number | null;
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
  if (isSuperAdmin) return true;
  if (!skill || !user) return false;

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
