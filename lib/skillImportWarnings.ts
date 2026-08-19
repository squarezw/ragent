/**
 * 挑出**没有**被导入对话框结构化区块覆盖的 warning。
 *
 * 后端把「需要凭证」「需要出网」「将建运行配置」三件事同时写进了 warnings ——
 * 那是给直接调 API 的人看的，他们没有界面。前端已经用专门的区块渲染这三件事，
 * 若再原样列一遍 warnings，同一件事会在同一屏出现两次，读起来像是两个不同的问题。
 *
 * 判据用关键词而非位置或顺序：warnings 是自由文本，将来增删条目、调整措辞都不该
 * 让这个过滤悄悄失效（失效的表现是重复显示，不会报错，只会让人困惑）。
 */
export interface WarningSource {
  warnings: string[];
}

/** 已被结构化区块呈现、因此不该再以纯文本重复一遍的关键词 */
const COVERED_KEYWORDS = [
  "凭证", ".env.example", "允许出网", "运行配置",
  "credential", "network", "run config",
];

export function structuralWarnings(r: WarningSource): string[] {
  return r.warnings.filter(
    (w) => !COVERED_KEYWORDS.some((k) => w.includes(k))
  );
}
