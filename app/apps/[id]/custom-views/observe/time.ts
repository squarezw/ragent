// 观测看板统一时间格式化。
// 后端 zd-service 一律回 ISO（UTC，带 Z）；这里固定按东八区（Asia/Shanghai）展示，
// 避免依赖浏览器/服务器本地时区——UTC 服务器上直接 slice ISO 会比真实时间慢 8 小时。

const TZ = "Asia/Shanghai";

function format(iso: string | null | undefined, withSeconds: boolean): string {
  if (!iso) return "";
  const d = new Date(iso);
  // 非法时间串原样返回，不静默吞成空
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("zh-CN", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    ...(withSeconds ? { second: "2-digit" } : {}),
    hour12: false,
  });
}

/** 列表等场景：精确到分钟，如 2026/06/03 09:19。 */
export function formatDateTime(iso: string | null | undefined): string {
  return format(iso, false);
}

/** 日志等场景：精确到秒，如 2026/06/03 09:19:34。 */
export function formatDateTimeSeconds(iso: string | null | undefined): string {
  return format(iso, true);
}

/** 仅日期场景（预审报告的预审日期等），如 2026/06/03。 */
export function formatDate(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("zh-CN", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
}
