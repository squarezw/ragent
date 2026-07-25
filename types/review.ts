// P5 审核工作流类型（对齐冻结契约，后端并行开发中，字段做可选容错）

import type { ReviewStatus } from "@/lib/reviewStatus";

/** GET /api/v1/reviews/pending → skills[] 条目 */
export interface PendingReviewSkill {
  id: number;
  name: string;
  display_name?: string;
  submitter?: string;
  /** 提交人（作者/owner）用户ID，自审判定用 */
  user_id?: number | null;
  submitted_at?: string;
}

/** GET /api/v1/reviews/pending → apps[] 条目 */
export interface PendingReviewApp {
  id: number;
  name: string;
  submitter?: string;
  /** 提交人（作者/owner）用户ID，自审判定用 */
  user_id?: number | null;
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

/** GET /api/v1/reviews/log 的 target_type 参数 */
export type ReviewTargetType = "skill" | "app";

/** GET /api/v1/reviews/log → items[] 条目（created_at 倒序 ≤50 条） */
export interface ReviewLogItem {
  id: number;
  /** submit | approve | reject | self_publish；未知值 UI 原样展示 */
  action: string;
  /** 审核意见；驳回理由在此 */
  comment: string | null;
  actor_id: number | null;
  /** 执行人显示名；查无此人为 null（UI 退「审核员」） */
  actor_name: string | null;
  created_at: string | null;
}

export type { ReviewStatus };
