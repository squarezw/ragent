"use client";

import React from "react";
import { NodeProps } from "reactflow";
import BaseNode from "./BaseNode";
import { useTranslations } from "next-intl";

export default function ConditionNode({ data }: NodeProps) {
  const t = useTranslations("workflow");

  return (
    <BaseNode title={t("conditionNode")} handles={{ source: true, target: true }} minWidth={120}>
      <div className="mb-0.5">
        <div className="text-[9px] text-muted-foreground mb-0.5">{t("nodeName")}</div>
        <div className="rounded px-1.5 py-0.5 bg-yellow-50 text-yellow-700 font-medium text-[10px] text-center">
          {data.name || t("conditionNode")}
        </div>
      </div>

      {data.condition && (
        <div>
          <div className="text-[9px] text-muted-foreground mb-0.5">{t("condition")}</div>
          <div
            className="rounded px-1.5 py-0.5 bg-muted text-muted-foreground text-[9px] truncate"
            title={data.condition}
          >
            {data.condition}
          </div>
        </div>
      )}
    </BaseNode>
  );
}
