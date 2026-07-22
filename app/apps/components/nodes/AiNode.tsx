"use client";

import React from "react";
import { NodeProps } from "reactflow";
import BaseNode from "./BaseNode";
import { useTranslations } from "next-intl";

export default function AiNode({ data }: NodeProps) {
  const t = useTranslations("workflow");

  return (
    <BaseNode
      title={t("aiNode")}
      handles={{ source: true, target: true, refTarget: true, refSource: false }}
      minWidth={120}
    >
      {/* 智能体名称展示 */}
      <div className="mb-0.5">
        <div className="text-[9px] text-muted-foreground mb-0.5">{t("agentType")}</div>
        <div className="rounded px-1.5 py-0.5 bg-primary/10 text-primary font-medium text-[10px] text-center">
          {data.name || t("chatAgent")}
        </div>
      </div>

      {/* AI 模型 */}
      {data.aiModel && (
        <div>
          <div className="text-[9px] text-muted-foreground mb-0.5">{t("aiModel")}</div>
          <div className="rounded px-1.5 py-0.5 bg-purple-50 text-purple-700 font-medium text-[10px] text-center capitalize">
            {data.aiModel}
          </div>
        </div>
      )}
    </BaseNode>
  );
}
