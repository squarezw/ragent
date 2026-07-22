"use client";

import React from "react";
import {
  Inbox,
  Brain,
  Database,
  Send,
  GitBranch,
  Wrench,
  Variable,
  User,
  Server,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { useTranslations } from "next-intl";
import { LucideIcon } from "lucide-react";

interface NodeTypeConfig {
  type: string;
  labelKey: string;
  icon: LucideIcon;
  descKey: string;
  color: string;
}

const nodeTypeConfigs: NodeTypeConfig[] = [
  {
    type: "inputNode",
    labelKey: "inputNode",
    icon: Inbox,
    descKey: "inputNodeDesc",
    color: "text-blue-600",
  },
  {
    type: "aiNode",
    labelKey: "aiNode",
    icon: Brain,
    descKey: "aiNodeDesc",
    color: "text-purple-600",
  },
  {
    type: "knowledgeNode",
    labelKey: "knowledgeNode",
    icon: Database,
    descKey: "knowledgeNodeDesc",
    color: "text-green-600",
  },
  {
    type: "outputNode",
    labelKey: "outputNode",
    icon: Send,
    descKey: "outputNodeDesc",
    color: "text-orange-600",
  },
  {
    type: "conditionNode",
    labelKey: "conditionNode",
    icon: GitBranch,
    descKey: "conditionNodeDesc",
    color: "text-yellow-600",
  },
  {
    type: "toolNode",
    labelKey: "toolNode",
    icon: Wrench,
    descKey: "toolNodeDesc",
    color: "text-red-600",
  },
  {
    type: "humanNode",
    labelKey: "humanNode",
    icon: User,
    descKey: "humanNodeDesc",
    color: "text-orange-600",
  },
  {
    type: "systemNode",
    labelKey: "systemNode",
    icon: Server,
    descKey: "systemNodeDesc",
    color: "text-green-600",
  },
];

export default function NodePalette() {
  const t = useTranslations("workflow");

  const onDragStart = (event: React.DragEvent, nodeType: string) => {
    event.dataTransfer.setData("application/reactflow", nodeType);
    event.dataTransfer.effectAllowed = "move";
  };

  return (
    <div className="w-48 bg-card border-r p-3 overflow-y-auto">
      <div className="mb-3">
        <h3 className="text-sm font-semibold text-foreground">{t("nodePalette")}</h3>
        <p className="text-xs text-muted-foreground mt-1">{t("dragToCanvas")}</p>
      </div>

      <div className="space-y-2">
        {nodeTypeConfigs.map((node) => (
          <Card
            key={node.type}
            className="p-2.5 cursor-move hover:shadow-md transition-shadow border"
            draggable
            onDragStart={(e) => onDragStart(e, node.type)}
          >
            <div className="flex items-center gap-2">
              <node.icon className={`h-4 w-4 ${node.color}`} />
              <div className="flex-1 min-w-0">
                <div className="text-xs font-medium text-foreground truncate">
                  {t(node.labelKey)}
                </div>
                <div className="text-[10px] text-muted-foreground truncate">{t(node.descKey)}</div>
              </div>
            </div>
          </Card>
        ))}
      </div>

      <div className="mt-4 pt-3 border-t">
        <p className="text-[10px] text-muted-foreground leading-relaxed">💡 {t("paletteTip")}</p>
      </div>
    </div>
  );
}
