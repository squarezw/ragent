"use client";

import React, { useState, useCallback, useEffect, useRef } from "react";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { Textarea } from "@/components/ui/textarea";
import { X } from "lucide-react";
import { WorkflowNode } from "@/types/workflow";
import { Button } from "@/components/ui/button";
import { useTranslations } from "next-intl";

interface NodePropertyPanelProps {
  selectedNode: WorkflowNode | null;
  datasets: Array<{ id: string; name: string }>;
  onUpdate: (node: WorkflowNode) => void;
  onClose: () => void;
}

// Node type labels mapping (translation keys)
const nodeTypeLabelKeys: Record<string, string> = {
  inputNode: "inputNodeLabel",
  aiNode: "aiNodeLabel",
  knowledgeNode: "knowledgeNodeLabel",
  outputNode: "outputNodeLabel",
  conditionNode: "conditionNodeLabel",
  toolNode: "toolNodeLabel",
  humanNode: "humanNodeLabel",
  systemNode: "systemNodeLabel",
  variableNode: "variableNodeLabel",
};

// Node default names mapping (translation keys)
const nodeDefaultNameKeys: Record<string, string> = {
  inputNode: "inputNodeLabel",
  aiNode: "aiNode",
  knowledgeNode: "knowledgeNode",
  outputNode: "outputNodeLabel",
  conditionNode: "conditionNode",
  toolNode: "toolNode",
  humanNode: "humanProcess",
  systemNode: "systemIntegration",
  variableNode: "variable",
};

