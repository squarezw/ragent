// Skills 架构类型定义（对齐后端 /api/v1/skills 契约）

export type SkillVisibility = "private" | "dept" | "tenant" | "public";

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
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

/** 应用-Skill 绑定行（GET /api/v1/apps/{appId}/skills，含 skill 摘要） */
export interface AppSkill {
  id: number;
  app_id: number;
  skill_id: number;
  priority: number;
  created_at?: string;
  updated_at?: string;
  // skill 摘要（后端可能平铺或嵌套，两种形状都兼容）
  skill_name?: string;
  skill_display_name?: string;
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
