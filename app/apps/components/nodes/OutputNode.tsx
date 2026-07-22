"use client";

import React from "react";
import { NodeProps } from "reactflow";
import BaseNode from "./BaseNode";
import { useTranslations } from "next-intl";

export default function OutputNode({ data }: NodeProps) {
  const t = useTranslations("workflow");

  return (
    <BaseNode title={t("outputNodeLabel")} handles={{ target: true, source: false }} minWidth={100}>
      <div className="rounded px-1.5 py-1 bg-muted text-foreground font-medium text-[10px] text-center">
        {data.name}
      </div>
      {data.platform && (
        <div className="text-[9px] text-muted-foreground text-center">{data.platform}</div>
      )}
    </BaseNode>
  );
}
