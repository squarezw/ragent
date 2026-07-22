/**
 * 工作流配置工具函数
 * 提供表单和工作流之间的双向转换
 */

import { WorkflowConfig, WorkflowNode, WorkflowEdge, AppWithWorkflow } from "@/types/workflow";

/**
 * 从App配置生成默认工作流
 */
export const generateDefaultWorkflow = (app: Partial<AppWithWorkflow>): WorkflowConfig => {
  const nodes: WorkflowNode[] = [];
  const edges: WorkflowEdge[] = [];

  const hasKnowledgeBase = app.dataset_ids && app.dataset_ids.length > 0;

  // 1. 输入节点
  nodes.push({
    id: "input-1",
    type: "inputNode",
    position: { x: 50, y: 150 },
    data: {
      name: getPlatformName(app.platform || "Web"),
      platform: app.platform || "Web",
    },
  });

  // 2. AI 会话智能体节点
  nodes.push({
    id: "ai-1",
    type: "aiNode",
    position: { x: 250, y: 150 },
    data: {
      name: "会话智能体",
      aiModel: app.ai_model || "deepseek",
      temperature: 0.7,
      maxTokens: 2000,
    },
  });

  // 边：输入 -> AI
  edges.push({
    id: "e-input-ai",
    source: "input-1",
    target: "ai-1",
    sourceHandle: "out",
    targetHandle: "in",
    animated: true,
  });

  // 3. 知识库节点（可选）
  if (hasKnowledgeBase) {
    nodes.push({
      id: "knowledge-1",
      type: "knowledgeNode",
      position: { x: 250, y: 280 },
      data: {
        name: "知识库",
        datasetIds: app.dataset_ids || [],
        topK: 5,
        similarityThreshold: 0.7,
      },
    });

    // 边：知识库 -> AI（引用关系）
    edges.push({
      id: "e-knowledge-ai",
      source: "knowledge-1",
      target: "ai-1",
      sourceHandle: "out",
      targetHandle: "ref-in",
      type: "default",
      style: { stroke: "#a855f7", strokeDasharray: "5,5", strokeWidth: 2 },
      label: "知识库参考",
      labelStyle: { fontSize: 10, fill: "#a855f7" },
    });
  }

  // 4. 输出节点
  nodes.push({
    id: "output-1",
    type: "outputNode",
    position: { x: 470, y: 150 },
    data: {
      name: getPlatformOutputName(app.platform || "Web"),
      platform: app.platform || "Web",
    },
  });

  // 边：AI -> 输出
  edges.push({
    id: "e-ai-output",
    source: "ai-1",
    target: "output-1",
    sourceHandle: "out",
    targetHandle: "in",
    animated: true,
  });

  return {
    nodes,
    edges,
    version: "1.0",
  };
};

/**
 * 从工作流配置同步到表单数据
 */
export const syncWorkflowToForm = (workflow: WorkflowConfig): Partial<AppWithWorkflow> => {
  const aiNode = workflow.nodes.find((n) => n.type === "aiNode");
  const knowledgeNode = workflow.nodes.find((n) => n.type === "knowledgeNode");
  const inputNode = workflow.nodes.find((n) => n.type === "inputNode");

  return {
    ai_model: aiNode?.data.aiModel,
    dataset_ids: knowledgeNode?.data.datasetIds || [],
    platform: inputNode?.data.platform,
  };
};

/**
 * 从表单数据同步到工作流配置
 */
