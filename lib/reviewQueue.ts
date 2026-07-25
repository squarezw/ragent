// P5 待审队列数据整形 + 自审判定（纯函数，hooks / 页面共用，可单测）

import type { PendingReviewApp, PendingReviews, PendingReviewSkill } from "@/types/review";

/** 后端实际返回的合并队列条目（skills/apps 平铺进 items[]，target_type 区分） */
interface MergedPendingItem {
  target_type?: unknown;
  id?: unknown;
  name?: unknown;
  display_name?: unknown;
  user_id?: unknown;
  submitter_name?: unknown;
  submitted_at?: unknown;
  executable?: unknown;
  asset_count?: unknown;
}

function toEntry(item: MergedPendingItem): PendingReviewSkill & PendingReviewApp {
  return {
    id: typeof item.id === "number" ? item.id : Number(item.id),
    name: typeof item.name === "string" ? item.name : "",
    display_name: typeof item.display_name === "string" ? item.display_name : undefined,
    user_id: typeof item.user_id === "number" ? item.user_id : null,
    submitter: typeof item.submitter_name === "string" ? item.submitter_name : undefined,
    submitted_at: typeof item.submitted_at === "string" ? item.submitted_at : undefined,
    // P8a：可执行标注 + draft 资产计数（app 条目后端恒 false/0）
    executable: item.executable === true,
    asset_count: typeof item.asset_count === "number" ? item.asset_count : 0,
  };
}

/**
 * 待审队列响应容错解包，兼容两种形状：
 * - 后端实际实现：{total, skills: 数量, apps: 数量, items: [{target_type: "skill"|"app", ...}]}；
 * - 冻结契约旧形状：{skills: [...], apps: [...], total}（后端并行开发期的假设，保留兜底）。
 */
export function unwrapPendingReviews(data: unknown): PendingReviews {
  const obj = (data ?? {}) as Record<string, unknown>;

  if (Array.isArray(obj.items)) {
    const items = obj.items as MergedPendingItem[];
    const skills = items.filter((i) => i.target_type === "skill").map(toEntry);
    const apps = items.filter((i) => i.target_type === "app").map(toEntry);
    const total = typeof obj.total === "number" ? obj.total : items.length;
    return { skills, apps, total };
  }

  const skills = Array.isArray(obj.skills) ? (obj.skills as PendingReviewSkill[]) : [];
  const apps = Array.isArray(obj.apps) ? (obj.apps as PendingReviewApp[]) : [];
  const total = typeof obj.total === "number" ? obj.total : skills.length + apps.length;
  return { skills, apps, total };
}

/**
 * 自审判定：审核人不能审自己提交的对象（超管除外，后端违者 403）。
 * 任一 id 缺失时返回 false（信息不足不拦，交给后端兜底）。
 */
export function isSelfReview(
  currentUserId: number | null | undefined,
  submitterId: number | null | undefined,
  isSuperAdmin: boolean
): boolean {
  if (isSuperAdmin) return false;
  if (typeof currentUserId !== "number" || typeof submitterId !== "number") return false;
  return currentUserId === submitterId;
}
