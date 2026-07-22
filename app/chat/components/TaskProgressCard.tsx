"use client";

import { useState } from "react";
import {
  AlertCircle,
  Check,
  ChevronDown,
  ChevronUp,
  CircleSlash,
  Clock,
  Loader2,
  X,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { MarkdownRenderer } from "@/components/MarkdownRenderer";
import type { TaskState, WorkflowRunStatus } from "@/types/workflow-run";

interface TaskProgressCardProps {
  taskState: TaskState;
  onCancel?: (runId: number) => void;
}

const STATUS_META: Record<
  WorkflowRunStatus,
  { label: string; badge: "default" | "secondary" | "destructive" | "outline"; tone: string }
> = {
  queued: { label: "排队中", badge: "secondary", tone: "text-muted-foreground" },
  running: { label: "执行中", badge: "default", tone: "text-primary" },
  succeeded: { label: "已完成", badge: "default", tone: "text-success" },
  failed: { label: "失败", badge: "destructive", tone: "text-destructive" },
  cancelled: { label: "已取消", badge: "outline", tone: "text-muted-foreground" },
};

function formatElapsed(start: string | null, end: string | null): string | null {
  if (!start) return null;
  const startMs = Date.parse(start);
  if (Number.isNaN(startMs)) return null;
  const endMs = end ? Date.parse(end) : Date.now();
  if (Number.isNaN(endMs)) return null;
  const ms = Math.max(0, endMs - startMs);
  if (ms < 1000) return `${ms}ms`;
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}秒`;
  const m = Math.floor(s / 60);
  const rs = s % 60;
  return `${m}分${rs}秒`;
}

function StatusIcon({ status }: { status: WorkflowRunStatus }) {
  switch (status) {
    case "queued":
      return <Clock className="w-4 h-4 text-muted-foreground" aria-hidden />;
    case "running":
      return <Loader2 className="w-4 h-4 animate-spin text-primary" aria-hidden />;
    case "succeeded":
      return <Check className="w-4 h-4 text-success" aria-hidden />;
    case "failed":
      return <AlertCircle className="w-4 h-4 text-destructive" aria-hidden />;
    case "cancelled":
      return <CircleSlash className="w-4 h-4 text-muted-foreground" aria-hidden />;
  }
}

function NodeRow({
  name,
  status,
  startedAt,
  completedAt,
  errorReason,
}: {
  name: string;
  status: TaskState["nodes"][number]["status"];
  startedAt: string | null;
  completedAt: string | null;
  errorReason?: string;
}) {
  let marker: string;
  let toneCls = "text-muted-foreground";
  if (status === "succeeded") {
    marker = "✓";
    toneCls = "text-success";
  } else if (status === "failed") {
    marker = "✗";
    toneCls = "text-destructive";
  } else if (status === "running") {
    marker = "⟳";
    toneCls = "text-primary";
  } else {
    marker = "·";
  }
  const elapsed = formatElapsed(startedAt, completedAt);
  return (
    <div className="flex items-start gap-2 text-xs py-1">
      <span className={`font-mono ${toneCls} flex-shrink-0 mt-0.5`}>{marker}</span>
      <div className="flex-1 min-w-0 break-words whitespace-pre-wrap">
        <span className={toneCls}>{name || "(未命名节点)"}</span>
        {elapsed && <span className="ml-2 text-muted-foreground/70 font-mono">{elapsed}</span>}
        {errorReason && (
          <div className="mt-0.5 text-destructive/90 break-words whitespace-pre-wrap">
            {errorReason}
          </div>
        )}
      </div>
    </div>
  );
}

export default function TaskProgressCard({ taskState, onCancel }: TaskProgressCardProps) {
  const { runId, kind, status, progressPct, currentNode, nodes, finalOutput, error } = taskState;
  const meta = STATUS_META[status];
  const [showTimeline, setShowTimeline] = useState(false);
  const [showFailureDetail, setShowFailureDetail] = useState(false);

  const elapsed = formatElapsed(taskState.startedAt, taskState.completedAt);

  // finalOutput.report (markdown) — primary visible artifact for cad.review;
  // other workflows may use different keys, so we render whichever string-like
  // top-level value we find.
  const reportContent =
    typeof finalOutput?.report === "string" ? (finalOutput.report as string) : null;

  const errorReason =
    typeof error?.reason === "string"
      ? (error.reason as string)
      : typeof error?.message === "string"
        ? (error.message as string)
        : null;
  const errorDetail = error ? JSON.stringify(error, null, 2) : null;

  // 占满父级容器宽度（与 chat input 对齐）。父级 MessageList 已由 chat/page.tsx
  // 的 max-w-4xl/6xl 控住整体宽度，本组件不再叠一层 inline maxWidth。
  return (
    <div
      className="rounded-lg border bg-card text-card-foreground shadow-sm w-full"
      data-task-run-id={runId}
      data-task-status={status}
    >
      <div className="p-4 space-y-3">
        {/* Header row */}
        <div className="flex items-start gap-3 flex-wrap">
          <div className="flex items-center gap-2 min-w-0 flex-1">
            <StatusIcon status={status} />
            <span className="font-medium break-words whitespace-pre-wrap">{kind}</span>
            <span className="text-xs text-muted-foreground font-mono whitespace-nowrap">
              #{runId}
            </span>
          </div>
          <Badge variant={meta.badge} className="flex-shrink-0">
            {meta.label}
          </Badge>
        </div>

        {/* Progress */}
        {(status === "queued" || status === "running") && (
          <div className="space-y-1">
            <Progress
              value={progressPct ?? 0}
              className={progressPct === null ? "opacity-70" : ""}
            />
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span className="break-words whitespace-pre-wrap min-w-0 flex-1">
                {status === "running" && currentNode
                  ? `正在执行: ${currentNode}`
                  : status === "queued"
                    ? "等待调度…"
                    : "运行中…"}
              </span>
              <span className="flex-shrink-0 ml-2 font-mono">
                {progressPct !== null ? `${Math.round(progressPct)}%` : "--"}
              </span>
            </div>
          </div>
        )}

        {/* Final markdown report */}
        {status === "succeeded" && reportContent && (
          <div className="rounded border bg-background/50 p-3 break-words">
            <MarkdownRenderer content={reportContent} />
          </div>
        )}

        {/* Failure summary */}
        {status === "failed" && (
          <div className="text-sm text-destructive break-words whitespace-pre-wrap">
            {errorReason || "任务失败（无错误信息）"}
            {errorDetail && errorDetail.length > 2 && (
              <button
                type="button"
                onClick={() => setShowFailureDetail((v) => !v)}
                className="ml-2 text-xs underline text-destructive/80 hover:text-destructive"
              >
                {showFailureDetail ? "收起详情" : "查看详情"}
              </button>
            )}
            {showFailureDetail && errorDetail && (
              <pre className="mt-2 p-2 rounded bg-destructive/10 text-xs font-mono overflow-x-auto whitespace-pre">
                {errorDetail}
              </pre>
            )}
          </div>
        )}

        {/* Cancelled */}
        {status === "cancelled" && (
          <div className="text-sm text-muted-foreground break-words whitespace-pre-wrap">
            任务已取消
          </div>
        )}

        {/* Node timeline */}
        {nodes.length > 0 && (
          <div className="border-t pt-2">
            <button
              type="button"
              onClick={() => setShowTimeline((v) => !v)}
              className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
            >
              {showTimeline ? (
                <ChevronUp className="w-3 h-3" />
              ) : (
                <ChevronDown className="w-3 h-3" />
              )}
              <span>
                节点 ({nodes.filter((n) => n.status === "succeeded").length}/{nodes.length})
              </span>
            </button>
            {showTimeline && (
              <div className="mt-1 pl-1 border-l border-muted">
                {nodes.map((n, idx) => (
                  <NodeRow
                    key={`${n.name}-${idx}`}
                    name={n.name}
                    status={n.status}
                    startedAt={n.startedAt}
                    completedAt={n.completedAt}
                    errorReason={
                      typeof n.error?.reason === "string" ? (n.error.reason as string) : undefined
                    }
                  />
                ))}
              </div>
            )}
          </div>
        )}

        {/* Footer: elapsed + cancel */}
        <div className="flex items-center justify-between text-xs text-muted-foreground flex-wrap gap-2">
          <span className={`font-mono ${meta.tone}`}>{elapsed ? `用时 ${elapsed}` : "—"}</span>
          {status === "running" && onCancel && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => onCancel(runId)}
              className="h-7 text-xs flex-shrink-0"
            >
              <X className="w-3 h-3 mr-1" />
              取消
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
