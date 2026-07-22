"use client";

import React from "react";
import { Handle, Position, NodeProps } from "reactflow";
import { Database, Server, Settings } from "lucide-react";
import BaseNode from "./BaseNode";
import { useTranslations } from "next-intl";

export default function SystemNode({ data }: NodeProps) {
  const { name, systemType, operation, detail } = data;
  const t = useTranslations("workflow");

  const getIcon = () => {
    if (systemType === "database" || name?.toLowerCase().includes("qms")) {
      return Database;
    }
    if (systemType === "server") {
      return Server;
    }
    return Settings;
  };

  const Icon = getIcon();

  return (
    <BaseNode
      title={name}
      icon={Icon}
      color="bg-green-100 border-green-300"
      iconColor="text-green-700"
    >
      <Handle type="target" position={Position.Left} className="w-3 h-3 bg-green-600" />
      <Handle type="source" position={Position.Right} className="w-3 h-3 bg-green-600" />

      <div className="space-y-2">
        {systemType && (
          <div className="text-xs text-green-700 font-medium">
            {t("systemType")}: {systemType}
          </div>
        )}
        {operation && (
          <div className="text-xs text-green-700">
            {t("operation")}: {operation}
          </div>
        )}
        {detail && <div className="text-xs text-muted-foreground line-clamp-2">{detail}</div>}
      </div>
    </BaseNode>
  );
}
