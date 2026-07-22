"use client";

import { type ReactNode, useState } from "react";
import { useTranslations } from "next-intl";
import {
  ChevronDown,
  CircleAlert,
  CircleCheck,
  CircleDashed,
  FileCheck,
  FileText,
  Info,
  Lightbulb,
  Loader2,
  ShieldCheck,
  TriangleAlert,
  X,
} from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { JsonBlock } from "./JsonBlock";
import type {
  CompletedReviewReport,
  RawPreviewReport,
  ReviewCheckItem,
  ReviewCheckStatus,
  ReviewReport,
  ReviewVerdict,
  SkippedReviewReport,
} from "./types";

const VERDICT_STYLE: Record<ReviewVerdict, { band: string; icon: ReactNode }> = {
  pass: {
    band: "bg-emerald-50 text-emerald-700 border-emerald-200",
    icon: <ShieldCheck className="h-4 w-4" />,
  },
  fail: {
    band: "bg-red-50 text-red-700 border-red-200",
    icon: <CircleAlert className="h-4 w-4" />,
  },
};

// 单项检测结果配色：pass 绿、fail 红、skipped（未检查/未检出）中性灰 —— 不做严重度分级
const CHECK_STYLE: Record<ReviewCheckStatus, { border: string; bg: string; text: string }> = {
  pass: { border: "border-emerald-100", bg: "bg-emerald-50/60", text: "text-emerald-600" },
  fail: { border: "border-red-100", bg: "bg-red-50/60", text: "text-red-600" },
  skipped: { border: "border-border", bg: "bg-muted/40", text: "text-muted-foreground" },
};

const CHECK_ICON: Record<ReviewCheckStatus, typeof CircleCheck> = {
  pass: CircleCheck,
  fail: CircleAlert,
  skipped: CircleDashed,
};

interface ReviewReportModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  serialNumber: string;
  productName: string;
  // null = 详情拉取中 / 拉取失败 / 该单确实没有报告 —— 三种情况由 fetchStatus 区分占位文案
  report: ReviewReport | null;
  /** 预审 MCP 产出的原始 JSON，供「查看 JSON 原文」展示;无报告时为 null。 */
  rawReport: RawPreviewReport | null;
  fetchStatus: "loading" | "error" | "ready";
}

