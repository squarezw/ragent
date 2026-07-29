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
  /** P8a：是否带 exec 配置（可执行 skill） */
  executable?: boolean;
  /** P8a：draft stage 资产文件数 */
  asset_count?: number;
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

/** P8a 资产 kind（后端 VALID_ASSET_KINDS；未知值 UI 原样展示） */
export type SkillAssetKind = "script" | "reference" | "asset" | "data";

/** P8a 资产 draft vs published 变更类型 */
export type SkillAssetChange = "added" | "removed" | "modified" | "unchanged";

/** GET /api/v1/skills/{id}/diff → assets[] 条目（draft vs published 对照） */
export interface SkillAssetDiffItem {
  path: string;
  /** script | reference | asset | data；未知值原样展示 */
  kind: string;
  /** added | removed | modified | unchanged；未知值按 modified 保守标注 */
  change: SkillAssetChange;
  draft_sha256: string | null;
  published_sha256: string | null;
  draft_size: number | null;
  published_size: number | null;
  /** 脚本类小文本（≤64KB）的草稿内容，供文本对照 */
  draft_text: string | null;
  published_text: string | null;
}

/** GET /api/v1/skills/{id}/diff → exec_config_draft / exec_config_published */
export interface SkillExecConfigSummary {
  stage: string;
  /** name:tag（digest 锁版本时为 name@digest） */
  image: string;
  image_enabled: boolean;
  timeout_sec: number;
  writable_subdirs: string[];
  needs_llm: boolean;
  warm_pool: boolean;
  /** P8b per-run 网关调用上限覆盖；null = 全局默认 */
  llm_max_calls?: number | null;
  llm_max_total_tokens?: number | null;
  updated_at?: string | null;
}

/** GET /api/v1/skills/{id}/diff 响应 */
export interface SkillDiff {
  draft: string;
  published: string | null;
  /** P8a：资产清单对照；知识型 skill 为空数组 */
  assets: SkillAssetDiffItem[];
  exec_config_draft: SkillExecConfigSummary | null;
  exec_config_published: SkillExecConfigSummary | null;
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
