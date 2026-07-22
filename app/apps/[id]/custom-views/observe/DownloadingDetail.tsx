"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { AlertTriangle, Check, ChevronDown, Loader2 } from "lucide-react";
import type { FailedFile, OrderProgress, SourceProgress } from "./types";

function fmtMB(bytes: number): string {
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/** 细进度条:value ∈ [0,1]。 */
function Bar({ value, accent }: { value: number; accent?: boolean }) {
  const pct = Math.max(0, Math.min(100, Math.round(value * 100)));
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
      <div
        className={`h-full rounded-full transition-all ${accent ? "bg-blue-500" : "bg-success"}`}
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

/** 单一来源(百度 / 附件)的进度块。 */
function Bucket({ label, b }: { label: string; b: SourceProgress }) {
  const t = useTranslations("zdObserve");
  const started = b.done > 0 || b.failed > 0 || b.currentFile !== null || (b.total ?? 0) > 0;
  const total = b.total ?? 0;
  const percent = total > 0 ? ((b.done / total) * 100).toFixed(2) : "0.00";
  const cur = b.currentFile;
  const curPct = cur && cur.bytesTotal ? cur.bytesDone / cur.bytesTotal : null;

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between gap-2">
        <span className="font-medium text-foreground">{label}</span>
        {started ? (
          <span className="text-muted-foreground">
            {t("axisDetail.bucketProgress", { percent })}
            {b.failed > 0 && (
              <span className="ml-1 text-destructive">
                · {t("axisDetail.failedFilesCount", { count: b.failed })}
              </span>
            )}
          </span>
        ) : (
          <span className="text-muted-foreground">{t("axisDetail.notStarted")}</span>
        )}
      </div>

      {started && total > 0 && <Bar value={b.done / total} />}

      {cur && (
        <div className="space-y-1 rounded-md bg-background/60 px-2 py-1.5">
          <div className="flex items-center gap-1.5 text-foreground">
            <Loader2 className="h-3 w-3 shrink-0 animate-spin text-blue-500" />
            <span className="truncate">{cur.name}</span>
            <span className="ml-auto shrink-0 tabular-nums text-muted-foreground">
              {fmtMB(cur.bytesDone)}
              {cur.bytesTotal !== null ? ` / ${fmtMB(cur.bytesTotal)}` : ""}
              {curPct !== null ? ` · ${Math.round(curPct * 100)}%` : ""}
            </span>
          </div>
          {curPct !== null && <Bar value={curPct} accent />}
        </div>
      )}
    </div>
  );
}

/**
 * 「下载中」节点展开明细 — 把 zd-service 给的富进度(detail.progress)渲成进度条 + 当前文件 + 文件清单,
 * 取代原来的 JSON 原文。兼顾实时(progress.*Files)与归档后(filesDone/filesFailed)两种数据形态。
 */
export function DownloadingDetail({ detail }: { detail: Record<string, unknown> }) {
  const t = useTranslations("zdObserve");
  const [showDone, setShowDone] = useState(false);

  // 兜底:progress 非空但 baidu/attachment 缺失(形状不全的旧 jsonb)当作无,避免 progress.baidu.* 抛错崩整块。
  const progressRaw = (detail.progress as OrderProgress | null) ?? null;
  const progress = progressRaw && progressRaw.baidu && progressRaw.attachment ? progressRaw : null;
  const filesDone = (detail.filesDone as string[] | undefined) ?? [];
  const filesDoneCount = (detail.filesDoneCount as number | undefined) ?? 0;
  const filesFailed = (detail.filesFailed as FailedFile[] | undefined) ?? [];

  // 完成 / 失败清单:优先归档后的权威字段,实时阶段退回 progress 桶里的文件名。
  const doneNames =
    filesDone.length > 0
      ? filesDone
      : progress
        ? [...progress.baidu.doneFiles, ...progress.attachment.doneFiles]
        : [];
  // 已完成数走权威计数,不用 doneNames.length——progress 桶里的文件名清单有 200 上限(zd-service pushCapped),
  // 大单实时阶段会少报;归档后用 filesDoneCount,实时阶段用未截断的 progress.*.done。
  const doneCount =
    filesDone.length > 0
      ? filesDoneCount
      : progress
        ? progress.baidu.done + progress.attachment.done
        : 0;
  const failed: FailedFile[] =
    filesFailed.length > 0
      ? filesFailed
      : progress
        ? [...progress.baidu.failedFiles, ...progress.attachment.failedFiles].map((name) => ({
            name,
            reason: "",
          }))
        : [];

  if (!progress && doneNames.length === 0 && failed.length === 0) {
    return <div className="text-muted-foreground">{t("axisDetail.noDetail")}</div>;
  }

  return (
    <div className="space-y-3">
      {progress && (
        <div className="space-y-3">
          <Bucket label={t("axisDetail.sourceBaidu")} b={progress.baidu} />
          <Bucket label={t("axisDetail.sourceAttachment")} b={progress.attachment} />
        </div>
      )}

      {failed.length > 0 && (
        <div className="space-y-1">
          <div className="flex items-center gap-1 font-medium text-destructive">
            <AlertTriangle className="h-3 w-3 shrink-0" />
            {t("axisDetail.filesFailed")} · {failed.length}
          </div>
          <ul className="space-y-0.5 pl-4">
            {failed.map((f, i) => (
              <li key={i} className="break-all text-destructive">
                {f.name}
                {f.reason && <span className="text-muted-foreground"> — {f.reason}</span>}
              </li>
            ))}
          </ul>
        </div>
      )}

      {doneNames.length > 0 && (
        <div>
          <button
            type="button"
            onClick={() => setShowDone((v) => !v)}
            className="flex items-center gap-1 text-muted-foreground hover:text-foreground"
          >
            <Check className="h-3 w-3 shrink-0 text-success" />
            {t("axisDetail.doneFiles", { count: doneCount })}
            <ChevronDown
              className={`h-3 w-3 transition-transform ${showDone ? "rotate-180" : ""}`}
            />
          </button>
          {showDone && (
            <ul className="mt-1 space-y-0.5 pl-4 text-muted-foreground">
              {doneNames.map((n, i) => (
                <li key={i} className="break-all">
                  {n}
                </li>
              ))}
              {doneCount > doneNames.length && (
                <li className="text-muted-foreground/70">
                  {t("axisDetail.doneFilesTruncated", { shown: doneNames.length })}
                </li>
              )}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
