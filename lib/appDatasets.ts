/**
 * 应用「自动选择知识库」开关。
 *
 * 不能只用 dataset_ids 是否为空来推断：取消勾选后如果不选具体库，保存的仍是空数组，
 * 下次打开会被当成「自动选择」。开关本身存在 apps.settings.auto_select_datasets。
 */
export function resolveAutoSelectDatasets(
  settings?: Record<string, unknown> | null,
  datasetIds?: string[] | null
): boolean {
  if (datasetIds && datasetIds.length > 0) {
    return false;
  }
  const stored = settings?.auto_select_datasets;
  if (typeof stored === "boolean") {
    return stored;
  }
  return true;
}
