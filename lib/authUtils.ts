import { mutate as swrMutate } from "swr";

/**
 * 清除聊天页面的选择缓存
 * 在用户登出或 token 失效时调用
 */
export function clearChatSelectionCache() {
  if (typeof window === "undefined") return;

  localStorage.removeItem("ragent_selected_app_id");
  localStorage.removeItem("ragent_optional_dataset_ids");
  localStorage.removeItem("selectedDatasetIds");
}

/**
 * 作废整份 SWR 缓存。**登出与 token 失效两条路径都必须调。**
 *
 * SWR 的默认缓存是模块级全局 Map，而登出/登入只翻 AuthGate 的 state、**不刷页**
 * （见 AuthGate 的 handleLogout / handleLogin）。不清的话，同一标签页里换用户登录时
 * stale-while-revalidate 会先把上一个用户的缓存吐出来，再异步换成新用户的数据。
 *
 * 在个人环境变量（`/skills/{id}/user-env`，迁移 041）之前，缓存里都是非机密数据，
 * 这个窗口只是显示串味；那是全站第一份进 SWR 缓存的**凭据值**，窗口就变成了跨用户
 * 泄漏，所以整份作废。
 *
 * 过滤器恒真 = 匹配所有键；`revalidate: false` 让它只作废不重取（新用户挂载组件时
 * 自然会拉自己那份）。
 */
export function clearSwrCache() {
  if (typeof window === "undefined") return;
  swrMutate(() => true, undefined, { revalidate: false });
}