export const syncFormToWorkflow = (
  app: Partial<AppWithWorkflow>,
  existingWorkflow?: WorkflowConfig,
  datasets?: { id: string; name: string }[]
): WorkflowConfig => {
  // 如果已有工作流，更新节点属性
  if (existingWorkflow) {
    const workflow = JSON.parse(JSON.stringify(existingWorkflow)); // 深拷贝

    // 更新 AI 节点
    const aiNode = workflow.nodes.find((n: WorkflowNode) => n.type === "aiNode");
    if (aiNode && app.ai_model) {
      aiNode.data.aiModel = app.ai_model;
    }

    // 处理知识库节点和数据集的同步
    const hasDatasets = app.dataset_ids && app.dataset_ids.length > 0;
    const knowledgeNodeIndex = workflow.nodes.findIndex(
      (n: WorkflowNode) => n.type === "knowledgeNode"
    );
    const aiNodeObj = workflow.nodes.find((n: WorkflowNode) => n.type === "aiNode");

    if (hasDatasets) {
      // 如果表单有数据集
      if (knowledgeNodeIndex >= 0) {
        // 更新现有知识库节点
        workflow.nodes[knowledgeNodeIndex].data.datasetIds = app.dataset_ids;
        // 同步更新 datasets 字段
        if (datasets) {
          const datasetNames = (app.dataset_ids || [])
            .map((id: string) => datasets.find((d) => d.id === id)?.name)
            .filter(Boolean);
          workflow.nodes[knowledgeNodeIndex].data.datasets = datasetNames;
        }
      } else if (aiNodeObj) {
        // 自动添加知识库节点
        const datasetNames = datasets
          ? (app.dataset_ids || [])
              .map((id: string) => datasets.find((d) => d.id === id)?.name)
              .filter(Boolean)
          : [];

        const newKnowledgeNode: WorkflowNode = {
          id: "knowledge-1",
          type: "knowledgeNode",
          position: { x: aiNodeObj.position.x, y: aiNodeObj.position.y + 130 },
          data: {
            name: "知识库",
            datasetIds: app.dataset_ids,
            datasets: datasetNames,
            topK: 5,
            similarityThreshold: 0.7,
          },
        };
        workflow.nodes.push(newKnowledgeNode);

        // 添加连接线：知识库 -> AI
        const edgeExists = workflow.edges.some(
          (e: any) => e.source === "knowledge-1" && e.target === aiNodeObj.id
        );
        if (!edgeExists) {
          workflow.edges.push({
            id: "e-knowledge-ai",
            source: "knowledge-1",
            target: aiNodeObj.id,
            sourceHandle: "out",
            targetHandle: "ref-in",
            type: "default",
            style: { stroke: "#a855f7", strokeDasharray: "5,5", strokeWidth: 2 },
            label: "知识库参考",
            labelStyle: { fontSize: 10, fill: "#a855f7" },
          });
        }
      }
    } else {
      // 如果表单没有数据集，删除知识库节点
      if (knowledgeNodeIndex >= 0) {
        const knowledgeNodeId = workflow.nodes[knowledgeNodeIndex].id;
        // 删除节点
        workflow.nodes.splice(knowledgeNodeIndex, 1);
        // 删除相关的连接线
        workflow.edges = workflow.edges.filter(
          (e: any) => e.source !== knowledgeNodeId && e.target !== knowledgeNodeId
        );
      }
    }

    // 更新输入输出节点的平台
    const inputNode = workflow.nodes.find((n: WorkflowNode) => n.type === "inputNode");
    if (inputNode && app.platform) {
      inputNode.data.platform = app.platform;
      inputNode.data.name = getPlatformName(app.platform);
    }

    const outputNode = workflow.nodes.find((n: WorkflowNode) => n.type === "outputNode");
    if (outputNode && app.platform) {
      outputNode.data.platform = app.platform;
      outputNode.data.name = getPlatformOutputName(app.platform);
    }

    return workflow;
  }

  // 否则生成默认工作流
  return generateDefaultWorkflow(app);
};

/**
 * 验证工作流配置的完整性
 */
export const validateWorkflow = (
  workflow: WorkflowConfig
): { valid: boolean; errors: string[] } => {
  const errors: string[] = [];

  // 必须有输入节点
  const hasInput = workflow.nodes.some((n) => n.type === "inputNode");
  if (!hasInput) {
    errors.push("工作流必须包含至少一个输入节点");
  }

  // 必须有输出节点
  const hasOutput = workflow.nodes.some((n) => n.type === "outputNode");
  if (!hasOutput) {
    errors.push("工作流必须包含至少一个输出节点");
  }

  // 检查节点连接
  const nodeIds = new Set(workflow.nodes.map((n) => n.id));
  for (const edge of workflow.edges) {
    if (!nodeIds.has(edge.source)) {
      errors.push(`边 ${edge.id} 的源节点 ${edge.source} 不存在`);
    }
    if (!nodeIds.has(edge.target)) {
      errors.push(`边 ${edge.id} 的目标节点 ${edge.target} 不存在`);
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
};

// 辅助函数：根据平台获取输入节点名称
const getPlatformName = (platform: string): string => {
  const platformMap: Record<string, string> = {
    Web: "Web 输入",
    Wechat: "企微输入",
    Feishu: "飞书输入",
    iOS: "iOS 输入",
    Android: "Android 输入",
  };
  return platformMap[platform] || "Web 输入";
};

// 辅助函数：根据平台获取输出节点名称
const getPlatformOutputName = (platform: string): string => {
  const platformMap: Record<string, string> = {
    Web: "Web 输出",
    Wechat: "企微输出",
    Feishu: "飞书输出",
    iOS: "iOS 输出",
    Android: "Android 输出",
  };
  return platformMap[platform] || "Web 输出";
};

/**
 * 生成新节点ID
 */
export const generateNodeId = (type: string): string => {
  const timestamp = Date.now();
  const random = Math.floor(Math.random() * 1000);
  return `${type}-${timestamp}-${random}`;
};

/**
 * 生成新边ID
 */
export const generateEdgeId = (source: string, target: string): string => {
  return `e-${source}-${target}`;
};

/**
 * 计算新节点的位置（简单的自动布局）
 */
export const calculateNodePosition = (
  existingNodes: WorkflowNode[],
  nodeType: string
): { x: number; y: number } => {
  // 如果没有现有节点，返回初始位置
  if (existingNodes.length === 0) {
    return { x: 100, y: 100 };
  }

  // 找到最右边的节点
  const maxX = Math.max(...existingNodes.map((n) => n.position.x));
  const maxY = Math.max(...existingNodes.map((n) => n.position.y));

  // 在右下方添加新节点
  return {
    x: maxX + 200,
    y: maxY + 50,
  };
};
