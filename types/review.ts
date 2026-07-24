// P5 审核工作流类型（对齐冻结契约，后端并行开发中，字段做可选容错）

import type { ReviewStatus } from "@/lib/reviewStatus";

/** GET /api/v1/reviews/pending → skills[] 条目 */
export interface PendingReviewSkill {
  id: number;
  name: string;
  display_name?: string;
  submitter?: string;
  submitted_at?: string;
}

/** GET /api/v1/reviews/pending → apps[] 条目 */
export interface PendingReviewApp {
  id: number;
  name: string;
  submitter?: string;
  submitted_at?: string;
}

/** GET /api/v1/reviews/pending 响应 */
export interface PendingReviews {
  skills: PendingReviewSkill[];
  apps: PendingReviewApp[];
  total: number;
}

/** GET /api/v1/skills/{id}/diff 响应 */
export interface SkillDiff {
  draft: string;
  published: string | null;
}

/** POST /api/v1/{skills|apps}/{id}/review 请求体（reject 时 comment 必填） */
export interface ReviewPayload {
  approve: boolean;
  comment?: string;
}

export type { ReviewStatus };
