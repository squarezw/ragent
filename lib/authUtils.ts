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
