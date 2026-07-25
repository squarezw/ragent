// P8a 可执行 skill 资产清单数据整形（纯函数，SkillDiffDialog / 页面共用，可单测）

import type {
  SkillAssetChange,
  SkillAssetDiffItem,
  SkillDiff,
  SkillExecConfigSummary,
} from "@/types/review";

const KNOWN_CHANGES: ReadonlySet<string> = new Set(["added", "removed", "modified", "unchanged"]);

function asString(v: unknown): string | null {
  return typeof v === "string" ? v : null;
}

function asSize(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : null;
}

/** 单条资产对照容错归一化；path 缺失视为坏行返回 null */
function toAssetDiffItem(value: unknown): SkillAssetDiffItem | null {
  if (typeof value !== "object" || value === null) return null;
  const obj = value as Record<string, unknown>;
  const path = asString(obj.path);
  if (!path) return null;
  const rawChange = asString(obj.change) ?? "";
  // 未知 change 按 modified 保守标注（宁可提醒审核人多看一眼）
  const change: SkillAssetChange = KNOWN_CHANGES.has(rawChange)
    ? (rawChange as SkillAssetChange)
    : "modified";
  return {
    path,
    kind: asString(obj.kind) ?? "asset",
    change,
    draft_sha256: asString(obj.draft_sha256),
    published_sha256: asString(obj.published_sha256),
    draft_size: asSize(obj.draft_size),
    published_size: asSize(obj.published_size),
    draft_text: asString(obj.draft_text),
    published_text: asString(obj.published_text),
  };
}

/** assets 数组容错归一化：非数组 → []，坏行剔除 */
export function normalizeAssetDiff(value: unknown): SkillAssetDiffItem[] {
  if (!Array.isArray(value)) return [];
  return value.map(toAssetDiffItem).filter((item): item is SkillAssetDiffItem => item !== null);
}

/** exec 配置容错归一化：entrypoint/image 任一缺失视为无配置 */
export function normalizeExecConfig(value: unknown): SkillExecConfigSummary | null {
  if (typeof value !== "object" || value === null) return null;
  const obj = value as Record<string, unknown>;
  const entrypoint = asString(obj.entrypoint);
  const image = asString(obj.image);
  if (!entrypoint || !image) return null;
  return {
    stage: asString(obj.stage) ?? "draft",
    entrypoint,
    image,
    image_enabled: obj.image_enabled !== false,
    timeout_sec: asSize(obj.timeout_sec) ?? 120,
    writable_subdirs: Array.isArray(obj.writable_subdirs)
      ? obj.writable_subdirs.filter((s): s is string => typeof s === "string")
      : [],
    needs_llm: obj.needs_llm === true,
    warm_pool: obj.warm_pool === true,
  };
}

/**
 * GET /api/v1/skills/{id}/diff 响应整体容错解包。
 * 旧后端（P8a 之前）无 assets/exec_config_* 字段时降级为空清单/null。
 */
export function parseSkillDiff(data: unknown): SkillDiff {
  const obj = (data ?? {}) as Record<string, unknown>;
  return {
    draft: asString(obj.draft) ?? "",
    published: asString(obj.published),
    assets: normalizeAssetDiff(obj.assets),
    exec_config_draft: normalizeExecConfig(obj.exec_config_draft),
    exec_config_published: normalizeExecConfig(obj.exec_config_published),
  };
}

export interface AssetDiffSummary {
  /** draft stage 文件数（removed 行不算在草稿清单内） */
  total: number;
  /** draft stage 合计字节数 */
  totalBytes: number;
  added: number;
  removed: number;
  modified: number;
  /** 是否存在任何 draft vs published 差异 */
  hasChanges: boolean;
}

/** 资产对照汇总：草稿清单规模 + 变更计数 */
export function summarizeAssetDiff(items: SkillAssetDiffItem[]): AssetDiffSummary {
  let total = 0;
  let totalBytes = 0;
  let added = 0;
  let removed = 0;
  let modified = 0;
  for (const item of items) {
    if (item.change !== "removed") {
      total += 1;
      totalBytes += item.draft_size ?? 0;
    }
    if (item.change === "added") added += 1;
    else if (item.change === "removed") removed += 1;
    else if (item.change === "modified") modified += 1;
  }
  return {
    total,
    totalBytes,
    added,
    removed,
    modified,
    hasChanges: added + removed + modified > 0,
  };
}

/** exec 配置 diff 视图要标注的字段 */
export type ExecConfigField =
  | "entrypoint"
  | "image"
  | "timeout_sec"
  | "writable_subdirs"
  | "needs_llm"
  | "warm_pool";

/**
 * draft vs published exec 配置逐字段对比，返回有差异的字段名。
 * 任一侧缺失（从未发布 / 配置被移除）返回 []——整块本身就是新增/移除，不逐字段标。
 */
export function diffExecConfig(
  draft: SkillExecConfigSummary | null,
  published: SkillExecConfigSummary | null
): ExecConfigField[] {
  if (!draft || !published) return [];
  const changed: ExecConfigField[] = [];
  if (draft.entrypoint !== published.entrypoint) changed.push("entrypoint");
  if (draft.image !== published.image) changed.push("image");
  if (draft.timeout_sec !== published.timeout_sec) changed.push("timeout_sec");
  if (draft.writable_subdirs.join("\n") !== published.writable_subdirs.join("\n")) {
    changed.push("writable_subdirs");
  }
  if (draft.needs_llm !== published.needs_llm) changed.push("needs_llm");
  if (draft.warm_pool !== published.warm_pool) changed.push("warm_pool");
  return changed;
}

/** 字节数人类可读格式（1024 进制，B/KB/MB/GB，保留 1 位小数） */
export function formatBytes(bytes: number | null | undefined): string {
  if (typeof bytes !== "number" || !Number.isFinite(bytes) || bytes < 0) return "-";
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB"] as const;
  let value = bytes;
  let unit: (typeof units)[number] = "KB";
  for (const u of units) {
    value /= 1024;
    unit = u;
    if (value < 1024) break;
  }
  return `${value.toFixed(1)} ${unit}`;
}