export function ReviewReportModal({
  open,
  onOpenChange,
  serialNumber,
  productName,
  report,
  rawReport,
  fetchStatus,
}: ReviewReportModalProps) {
  const t = useTranslations("zdObserve");

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="gap-0 overflow-hidden p-0"
        style={{ width: "92vw", maxWidth: "920px" }}
      >
        <DialogHeader className="border-b bg-muted/30 px-5 py-3 text-left">
          <DialogTitle className="flex items-center gap-2 text-[15px] font-semibold">
            <span className="flex h-6 w-6 items-center justify-center rounded-md bg-primary/10 text-primary">
              <FileCheck className="h-3.5 w-3.5" />
            </span>
            {t("reviewReport.title")}
          </DialogTitle>
          <p className="truncate pl-8 text-xs text-muted-foreground">
            {serialNumber}
            {productName ? ` · ${productName}` : ""}
          </p>
        </DialogHeader>

        {report ? (
          // 固定高度 + 内部滚动：展开未通过项时 modal 尺寸不变，只在内部滚动（用 inline style 规避未生成的 h-[..vh] 类）
          <div className="space-y-5 overflow-y-auto p-5" style={{ height: "76vh" }}>
            {report.kind === "skipped" ? (
              <SkipBody report={report} t={t} />
            ) : (
              <ReportBody report={report} t={t} />
            )}

            {/* 预审原始 JSON（与 OA 入参一致的「查看 JSON 原文」交互）*/}
            {rawReport && (
              <div className="border-t pt-4">
                <JsonBlock value={rawReport} label={t("params.viewJson")} />
              </div>
            )}
          </div>
        ) : fetchStatus === "loading" ? (
          <div className="flex flex-col items-center justify-center gap-2 px-6 py-20 text-center">
            <Loader2 className="h-9 w-9 animate-spin text-muted-foreground/40" />
            <p className="text-sm text-muted-foreground">{t("reviewReport.loading")}</p>
          </div>
        ) : fetchStatus === "error" ? (
          <div className="flex flex-col items-center justify-center gap-2 px-6 py-20 text-center">
            <CircleAlert className="h-9 w-9 text-destructive/60" />
            <p className="text-sm text-muted-foreground">{t("reviewReport.loadFailed")}</p>
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center gap-2 px-6 py-20 text-center">
            <FileText className="h-9 w-9 text-muted-foreground/40" />
            <p className="text-sm text-muted-foreground">{t("reviewReport.empty")}</p>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function ReportBody({
  report,
  t,
}: {
  report: CompletedReviewReport;
  t: ReturnType<typeof useTranslations>;
}) {
  const { infoChapter } = report;
  const verdict = VERDICT_STYLE[report.verdict];

  return (
    <div className="space-y-5">
      {/* 汇总：三个统计卡 + 判定条一行。
          置信度/人工复核已移除——展示模型由原始预审 JSON 派生，没有这两项的数据来源。 */}
      <div className="space-y-2.5">
        <div className="flex gap-2.5">
          <StatCell value={report.totalChecks} label={t("reviewReport.stats.total")} />
          <StatCell
            value={report.passed}
            label={t("reviewReport.stats.passed")}
            tone="bg-emerald-50 text-emerald-600"
          />
          <StatCell
            value={report.failed}
            label={t("reviewReport.stats.failed")}
            tone="bg-red-50 text-red-600"
          />
        </div>

        <div
          className={`flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-[13px] font-semibold ${verdict.band}`}
        >
          {verdict.icon}
          {t(`reviewReport.verdict.${report.verdict}` as never)}
        </div>
      </div>

      {/* 两栏：左=图文预审信息章，右=详细检测结果 + 问题 */}
      <div className="grid grid-cols-2 gap-6">
        {/* 图文预审信息章 */}
        <section className="space-y-3">
          <SectionTitle icon={<FileCheck className="h-3.5 w-3.5" />}>
            {t("reviewReport.infoChapter.title")}
          </SectionTitle>
          <div className="space-y-4 rounded-xl border bg-muted/20 p-4 text-xs">
            <div className="grid grid-cols-2 gap-x-4 gap-y-3.5">
              {/* 文件名常见超长，独占一行 */}
              <div className="col-span-2">
                <Field
                  label={t("reviewReport.infoChapter.fileName")}
                  value={infoChapter.fileName}
                />
              </div>
              <Field
                label={t("reviewReport.infoChapter.productCode")}
                value={infoChapter.productCode}
                mono
              />
              <Field
                label={t("reviewReport.infoChapter.colorName")}
                value={infoChapter.colorName}
              />
              <Field
                label={t("reviewReport.infoChapter.artboardSize")}
                value={infoChapter.artboardSize}
              />
              <Field
                label={t("reviewReport.infoChapter.unfoldedSize")}
                value={infoChapter.unfoldedSize}
              />
            </div>

            {infoChapter.checklist.length > 0 && (
              <div className="grid grid-cols-2 gap-x-3 gap-y-2.5 border-t pt-4">
                {infoChapter.checklist.map((c) => (
                  <div key={c.label} className="flex items-center gap-2">
                    <span
                      className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-full ${
                        c.ok ? "bg-emerald-500" : "bg-red-500"
                      }`}
                    >
                      {c.ok ? (
                        <CircleCheck className="h-2.5 w-2.5 text-white" />
                      ) : (
                        <X className="h-2.5 w-2.5 text-white" />
                      )}
                    </span>
                    <span className={c.ok ? "text-foreground/80" : "text-red-600"}>{c.label}</span>
                  </div>
                ))}
              </div>
            )}

            <div className="space-y-1.5 border-t pt-4">
              <div className="flex justify-between">
                <span className="text-muted-foreground">
                  {t("reviewReport.infoChapter.reviewDate")}
                </span>
                <span className="font-medium">{infoChapter.reviewDate}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">
                  {t("reviewReport.infoChapter.operator")}
                </span>
                <span className="font-medium">{infoChapter.operator}</span>
              </div>
            </div>
          </div>
        </section>

        {/* 详细检测结果 + 问题 */}
        <section className="space-y-5">
          <div className="space-y-3">
            <SectionTitle icon={<Info className="h-3.5 w-3.5" />}>
              {t("reviewReport.checks")}
            </SectionTitle>
            <div className="space-y-2">
              {report.checks.map((c) => (
                <CheckRow key={c.name} check={c} t={t} />
              ))}
            </div>
          </div>

          {report.issues.length > 0 && (
            <div className="space-y-3">
              <SectionTitle icon={<TriangleAlert className="h-3.5 w-3.5" />}>
                {t("reviewReport.issues")}
              </SectionTitle>
              <div className="space-y-2">
                {report.issues.map((issue, i) => (
                  <div
                    // biome-ignore lint/suspicious/noArrayIndexKey: 问题为纯文本列表，无稳定 id
                    key={i}
                    className="rounded-lg border border-amber-200 bg-amber-50/50 px-3 py-2 text-xs text-foreground/80"
                  >
                    <span className="mr-1 font-semibold text-amber-600">{i + 1}.</span>
                    {issue}
                  </div>
                ))}
              </div>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

/**
 * 前置门跳过态（status='skipped'）：文档颜色模式非 CMYK，预审被整体跳过。
 * 不渲染检查栏目/勾选（空壳≠通过），只给人工确认横幅 + 文件信息。
 */
function SkipBody({
  report,
  t,
}: {
  report: SkippedReviewReport;
  t: ReturnType<typeof useTranslations>;
}) {
  return (
    <div className="space-y-5">
      <div className="flex items-start gap-2.5 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-amber-800">
        <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />
        <div className="space-y-1">
          <p className="text-[13px] font-semibold">{t("reviewReport.skipped.title")}</p>
          <p className="text-xs leading-relaxed">
            {report.message || t("reviewReport.skipped.hint")}
          </p>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-x-4 gap-y-3.5 rounded-xl border bg-muted/20 p-4 text-xs">
        <div className="col-span-2">
          <Field label={t("reviewReport.infoChapter.fileName")} value={report.fileName} />
        </div>
        <Field label={t("reviewReport.infoChapter.productCode")} value={report.productCode} mono />
        <Field label={t("reviewReport.infoChapter.reviewDate")} value={report.reviewDate} />
        <Field label={t("reviewReport.infoChapter.operator")} value={report.operator} />
      </div>
    </div>
  );
}

function CheckRow({ check, t }: { check: ReviewCheckItem; t: ReturnType<typeof useTranslations> }) {
  const s = CHECK_STYLE[check.status];
  const expandable = !!check.detail;
  const [open, setOpen] = useState(false);

  const StatusIcon = CHECK_ICON[check.status];
  const statusLabel = check.statusLabel ?? t(`reviewReport.checkStatus.${check.status}` as never);

  return (
    <div className={`overflow-hidden rounded-lg border ${s.border}`}>
      {/* 表头：可展开项用 button（语义 + 键盘可达），无明细项用静态 div */}
      {expandable ? (
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className={`flex w-full items-center gap-2 px-3 py-2 text-left ${s.bg}`}
        >
          <StatusIcon className={`h-4 w-4 shrink-0 ${s.text}`} />
          <span className={`flex-grow text-xs font-medium ${s.text}`}>{check.name}</span>
          <span className={`text-[11px] ${s.text}`}>{statusLabel}</span>
          <ChevronDown
            className={`h-3.5 w-3.5 shrink-0 transition-transform ${s.text} ${open ? "rotate-180" : ""}`}
          />
        </button>
      ) : (
        <div className={`flex items-center gap-2 px-3 py-2 ${s.bg}`}>
          <StatusIcon className={`h-4 w-4 shrink-0 ${s.text}`} />
          <span className={`flex-grow text-xs font-medium ${s.text}`}>{check.name}</span>
          <span className={`text-[11px] ${s.text}`}>{statusLabel}</span>
        </div>
      )}

      {expandable && open && check.detail && (
        <div className="space-y-3 border-t bg-background p-3.5 text-[11px]">
          {check.detail.summary && (
            <p className="font-medium text-foreground/80">{check.detail.summary}</p>
          )}

          {check.detail.fields && check.detail.fields.length > 0 && (
            <div className="space-y-2 rounded-md border bg-muted/30 px-3 py-2.5">
              {check.detail.fields.map((f) => (
                <div
                  key={f.label}
                  className="flex items-center justify-between gap-2 leading-relaxed"
                >
                  <span className="text-muted-foreground">{f.label}</span>
                  <span
                    className={`text-right font-medium ${
                      f.tone === "current"
                        ? "text-red-600"
                        : f.tone === "expected"
                          ? "text-emerald-600"
                          : ""
                    }`}
                  >
                    {f.value}
                  </span>
                </div>
              ))}
            </div>
          )}

          {check.detail.suggestion && (
            <div className="rounded-md border border-primary/20 bg-primary/5 px-3 py-2.5">
              <div className="flex items-center gap-1.5 font-medium text-primary">
                <Lightbulb className="h-3.5 w-3.5" />
                {t("reviewReport.fix.title")}
              </div>
              <p className="mt-1.5 leading-relaxed text-foreground/70">{check.detail.suggestion}</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function StatCell({ value, label, tone }: { value: number; label: string; tone?: string }) {
  return (
    <div
      className={`flex-1 rounded-lg px-2 py-1.5 text-center ${tone ?? "bg-muted/50 text-foreground/80"}`}
    >
      <div className="text-lg font-bold leading-tight tabular-nums">{value}</div>
      <div className="text-[10px] opacity-80">{label}</div>
    </div>
  );
}

function SectionTitle({ icon, children }: { icon: ReactNode; children: ReactNode }) {
  return (
    <h4 className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-muted-foreground">
      {icon}
      {children}
    </h4>
  );
}

function Field({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="min-w-0">
      <div className="text-[11px] text-muted-foreground">{label}</div>
      <div className={`truncate font-medium ${mono ? "font-mono" : ""}`} title={value}>
        {value}
      </div>
    </div>
  );
}
