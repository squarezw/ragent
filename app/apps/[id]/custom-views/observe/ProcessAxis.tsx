"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { AlertTriangle, Check, ChevronDown, Loader2 } from "lucide-react";
import type { ObserveNode, ObserveNodeStatus, OrderState } from "./types";
import { DownloadingDetail } from "./DownloadingDetail";

// 颜色交给实心圆点（白字在饱和色上对比度安全）；文字标签保持中性，规避语义色小字对比度不达 AA 的问题
const STATUS_STYLE: Record<ObserveNodeStatus, { dot: string; text: string }> = {
  done: { dot: "bg-success border-success text-success-foreground", text: "text-foreground" },
  // 注意：不用语义 token `info`——它在 theme.ts 里按品牌 hue 动态生成，租户 hue 异常时会算出非法 HSL 导致填充透明
  active: { dot: "bg-blue-500 border-blue-500 text-white", text: "text-foreground" },
  pending: {
    dot: "bg-background border-border text-muted-foreground",
    text: "text-muted-foreground",
  },
  failed: {
    dot: "bg-destructive border-destructive text-destructive-foreground",
    text: "text-destructive",
  },
};

interface ProcessAxisProps {
  nodes: ObserveNode[];
  selectedPhase: OrderState | null;
  onSelectPhase: (phase: OrderState) => void;
}

export function ProcessAxis({ nodes, selectedPhase, onSelectPhase }: ProcessAxisProps) {
  const t = useTranslations("zdObserve");
  const [expanded, setExpanded] = useState<OrderState | null>(null);

  return (
    <div className="space-y-3">
      {/* isolate 造层叠上下文，让所有连接线统一压在圆点之下（连线跨列延伸，否则会被后一列盖在前一列圆点上）*/}
      <div className="flex items-start isolate">
        {nodes.map((node, i) => {
          const style = STATUS_STYLE[node.status];
          const isSelected = selectedPhase === node.phase;
          const isPending = node.status === "pending";
          const expandable = !isPending && node.detail && Object.keys(node.detail).length > 0;
          return (
            <div key={node.phase} className="flex-1 flex flex-col items-center relative">
              {/* 连接线 */}
              {i > 0 && (
                <div
                  className={`absolute top-4 right-1/2 left-[-50%] -z-10 h-0.5 ${
                    node.status === "pending" ? "bg-border" : "bg-success"
                  }`}
                />
              )}
              <button
                type="button"
                disabled={isPending}
                onClick={() => onSelectPhase(node.phase)}
                className={`relative z-10 flex h-8 w-8 items-center justify-center rounded-full border-2 ${style.dot} ${
                  isSelected ? "ring-2 ring-offset-2 ring-primary" : ""
                } ${isPending ? "cursor-not-allowed" : "cursor-pointer"}`}
                title={node.label}
              >
                {node.status === "done" ? (
                  <Check className="h-4 w-4" />
                ) : node.status === "active" ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : node.status === "failed" ? (
                  <AlertTriangle className="h-4 w-4" />
                ) : (
                  <span className="text-xs">{i + 1}</span>
                )}
              </button>
              <div className={`mt-2 text-xs font-medium ${style.text}`}>{node.label}</div>
              {expandable && (
                <button
                  type="button"
                  onClick={() => setExpanded(expanded === node.phase ? null : node.phase)}
                  className="mt-1 flex items-center gap-0.5 text-[11px] text-muted-foreground hover:text-foreground"
                >
                  {expanded === node.phase ? t("axis.collapse") : t("axis.expand")}
                  <ChevronDown
                    className={`h-3 w-3 transition-transform ${expanded === node.phase ? "rotate-180" : ""}`}
                  />
                </button>
              )}
            </div>
          );
        })}
      </div>

      {/* 展开的节点明细 */}
      {expanded &&
        (() => {
          const node = nodes.find((n) => n.phase === expanded);
          if (!node?.detail) return null;
          return (
            <div className="rounded-md border bg-muted/30 p-3 text-xs">
              <div className="mb-2 font-medium">{node.label}</div>
              {node.phase === "downloading" ? (
                <DownloadingDetail detail={node.detail} />
              ) : (
                <pre className="whitespace-pre-wrap break-all text-muted-foreground">
                  {JSON.stringify(node.detail, null, 2)}
                </pre>
              )}
            </div>
          );
        })()}
    </div>
  );
}
