"use client";

import React, { useState, useCallback, useRef, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import ReactFlow, {
  Background,
  Controls,
  useNodesState,
  useEdgesState,
  addEdge,
  Connection,
  Edge,
  Node,
  MarkerType,
} from "reactflow";
import "reactflow/dist/style.css";
import { toast } from "sonner";
import { Loader2, Save, X } from "lucide-react";
import { useTranslations } from "next-intl";

import InputNode from "./nodes/InputNode";
import AiNode from "./nodes/AiNode";
import OutputNode from "./nodes/OutputNode";
import KnowledgeNode from "./nodes/KnowledgeNode";
import ConditionNode from "./nodes/ConditionNode";
import ToolNode from "./nodes/ToolNode";
import HumanNode from "./nodes/HumanNode";
import SystemNode from "./nodes/SystemNode";
import NodePalette from "./NodePalette";
import NodePropertyPanel from "./NodePropertyPanel";

import { WorkflowConfig, WorkflowNode, AppWithWorkflow } from "@/types/workflow";
import {
  generateDefaultWorkflow,
  generateNodeId,
  generateEdgeId,
  calculateNodePosition,
  validateWorkflow,
} from "@/lib/workflowUtils";

// 节点类型映射
const nodeTypes = {
  inputNode: InputNode,
  aiNode: AiNode,
  outputNode: OutputNode,
  knowledgeNode: KnowledgeNode,
  conditionNode: ConditionNode,
  toolNode: ToolNode,
  humanNode: HumanNode,
  systemNode: SystemNode,
};

interface WorkflowEditorProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  app: AppWithWorkflow | null;
  datasets: { id: string; name: string }[];
  onSave: (workflow: WorkflowConfig) => Promise<void>;
  isSuperAdmin?: boolean;
}

