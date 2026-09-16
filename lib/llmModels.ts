/** 对话模型目录（与 ragent-service llm_models.code 对齐） */

export const DEFAULT_LLM_MODEL_CODE = "deepseek-flash";

export interface LlmModelOption {
  code: string;
  display_name: string;
}
