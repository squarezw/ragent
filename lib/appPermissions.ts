/**
 * 数字员工的写权限 —— 前端**唯一实现**，与后端 app/utils/app_permissions.py 同一条规矩。
 *
 * 规矩：改一个 app 的任何东西（配置 / 角色设定 / 绑工具 / 绑 skill）= **owner 或超管**。
 * 其他人只读。
 *
 * 为什么单独抽出来：这个判断会出现在列表、卡片、详情页、各个绑定区，散着写就会长成
 * 好几个样子。2026-08-04 之前后端就是这样——同一条规矩在三个文件里三种写法，其中一处
 * 压根没检查。前端同理，只是它的错法更隐蔽：按钮该显示的没显示（用户以为自己没权限），
 * 或者不该显示的显示了（点下去才吃 403）。
 *
 * ⚠️ 这里只管**显示**。真正的边界在后端——前端藏起按钮不构成任何安全保证，
 * 谁都可以直接调接口。改这里时不要以为自己在做安全，安全那半边在服务端。
 */

interface AppLike {
  user_id?: number | null;
}

interface UserLike {
  id?: number | null;
}

/** 能改这个 app 吗（owner 或超管） */
export function canEditApp(
  app: AppLike | null | undefined,
  user: UserLike | null | undefined,
  isSuperAdmin: boolean
): boolean {
  if (isSuperAdmin) return true;
  // 两边都要有 id 才谈得上"是同一个人"：任一为空时按无权限处理，
  // 否则 undefined === undefined 会让未登录用户看起来像每个无主应用的 owner
  if (app?.user_id == null || user?.id == null) return false;
  return app.user_id === user.id;
}
