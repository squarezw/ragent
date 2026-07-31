// P5.1 审核日志（GET /api/v1/reviews/log）数据整形（纯函数，可单测）

import type { ReviewLogItem } from "@/types/review";

/**
 * 响应容错解包：{items: [...]} → ReviewLogItem[]（保持后端的 created_at 倒序）。
 * 字段缺失/形状不对时逐项归一化，无法定位的行（缺 id）丢弃。
 */
export function unwrapReviewLog(data: unknown): ReviewLogItem[] {
  const items = (data as { items?: unknown } | null | undefined)?.items;
  if (!Array.isArray(items)) return [];
  const result: ReviewLogItem[] = [];
  for (const raw of items) {
    const obj = (raw ?? {}) as Record<string, unknown>;
    if (typeof obj.id !== "number") continue;
    result.push({
      id: obj.id,
      action: typeof obj.action === "string" ? obj.action : "",
      comment: typeof obj.comment === "string" ? obj.comment : null,
      actor_id: typeof obj.actor_id === "number" ? obj.actor_id : null,
      actor_name: typeof obj.actor_name === "string" ? obj.actor_name : null,
      created_at: typeof obj.created_at === "string" ? obj.created_at : null,
    });
  }
  return result;
}

/** 最近一条驳回记录（items 已按 created_at 倒序，取第一条 reject） */
export function latestReject(items: ReviewLogItem[]): ReviewLogItem | null {
  return items.find((item) => item.action === "reject") ?? null;
}

/** action → i18n key（reviews 命名空间）；未知 action 返回 null，UI 原样展示存储值 */
const ACTION_LABEL_KEYS: Record<string, string> = {
  submit: "actionSubmit",
  approve: "actionApprove",
  reject: "actionReject",
  self_publish: "actionSelfPublish",
};

export function reviewActionLabelKey(action: string): string | null {
  return ACTION_LABEL_KEYS[action] ?? null;
}
