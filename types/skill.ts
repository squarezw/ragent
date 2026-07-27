// Skills 架构类型定义（对齐后端 /api/v1/skills 契约）

import type { ReviewStatus } from "@/lib/reviewStatus";

export type SkillVisibility = "private" | "dept" | "tenant" | "public";

/** P5 审核状态（draft/pending_review/rejected/published），is_active 独立管启停 */
export type SkillStatus = ReviewStatus;

export interface SkillRequires {
  tools?: string[];
  workflows?: string[];
}

export interface Skill {
  id: number;
  name: string;
  display_name: string;
  description: string;
  /** 草稿正文 */
  content: string;
  /** 已发布正文；null = 从未发布 */
  published_content: string | null;
  requires: SkillRequires | null;
  visibility: SkillVisibility;
  /** 审核生命周期状态；后端并行开发中可能缺失，用 resolveReviewStatus 容错归一化 */
  status?: SkillStatus;
  is_active: boolean;
  /** 作者用户 ID，编辑权判定用 */
  user_id?: number | null;
  created_at: string;
  updated_at: string;
}

/** P8 资产 kind（后端 VALID_ASSET_KINDS） */
export type SkillAssetKind = "script" | "reference" | "asset" | "data";

/** GET /api/v1/skills/{id}/assets → items[] 条目（不含内容字节） */
export interface SkillAssetItem {
  /** skill 目录内相对路径，可含中文与空格 */
  path: string;
  kind: string;
  size_bytes: number;
  sha256: string;
  source_repo: string | null;
  source_commit: string | null;
  created_by_agent: boolean;
  updated_at: string | null;
}

/** GET /api/v1/skills/{id}/assets 响应 */
export interface SkillAssetList {
  stage: string;
  items: SkillAssetItem[];
  total: number;
  total_bytes: number;
}

/** GET|PUT /api/v1/skills/{id}/exec-config 响应 */
export interface SkillExecConfig {
  stage: string;
  entrypoint: string;
  /** name:tag（digest 锁版本时为 name@digest） */
  image: string;
  image_enabled: boolean;
  timeout_sec: number;
  writable_subdirs: string[];
  needs_llm: boolean;
  warm_pool: boolean;
  llm_max_calls: number | null;
  llm_max_total_tokens: number | null;
  updated_at: string | null;
}

/** PUT /api/v1/skills/{id}/exec-config 请求体（SkillExecConfigPayload） */
export interface SkillExecConfigPayload {
  entrypoint: string;
  image: string;
  timeout_sec: number;
  writable_subdirs: string[];
  needs_llm: boolean;
  warm_pool: boolean;
  llm_max_calls?: number | null;
  llm_max_total_tokens?: number | null;
}

/** GET /api/v1/sandbox-images → items[] 条目（取不到时前端降级为手工输入镜像名） */
export interface SandboxImage {
  id: number;
  name: string;
  tag: string;
  digest: string | null;
  is_enabled: boolean;
  description: string | null;
  /**
   * 展示用引用串：digest 非空为 `name@digest`，否则 `name:tag`。
   * 写 exec-config 时不能用它——见 sandboxImageValue。
   */
  ref: string;
}

/** requires.tools 的候选项（GET /api/v1/skills/requires-options → tools[]） */
export interface RequiresToolOption {
  /** 写进 requires.tools 的值 */
  name: string;
  display_name: string;
  /** native | mcp（后端只返这两类；未知值按 other 分区展示） */
  tool_type: string;
  category: string | null;
  description: string | null;
}

/** requires.workflows 的候选项（registry 注册的全部 kind，含停用） */
export interface RequiresWorkflowOption {
  /** 写进 requires.workflows 的值 */
  kind: string;
  display_name: string | null;
  description: string | null;
  /** false = 选了会导致 skill 不注入 */
  is_enabled: boolean;
}

/** GET /api/v1/skills/requires-options 响应 */
export interface RequiresOptions {
  tools: RequiresToolOption[];
  workflows: RequiresWorkflowOption[];
}

export type RequiresKind = "tool" | "workflow";

/** 一条依赖缺口；available / globally_enabled 两个 bool 决定修复动作 */
export interface SkillRequiresGap {
  name: string;
  kind: RequiresKind;
  available: boolean;
  tool_type: string | null;
  globally_enabled: boolean;
}

/** 单个已发布 skill 在该应用下的生效状态 */
export interface AppSkillDiagnosticItem {
  skill_id: number;
  skill_name: string;
  display_name: string | null;
  effective: boolean;
  /** null | missing_tools | missing_workflows（运行时先命中的那道门） */
  reason: string | null;
  /** 全部缺口（工具 + workflow 混在一起，靠 kind 分） */
  missing: SkillRequiresGap[];
}

/** GET /api/v1/apps/{appId}/skills/diagnostics 响应 */
export interface AppSkillDiagnostics {
  app_id: number;
  items: AppSkillDiagnosticItem[];
  total: number;
  effective_count: number;
  blocked_count: number;
}

/** 应用-Skill 绑定行（GET /api/v1/apps/{appId}/skills，含 skill 摘要） */
export interface AppSkill {
  id: number;
  app_id: number;
  skill_id: number;
  created_at?: string;
  updated_at?: string;
  // skill 摘要（后端可能平铺或嵌套，两种形状都兼容）
  skill_name?: string;
  skill_display_name?: string;
  display_name?: string;
  description?: string;
  published_content?: string | null;
  is_published?: boolean;
  skill?: Partial<Skill>;
}

/** GET /api/v1/apps/{appId}/agent-md 响应 */
export interface AgentMdResponse {
  content: string | null;
  frontmatter: Record<string, unknown> | null;
  is_legacy: boolean;
}

/** GET /api/v1/prompt-variables 条目（形状宽松，后端并行开发中） */
export interface PromptVariable {
  name: string;
  description?: string;
}
