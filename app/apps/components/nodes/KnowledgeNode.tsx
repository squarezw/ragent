"use client";

import React from "react";
import { NodeProps } from "reactflow";
import BaseNode from "./BaseNode";
import { useTranslations } from "next-intl";

export default function KnowledgeNode({ data }: NodeProps) {
  const t = useTranslations("workflow");

  return (
    <BaseNode
      title={t("knowledgeNode")}
      handles={{ source: true, target: false, refSource: false, refTarget: false }}
      minWidth={120}
    >
      <div>
        <div className="text-[9px] text-muted-foreground mb-0.5">{t("linkedDatasets")}</div>
        <div className="flex flex-col gap-0.5">
          {data.datasets && data.datasets.length > 0 ? (
            data.datasets.slice(0, 3).map((name: string, index: number) => (
              <div
                key={index}
                className="rounded px-1 py-0.5 bg-purple-50 text-purple-700 text-[9px] text-center truncate"
                title={name}
              >
                {name}
              </div>
            ))
          ) : (
            <div className="text-[9px] text-gray-400 text-center">{t("noLinkedDatasets")}</div>
          )}
          {data.datasets && data.datasets.length > 3 && (
            <div className="text-[9px] text-muted-foreground text-center">
              {t("datasetsMore", { count: data.datasets.length - 3 })}
            </div>
          )}
        </div>
      </div>

      {data.datasets && data.datasets.length > 0 && (
        <div className="text-[9px] text-muted-foreground text-center">
          {t("datasetsTotal", { count: data.datasets.length })}
        </div>
      )}
    </BaseNode>
  );
}
