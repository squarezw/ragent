// P5 审核工作流：状态归一化 + 徽标映射（纯函数，供 skills / apps / reviews 页面共用）

/** 审核生命周期状态（skills 与 apps 同构） */
export type ReviewStatus = "draft" | "pending_review" | "rejected" | "published";

export const REVIEW_STATUSES: ReviewStatus[] = ["draft", "pending_review", "rejected", "published"];

/**
 * 容错归一化后端返回的 status。
 * 后端并行开发中，status 可能缺失或形状不对：
 * - 合法值原样返回；
 * - 缺失/非法时按 published_content 兜底推断（有已发布正文=published，否则=draft），
 *   与 P0-P2 的旧两态推断保持行为一致。
 */
export function resolveReviewStatus(
  status: unknown,
  publishedContent?: string | null
): ReviewStatus {
  if (typeof status === "string" && (REVIEW_STATUSES as string[]).includes(status)) {
    return status as ReviewStatus;
  }
  return publishedContent != null ? "published" : "draft";
}

/**
 * 已发布但草稿有未发布修改（存在 published_content 且 content ≠ published_content）。
 * 已发布后再编辑（后端会把 status 翻回 draft/pending/rejected）也要标出差异，
 * 所以只看正文，不看 status。
 */
export function hasUnpublishedChanges(
  content: string | null | undefined,
  publishedContent: string | null | undefined
): boolean {
  if (publishedContent == null) return false;
  return (content ?? "") !== publishedContent;
}

/** 徽标渲染信息：i18n key（skills 命名空间）+ shadcn Badge variant + 附加类 */
export interface ReviewStatusBadge {
  labelKey: "statusDraft" | "statusPendingReview" | "statusRejected" | "statusPublished";
  variant: "default" | "secondary" | "destructive" | "outline";
  className?: string;
}

const BADGE_MAP: Record<ReviewStatus, ReviewStatusBadge> = {
  draft: { labelKey: "statusDraft", variant: "secondary" },
  pending_review: {
    labelKey: "statusPendingReview",
    variant: "outline",
    className: "text-blue-600 border-blue-300",
  },
  rejected: { labelKey: "statusRejected", variant: "destructive" },
  published: { labelKey: "statusPublished", variant: "default" },
};

export function reviewStatusBadge(status: ReviewStatus): ReviewStatusBadge {
  return BADGE_MAP[status];
}