export default function NodePropertyPanel({
  selectedNode,
  datasets,
  onUpdate,
  onClose,
}: NodePropertyPanelProps) {
  const t = useTranslations("workflow");
  const [localData, setLocalData] = useState<any>(null);
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);

  // 当选中节点变化时，更新本地数据
  useEffect(() => {
    if (selectedNode) {
      setLocalData({ ...selectedNode.data });
    }
  }, [selectedNode]);

  // 清理定时器
  useEffect(() => {
    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, []);

  const getDefaultNodeName = useCallback(
    (type: string): string => {
      const key = nodeDefaultNameKeys[type] || "newNode";
      return t(key);
    },
    [t]
  );

  const getNodeTypeLabel = useCallback(
    (type: string): string => {
      const key = nodeTypeLabelKeys[type] || "unknownNode";
      return t(key);
    },
    [t]
  );

  const handleDataChange = useCallback(
    (key: string, value: any) => {
      // 更新本地数据，确保保留所有现有数据
      const newData = {
        ...localData,
        [key]: value,
      };

      // 如果更新的是name字段且为空，则使用默认名称
      if (key === "name" && (!value || value.trim() === "") && selectedNode) {
        newData.name = getDefaultNodeName(selectedNode.type);
      }

      // 如果更新的是datasetIds字段，同步更新datasets字段
      if (key === "datasetIds" && selectedNode?.type === "knowledgeNode") {
        const datasetNames = (value || [])
          .map((id: string) => datasets.find((d) => d.id === id)?.name)
          .filter(Boolean);
        newData.datasets = datasetNames;
      }

      setLocalData(newData);

      // 清除之前的定时器
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }

      // 防抖更新，避免频繁调用
      timeoutRef.current = setTimeout(() => {
        if (selectedNode) {
          // 确保更新时保留所有节点属性，只更新data部分
          onUpdate({
            ...selectedNode,
            data: {
              ...selectedNode.data, // 保留原有的所有data字段
              ...newData, // 应用新的更改
            },
          });
        }
      }, 300);
    },
    [selectedNode, onUpdate, datasets, getDefaultNodeName]
  );

  if (!selectedNode || !localData) {
    return (
      <div className="w-80 bg-card border-l p-4">
        <div className="flex items-center justify-center h-full text-sm text-muted-foreground">
          {t("selectNodeToView")}
        </div>
      </div>
    );
  }

  return (
    <div className="w-80 bg-card border-l flex flex-col h-full">
      {/* 头部 */}
      <div className="p-4 border-b flex items-center justify-between">
        <div>
          <h3 className="font-semibold text-sm">{t("nodeProperties")}</h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            {getNodeTypeLabel(selectedNode.type)}
          </p>
        </div>
        <Button variant="ghost" size="icon" onClick={onClose} className="h-6 w-6">
          <X className="h-4 w-4" />
        </Button>
      </div>

      {/* 属性面板内容 */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {/* 通用属性：名称 */}
        <div className="space-y-2">
          <Label className="text-xs">{t("nodeName")}</Label>
          <Input
            value={localData.name || ""}
            onChange={(e) => handleDataChange("name", e.target.value)}
            onKeyDown={(e) => e.stopPropagation()}
            placeholder={t("nodeNamePlaceholder")}
            className="text-sm"
          />
        </div>

        {/* AI节点特定属性 */}
        {selectedNode.type === "aiNode" && (
          <>
            <div className="space-y-2">
              <Label className="text-xs">{t("aiModel")}</Label>
              <Select
                value={localData.aiModel || "deepseek"}
                onValueChange={(value) => handleDataChange("aiModel", value)}
              >
                <SelectTrigger className="text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="deepseek">Deepseek</SelectItem>
                  <SelectItem value="qwen">Qwen</SelectItem>
                  <SelectItem value="openai">OpenAI</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label className="text-xs">
                {t("temperature")}: {localData.temperature?.toFixed(1) || "0.7"}
              </Label>
              <Slider
                value={[localData.temperature || 0.7]}
                onValueChange={(value) => handleDataChange("temperature", value[0])}
                min={0}
                max={2}
                step={0.1}
                className="w-full"
              />
              <p className="text-[10px] text-muted-foreground">{t("temperatureDesc")}</p>
            </div>

            <div className="space-y-2">
              <Label className="text-xs">{t("maxTokens")}</Label>
              <Input
                type="number"
                value={localData.maxTokens || 2000}
                onChange={(e) => handleDataChange("maxTokens", parseInt(e.target.value))}
                onKeyDown={(e) => e.stopPropagation()}
                min={1}
                max={32000}
                className="text-sm"
              />
            </div>

            <div className="space-y-2">
              <Label className="text-xs">{t("systemPrompt")}</Label>
              <Textarea
                value={localData.systemPrompt || ""}
                onChange={(e) => handleDataChange("systemPrompt", e.target.value)}
                onKeyDown={(e) => e.stopPropagation()}
                placeholder={t("systemPromptPlaceholder")}
                rows={4}
                className="text-sm"
              />
            </div>
          </>
        )}

        {/* 知识库节点特定属性 */}
        {selectedNode.type === "knowledgeNode" && (
          <>
            <div className="space-y-2">
              <Label className="text-xs">{t("selectDatasets")}</Label>
              <div className="border rounded-md p-2 max-h-40 overflow-y-auto space-y-1.5">
                {datasets.length === 0 ? (
                  <p className="text-xs text-muted-foreground">{t("noAvailableDatasets")}</p>
                ) : (
                  datasets.map((dataset) => (
                    <div key={dataset.id} className="flex items-center space-x-2">
                      <input
                        type="checkbox"
                        id={`dataset-prop-${dataset.id}`}
                        checked={(localData.datasetIds || []).includes(dataset.id)}
                        onChange={(e) => {
                          const currentIds = localData.datasetIds || [];
                          const newIds = e.target.checked
                            ? [...currentIds, dataset.id]
                            : currentIds.filter((id: string) => id !== dataset.id);
                          handleDataChange("datasetIds", newIds);
                        }}
                        className="rounded"
                      />
                      <label
                        htmlFor={`dataset-prop-${dataset.id}`}
                        className="text-xs cursor-pointer flex-1"
                      >
                        {dataset.name}
                      </label>
                    </div>
                  ))
                )}
              </div>
              <p className="text-[10px] text-muted-foreground">
                {t("datasetsSelected", { count: (localData.datasetIds || []).length })}
              </p>
            </div>

            <div className="space-y-2">
              <Label className="text-xs">{t("retrievalMode")}</Label>
              <Select
                value={localData.retrievalMode || "hybrid"}
                onValueChange={(value) => handleDataChange("retrievalMode", value)}
              >
                <SelectTrigger className="text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="vector">{t("vectorRetrieval")}</SelectItem>
                  <SelectItem value="keyword">{t("keywordRetrieval")}</SelectItem>
                  <SelectItem value="hybrid">{t("hybridRetrieval")}</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label className="text-xs">TopK</Label>
              <Input
                type="number"
                value={localData.topK || 5}
                onChange={(e) => handleDataChange("topK", parseInt(e.target.value))}
                onKeyDown={(e) => e.stopPropagation()}
                min={1}
                max={20}
                className="text-sm"
              />
              <p className="text-[10px] text-muted-foreground">{t("topKDesc")}</p>
            </div>

            <div className="space-y-2">
              <Label className="text-xs">
                {t("similarityThreshold")}: {localData.similarityThreshold?.toFixed(2) || "0.70"}
              </Label>
              <Slider
                value={[localData.similarityThreshold || 0.7]}
                onValueChange={(value) => handleDataChange("similarityThreshold", value[0])}
                min={0}
                max={1}
                step={0.05}
                className="w-full"
              />
            </div>
          </>
        )}

        {/* 输入节点特定属性 */}
        {selectedNode.type === "inputNode" && (
          <>
            <div className="space-y-2">
              <Label className="text-xs">{t("platform")}</Label>
              <Select
                value={localData.platform || "Web"}
                onValueChange={(value) => handleDataChange("platform", value)}
              >
                <SelectTrigger className="text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="Web">Web</SelectItem>
                  <SelectItem value="Wechat">
                    {t("wechatInput").replace(" 输入", "").replace(" Input", "")}
                  </SelectItem>
                  <SelectItem value="Feishu">
                    {t("feishuInput").replace(" 输入", "").replace(" Input", "")}
                  </SelectItem>
                  <SelectItem value="iOS">iOS</SelectItem>
                  <SelectItem value="Android">Android</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label className="text-xs">{t("inputType")}</Label>
              <Select
                value={localData.inputType || "text"}
                onValueChange={(value) => handleDataChange("inputType", value)}
              >
                <SelectTrigger className="text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="text">{t("text")}</SelectItem>
                  <SelectItem value="voice">{t("voice")}</SelectItem>
                  <SelectItem value="image">{t("image")}</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </>
        )}

        {/* 输出节点特定属性 */}
        {selectedNode.type === "outputNode" && (
          <>
            <div className="space-y-2">
              <Label className="text-xs">{t("platform")}</Label>
              <Select
                value={localData.platform || "Web"}
                onValueChange={(value) => handleDataChange("platform", value)}
              >
                <SelectTrigger className="text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="Web">Web</SelectItem>
                  <SelectItem value="Wechat">
                    {t("wechatOutput").replace(" 输出", "").replace(" Output", "")}
                  </SelectItem>
                  <SelectItem value="Feishu">
                    {t("feishuOutput").replace(" 输出", "").replace(" Output", "")}
                  </SelectItem>
                  <SelectItem value="iOS">iOS</SelectItem>
                  <SelectItem value="Android">Android</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label className="text-xs">{t("outputFormat")}</Label>
              <Select
                value={localData.format || "text"}
                onValueChange={(value) => handleDataChange("format", value)}
              >
                <SelectTrigger className="text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="text">{t("plainText")}</SelectItem>
                  <SelectItem value="markdown">Markdown</SelectItem>
                  <SelectItem value="json">JSON</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </>
        )}

        {/* 条件节点（暂时简化） */}
        {selectedNode.type === "conditionNode" && (
          <div className="space-y-2">
            <Label className="text-xs">{t("conditionExpression")}</Label>
            <Textarea
              value={localData.condition || ""}
              onChange={(e) => handleDataChange("condition", e.target.value)}
              onKeyDown={(e) => e.stopPropagation()}
              placeholder={t("conditionPlaceholder")}
              rows={3}
              className="text-sm"
            />
            <p className="text-[10px] text-muted-foreground">{t("conditionExample")}</p>
          </div>
        )}

        {/* 工具节点（暂时简化） */}
        {selectedNode.type === "toolNode" && (
          <>
            <div className="space-y-2">
              <Label className="text-xs">{t("toolType")}</Label>
              <Select
                value={localData.toolType || "api"}
                onValueChange={(value) => handleDataChange("toolType", value)}
              >
                <SelectTrigger className="text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="api">{t("apiCall")}</SelectItem>
                  <SelectItem value="function">{t("functionCall")}</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {localData.toolType === "api" && (
              <>
                <div className="space-y-2">
                  <Label className="text-xs">{t("apiEndpoint")}</Label>
                  <Input
                    value={localData.endpoint || ""}
                    onChange={(e) => handleDataChange("endpoint", e.target.value)}
                    onKeyDown={(e) => e.stopPropagation()}
                    placeholder="https://api.example.com/endpoint"
                    className="text-sm"
                  />
                </div>

                <div className="space-y-2">
                  <Label className="text-xs">{t("requestMethod")}</Label>
                  <Select
                    value={localData.method || "GET"}
                    onValueChange={(value) => handleDataChange("method", value)}
                  >
                    <SelectTrigger className="text-sm">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="GET">GET</SelectItem>
                      <SelectItem value="POST">POST</SelectItem>
                      <SelectItem value="PUT">PUT</SelectItem>
                      <SelectItem value="DELETE">DELETE</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}
