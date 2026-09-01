/** 与 hooks/use-mobile 的 MOBILE_BREAKPOINT 同值。两处若分叉，会出现
 *  「侧边栏按手机版收起、却没跳 chat」这种只在某个宽度区间出现的怪象。 */
export const MOBILE_BREAKPOINT = 768;

export const MOBILE_LANDING_PATH = "/chat";

/**
 * 手机上登录成功后，要不要落到对话页。
 *
 * 首页是桌面版仪表盘（几张图表），窄屏上读不了。但只在三个条件同时成立时才跳：
 *
 * - **手机宽度**：桌面上首页是有用的，不该动。
 * - **当前在首页**：从深链接（/skills/31 之类）进来被要求登录的人，
 *   登录后要看到他本来要看的东西。把他丢去 chat 等于分享链接在手机上失效。
 * - **没有 ?redirect=**：那个参数是未登录访问下载链接时被 302 注入的，
 *   已经代表一个明确目的地，覆盖它就是把人送错地方。
 *
 * 只在「刚登录那一下」判断，不在每次带 token 打开时判断 —— 后者会让
 * 侧边栏的「首页」在手机上永远点不进去。
 */
export function shouldLandOnChat(input: {
  pathname: string;
  search: string;
  viewportWidth: number;
}): boolean {
  const { pathname, search, viewportWidth } = input;
  if (viewportWidth >= MOBILE_BREAKPOINT) return false;
  // 「/」和「」都算首页；末尾斜杠不该改变行为
  const path = pathname.replace(/\/+$/, "");
  if (path !== "") return false;
  return !new URLSearchParams(search).get("redirect");
}
