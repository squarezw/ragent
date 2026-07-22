"use client";

import React from "react";
import { NodeProps } from "reactflow";
import BaseNode from "./BaseNode";
import { useTranslations } from "next-intl";

export default function ToolNode({ data }: NodeProps) {
  const t = useTranslations("workflow");

  return (
    <BaseNode title={t("toolNode")} handles={{ source: true, target: true }} minWidth={120}>
      <div className="mb-0.5">
        <div className="text-[9px] text-muted-foreground mb-0.5">{t("toolType")}</div>
        <div className="rounded px-1.5 py-0.5 bg-red-50 text-destructive font-medium text-[10px] text-center">
          {data.toolType === "api" ? t("apiCall") : t("functionCall")}
        </div>
      </div>

      {data.endpoint && (
        <div>
          <div className="text-[9px] text-muted-foreground mb-0.5">{t("endpoint")}</div>
          <div
            className="rounded px-1.5 py-0.5 bg-muted text-muted-foreground text-[9px] truncate"
            title={data.endpoint}
          >
            {data.endpoint}
          </div>
        </div>
      )}

      {data.method && (
        <div>
          <div className="text-[9px] text-muted-foreground mb-0.5">{t("method")}</div>
          <div className="rounded px-1 py-0.5 bg-blue-50 text-primary text-[9px] text-center font-medium">
            {data.method}
          </div>
        </div>
      )}
    </BaseNode>
  );
}