export default function WorkflowEditor({
  open,
  onOpenChange,
  app,
  datasets,
  onSave,
  isSuperAdmin = false,
}: WorkflowEditorProps) {
  const t = useTranslations("workflow");
  const tc = useTranslations("common");
  const [nodes, setNodes, onNodesChange] = useNodesState([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState([]);
  const [selectedNode, setSelectedNode] = useState<WorkflowNode | null>(null);
  const [saving, setSaving] = useState(false);
  const reactFlowWrapper = useRef<HTMLDivElement>(null);
  const [reactFlowInstance, setReactFlowInstance] = useState<any>(null);

  // 初始化工作流
  useEffect(() => {
    if (open && app) {
      const workflow = app.settings?.workflow || generateDefaultWorkflow(app);

      setNodes(workflow.nodes as Node[]);
      setEdges(workflow.edges as Edge[]);
      setSelectedNode(null);
    }
  }, [open, app, datasets]);

  // 处理节点拖拽添加
  const onDrop = useCallback(
    (event: React.DragEvent) => {
      event.preventDefault();

      const type = event.dataTransfer.getData("application/reactflow");
      if (!type || !reactFlowInstance) {
        return;
      }

      const position = reactFlowInstance.screenToFlowPosition({
        x: event.clientX,
        y: event.clientY,
      });

      const newNodeId = generateNodeId(type);
      const newNode: WorkflowNode = {
        id: newNodeId,
        type: type as any,
        position,
        data: getDefaultNodeData(type, t),
      };

      setNodes((nds) => nds.concat(newNode as Node));
      toast.success(t("nodeAdded"));
    },
    [reactFlowInstance, setNodes, t]
  );

  const onDragOver = useCallback((event: React.DragEvent) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
  }, []);

  // 处理连线
  const onConnect = useCallback(
    (connection: Connection) => {
      const edge: Edge = {
        ...connection,
        id: generateEdgeId(connection.source!, connection.target!),
        type: "default",
        animated: connection.sourceHandle !== "ref-out",
        markerEnd: {
          type: MarkerType.ArrowClosed,
        },
      };

      setEdges((eds) => addEdge(edge, eds));
      toast.success(t("connectionEstablished"));
    },
    [setEdges, t]
  );

  // 处理节点点击选择
  const onNodeClick = useCallback((event: React.MouseEvent, node: Node) => {
    setSelectedNode(node as WorkflowNode);
  }, []);

  // 处理画布点击（取消选择）
  const onPaneClick = useCallback(() => {
    setSelectedNode(null);
  }, []);

  // 更新选中节点的属性
  const onNodeUpdate = useCallback(
    (updatedNode: WorkflowNode) => {
      setNodes((nds) =>
        nds.map((node) => (node.id === updatedNode.id ? (updatedNode as Node) : node))
      );
      setSelectedNode(updatedNode);
    },
    [setNodes]
  );

  // 删除选中节点
  const onDeleteNode = useCallback(() => {
    if (!selectedNode) return;

    setNodes((nds) => nds.filter((node) => node.id !== selectedNode.id));
    setEdges((eds) =>
      eds.filter((edge) => edge.source !== selectedNode.id && edge.target !== selectedNode.id)
    );
    setSelectedNode(null);
    toast.success(t("nodeDeleted"));
  }, [selectedNode, setNodes, setEdges, t]);

  // 保存工作流
  const handleSave = useCallback(async () => {
    const workflow: WorkflowConfig = {
      nodes: nodes as WorkflowNode[],
      edges: edges.map((e) => ({
        id: e.id,
        source: e.source,
        target: e.target,
        sourceHandle: e.sourceHandle || undefined,
        targetHandle: e.targetHandle || undefined,
        type: e.type,
        animated: e.animated,
        label: e.label as string | undefined,
        style: e.style,
        labelStyle: e.labelStyle,
      })),
      version: "1.0",
    };

    // 验证工作流
    const validation = validateWorkflow(workflow);
    if (!validation.valid) {
      toast.error(`${t("workflowValidationFailed")}: ${validation.errors.join(", ")}`);
      return;
    }

    try {
      setSaving(true);
      await onSave(workflow);
      toast.success(t("workflowSaved"));
      onOpenChange(false);
    } catch (error: any) {
      toast.error(error.message || t("saveFailed"));
    } finally {
      setSaving(false);
    }
  }, [nodes, edges, onSave, onOpenChange, t]);

  // 键盘快捷键
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      // 检查焦点是否在输入框、文本区域或其他可编辑元素中
      const activeElement = document.activeElement;
      const isInputFocused =
        activeElement &&
        (activeElement.tagName === "INPUT" ||
          activeElement.tagName === "TEXTAREA" ||
          activeElement.contentEditable === "true" ||
          activeElement.getAttribute("role") === "textbox");

      // Delete/Backspace 删除节点（仅在非输入框焦点时）
      if (
        (event.key === "Delete" || event.key === "Backspace") &&
        selectedNode &&
        !isInputFocused
      ) {
        event.preventDefault();
        onDeleteNode();
      }
      // Cmd/Ctrl + S 保存（仅超级管理员）
      if ((event.metaKey || event.ctrlKey) && event.key === "s" && isSuperAdmin) {
        event.preventDefault();
        handleSave();
      }
    };

    if (open) {
      window.addEventListener("keydown", handleKeyDown);
      return () => window.removeEventListener("keydown", handleKeyDown);
    }
  }, [open, selectedNode, onDeleteNode, handleSave, isSuperAdmin]);

  if (!app) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[95vw] max-h-[95vh] h-[900px] flex flex-col p-0">
        <DialogHeader className="px-6 py-4 border-b">
          <div className="flex items-center justify-between">
            <div>
              <DialogTitle>
                {t("workflowEditor")} - {app.name}
              </DialogTitle>
              <p className="text-sm text-muted-foreground mt-1">{t("editorDesc")}</p>
            </div>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>
                <X className="h-4 w-4 mr-1" />
                {tc("cancel")}
              </Button>
              {isSuperAdmin && (
                <Button size="sm" onClick={handleSave} disabled={saving}>
                  {saving ? (
                    <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                  ) : (
                    <Save className="h-4 w-4 mr-1" />
                  )}
                  {tc("save")}
                </Button>
              )}
            </div>
          </div>
        </DialogHeader>

        <div className="flex flex-1 overflow-hidden">
          {/* 节点工具栏 */}
          <NodePalette />

          {/* 工作流画布 */}
          <div className="flex-1 relative" ref={reactFlowWrapper}>
            <ReactFlow
              nodes={nodes}
              edges={edges}
              onNodesChange={onNodesChange}
              onEdgesChange={onEdgesChange}
              onConnect={onConnect}
              onNodeClick={onNodeClick}
              onPaneClick={onPaneClick}
              onInit={setReactFlowInstance}
              onDrop={onDrop}
              onDragOver={onDragOver}
              nodeTypes={nodeTypes}
              fitView
              fitViewOptions={{ padding: 0.2 }}
              defaultViewport={{ x: 0, y: 0, zoom: 0.8 }}
              minZoom={0.2}
              maxZoom={2}
              className="bg-muted"
            >
              <Background />
              <Controls />
            </ReactFlow>

            {/* 提示信息 */}
            {nodes.length === 0 && (
              <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                <div className="bg-card/90 backdrop-blur-sm rounded-lg shadow-lg p-6 max-w-md text-center">
                  <h3 className="font-semibold text-lg mb-2">{t("startBuildWorkflow")}</h3>
                  <p className="text-sm text-muted-foreground mb-4">
                    {t("startBuildWorkflowDesc")}
                  </p>
                  <div className="text-xs text-muted-foreground space-y-1">
                    <p>💡 {t("clickToEditTip")}</p>
                    <p>💡 {t("deleteTip")}</p>
                    {isSuperAdmin && <p>💡 {t("saveShortcutTip")}</p>}
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* 节点属性面板 */}
          <NodePropertyPanel
            selectedNode={selectedNode}
            datasets={datasets}
            onUpdate={onNodeUpdate}
            onClose={() => setSelectedNode(null)}
          />
        </div>

        {/* 底部状态栏 */}
        <div className="px-6 py-2 border-t bg-muted text-xs text-muted-foreground flex items-center justify-between">
          <div className="flex items-center gap-4">
            <span>
              {t("nodesCount")}: {nodes.length}
            </span>
            <span>
              {t("connectionsCount")}: {edges.length}
            </span>
            {selectedNode && (
              <span className="text-primary">
                {t("selected")}: {selectedNode.data.name || selectedNode.type}
              </span>
            )}
          </div>
          <div className="text-gray-400">{t("workflowVersion")} 1.0</div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// 获取节点默认数据
function getDefaultNodeData(type: string, t: (key: string) => string): Record<string, any> {
  const defaults: Record<string, any> = {
    inputNode: {
      name: t("webInput"),
      platform: "Web",
      inputType: "text",
    },
    aiNode: {
      name: t("chatAgent"),
      aiModel: "deepseek",
      temperature: 0.7,
      maxTokens: 2000,
    },
    knowledgeNode: {
      name: t("knowledgeNode"),
      datasetIds: [],
      retrievalMode: "hybrid",
      topK: 5,
      similarityThreshold: 0.7,
    },
    outputNode: {
      name: t("webOutput"),
      platform: "Web",
      format: "text",
    },
    conditionNode: {
      name: t("conditionNode"),
      condition: "",
    },
    toolNode: {
      name: t("toolNode"),
      toolType: "api",
      method: "GET",
    },
    humanNode: {
      name: t("humanProcess"),
      operator: t("operator"),
      detail: t("humanProcess"),
    },
    systemNode: {
      name: t("systemIntegration"),
      systemType: "database",
      operation: t("operation"),
    },
  };

  return defaults[type] || { name: t("newNode") };
}
