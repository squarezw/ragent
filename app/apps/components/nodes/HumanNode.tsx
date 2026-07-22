"use client";

import React from "react";
import { Handle, Position, NodeProps } from "reactflow";
import { User, Users } from "lucide-react";
import BaseNode from "./BaseNode";
import { useTranslations } from "next-intl";

export default function HumanNode({ data }: NodeProps) {
  const { name, operator, detail, phase } = data;
  const t = useTranslations("workflow");

  return (
    <BaseNode
      title={name}
      icon={operator ? Users : User}
      color="bg-orange-100 border-orange-300"
      iconColor="text-orange-600"
    >
      <Handle type="target" position={Position.Left} className="w-3 h-3 bg-orange-500" />
      <Handle type="source" position={Position.Right} className="w-3 h-3 bg-orange-500" />

      <div className="space-y-2">
        {operator && (
          <div className="text-xs text-orange-700 font-medium">
            {t("operator")}: {operator}
          </div>
        )}
        {phase && (
          <div className="text-xs text-orange-600">
            {t("phase")}: {phase}
          </div>
        )}
        {detail && <div className="text-xs text-muted-foreground line-clamp-2">{detail}</div>}
      </div>
    </BaseNode>
  );
}
