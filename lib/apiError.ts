/**
 * 从后端错误响应里抽出最适合直接展示给用户的那句话。
 *
 * 上游（python docfuse / zn-process-management）的报错经常被层层包裹，最糟的形态是
 * 把内层 JSON 整个拼进 message：
 *   { error: { code, message: 'POST /api/handbook/prepare-for-review failed (400): {"detail":"封面定位失败：…"}' } }
 * 这里优先取结构化的 detail，取不到再把 message 里嵌着的 {"detail":…} 抠出来。
 */
export function getApiErrorMessage(error: any, fallback = "请求失败"): string {
  const data = error?.response?.data;
  const raw =
    str(data?.detail) ||
    str(data?.error?.message) ||
    str(data?.error) ||
    str(data?.message) ||
    str(error?.message) ||
    fallback;
  return peelEmbeddedDetail(raw);
}

function str(v: unknown): string | undefined {
  return typeof v === "string" && v.trim() ? v : undefined;
}

/** message 尾部形如 `… failed (400): {"detail":"…"}` 时，把 detail 那句人话抠出来。 */
function peelEmbeddedDetail(message: string): string {
  const start = message.indexOf("{");
  if (start === -1) return message;
  try {
    const parsed = JSON.parse(message.slice(start));
    const detail = parsed?.detail;
    if (typeof detail === "string" && detail.trim()) return detail;
  } catch {
    // 尾部不是合法 JSON，原样返回
  }
  return message;
}
