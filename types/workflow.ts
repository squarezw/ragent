/**
 * 工作流配置相关类型定义
 */

export interface WorkflowNode {
  id: string;
  type:
    | "inputNode"
    | "aiNode"
    | "knowledgeNode"
    | "outputNode"
    | "conditionNode"
    | "toolNode"
    | "variableNode";
  position: { x: number; y: number };
  data: Record<string, any>;
}

export interface WorkflowEdge {
  id: string;
  source: string;
  target: string;
  sourceHandle?: string;
  targetHandle?: string;
  type?: string;
  animated?: boolean;
  label?: string;
  style?: Record<string, any>;
  labelStyle?: Record<string, any>;
}

export interface WorkflowConfig {
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
  version: string;
}

// 扩展的App类型，包含工作流配置
export interface AppWithWorkflow {
  id: number;
  name: string;
  description: string;
  // 触发方式（列名沿用 app_type）。Tool / Plugin 不再是可选项，仅兼容存量数据。
  app_type: "Chat" | "Subscription" | "Email" | "Custom" | "Tool" | "Plugin";
  platform: "Web" | "Wechat" | "Plugin" | "Feishu" | "iOS" | "Android";
  user_id: number;
  ai_model: string;
  dataset_ids: string[];
  settings: {
    wechat?: {
      agent_id: string;
      reply_type?: "text" | "mpnews" | "Markdown" | "file";
    };
    workflow?: WorkflowConfig;
    [key: string]: any;
  };
  created_at: string;
  updated_at: string;
}

// 节点类型定义
export type NodeType =
  | "inputNode"
  | "aiNode"
  | "knowledgeNode"
  | "outputNode"
  | "conditionNode"
  | "toolNode"
  | "variableNode";

export interface NodeTypeDefinition {
  type: NodeType;
  label: string;
  description: string;
  icon: string;
  defaultData: Record<string, any>;
}

// AI节点数据
export interface AiNodeData {
  name: string;
  aiModel: string;
  temperature?: number;
  maxTokens?: number;
  systemPrompt?: string;
  topP?: number;
  presencePenalty?: number;
  frequencyPenalty?: number;
}

// 知识库节点数据
export interface KnowledgeNodeData {
  name: string;
  datasetIds: string[];
  datasets?: string[];
  retrievalMode?: "vector" | "keyword" | "hybrid";
  topK?: number;
  similarityThreshold?: number;
}

// 输入节点数据
export interface InputNodeData {
  name: string;
  platform: string;
  inputType?: "text" | "voice" | "image";
}

// 输出节点数据
export interface OutputNodeData {
  name: string;
  platform: string;
  format?: "text" | "markdown" | "json";
}

// 条件节点数据
export interface ConditionNodeData {
  name: string;
  condition: string;
  branches: Array<{
    label: string;
    condition: string;
  }>;
}

// 工具节点数据
export interface ToolNodeData {
  name: string;
  toolType: "api" | "function";
  endpoint?: string;
  method?: "GET" | "POST" | "PUT" | "DELETE";
  headers?: Record<string, string>;
  body?: string;
}
