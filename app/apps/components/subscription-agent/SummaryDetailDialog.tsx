"use client";

import { useState, useEffect, useCallback } from "react";
import { useTranslations } from "next-intl";
import axios from "@/lib/axios";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Loader2, RefreshCw, ExternalLink } from "lucide-react";
import { toast } from "sonner";
import ReactMarkdown from "react-markdown";
import type { Summary } from "@/types/subscription-agent";

// 后端可能返回的原始格式（与 Summary 类型有差异）
interface RawSummary {
  id?: string;
  summaryId?: string;
  type: "daily" | "weekly";
  status: "pending" | "processing" | "completed" | "failed";
  period_start?: string;
  period_end?: string;
  period?: {
    start: string;
    end: string;
  };
  platform_filter?: "all" | "youtube" | "twitter";
  item_count?: number;
  itemCount?: number;
  summary_text?: string;
  summaryText?: string;
  highlights?: Summary["highlights"];
  llm_model?: string;
  llm_tokens_input?: number;
  llm_tokens_output?: number;
  triggered_by?: "scheduled" | "manual";
  triggeredBy?: "scheduled" | "manual";
  created_at?: string;
  createdAt?: string;
  updated_at?: string;
}

// 将原始数据转换为标准 Summary 格式
function normalizeSummary(raw: RawSummary): Summary {
  return {
    id: raw.id || raw.summaryId || "",
    type: raw.type,
    status: raw.status,
    period_start: raw.period_start || raw.period?.start || "",
    period_end: raw.period_end || raw.period?.end || "",
    platform_filter: raw.platform_filter || "all",
    item_count: raw.item_count ?? raw.itemCount ?? 0,
    summary_text: raw.summary_text || raw.summaryText,
    highlights: raw.highlights,
    llm_model: raw.llm_model,
    llm_tokens_input: raw.llm_tokens_input,
    llm_tokens_output: raw.llm_tokens_output,
    triggered_by: raw.triggered_by || raw.triggeredBy || "manual",
    created_at: raw.created_at || raw.createdAt || new Date().toISOString(),
    updated_at: raw.updated_at,
  };
}

interface SummaryDetailDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  summaryId: string | null;
}

const typeColorMap: Record<string, string> = {
  daily: "bg-blue-100 text-blue-800",
  weekly: "bg-purple-100 text-purple-800",
};

const statusColorMap: Record<string, string> = {
  pending: "bg-yellow-100 text-yellow-800",
  processing: "bg-blue-100 text-blue-800",
  completed: "bg-green-100 text-green-800",
  failed: "bg-red-100 text-red-800",
};

export function SummaryDetailDialog({ open, onOpenChange, summaryId }: SummaryDetailDialogProps) {
  const t = useTranslations("workflow");
  const tc = useTranslations("common");
  const [summary, setSummary] = useState<Summary | null>(null);
  const [loading, setLoading] = useState(false);

  const typeLabelMap: Record<string, string> = {
    daily: t("dailyReport"),
    weekly: t("weeklyReport"),
  };

  const statusLabelMap: Record<string, string> = {
    pending: t("pending"),
    processing: t("generating"),
    completed: t("completed"),
    failed: t("failed"),
  };

  const loadSummary = useCallback(async () => {
    if (!summaryId) return;

    setLoading(true);
    try {
      const response = await axios.get<RawSummary>(
        `/api/v1/subscription-agent/summaries/${summaryId}`
      );
      setSummary(normalizeSummary(response.data));
    } catch (error: any) {
      toast.error(error.response?.data?.message || t("loadReportFailed"));
    } finally {
      setLoading(false);
    }
  }, [summaryId, t]);

  useEffect(() => {
    if (open && summaryId) {
      loadSummary();
    }
  }, [open, summaryId, loadSummary]);

  useEffect(() => {
    if (!open) {
      setSummary(null);
    }
  }, [open]);

  // 自动轮询处理中的报告
  useEffect(() => {
    if (!open || !summary) return;

    if (summary.status === "pending" || summary.status === "processing") {
      const timer = setInterval(() => {
        loadSummary();
      }, 5000);

      return () => clearInterval(timer);
    }
  }, [open, summary, loadSummary]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[80vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <div className="flex items-center justify-between">
            <DialogTitle className="flex items-center gap-2">
              {t("reportDetail")}
              {summary && (
                <>
                  <Badge className={typeColorMap[summary.type]} variant="secondary">
                    {typeLabelMap[summary.type]}
                  </Badge>
                  <Badge className={statusColorMap[summary.status]} variant="secondary">
                    {statusLabelMap[summary.status]}
                  </Badge>
                </>
              )}
            </DialogTitle>
            <Button variant="ghost" size="icon" onClick={loadSummary} disabled={loading}>
              {loading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <RefreshCw className="h-4 w-4" />
              )}
            </Button>
          </div>
        </DialogHeader>

        <div className="flex-1 overflow-auto">
          {loading && !summary ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-8 w-8 animate-spin" />
            </div>
          ) : summary ? (
            <div className="space-y-6">
              {/* 元数据 */}
              <div className="grid grid-cols-2 gap-4 p-4 bg-muted rounded-lg">
                <div>
                  <div className="text-sm text-muted-foreground">{t("timeRange")}</div>
                  <div className="font-medium">
                    {summary.period_start
                      ? new Date(summary.period_start).toLocaleDateString("zh-CN")
                      : "-"}{" "}
                    -{" "}
                    {summary.period_end
                      ? new Date(summary.period_end).toLocaleDateString("zh-CN")
                      : "-"}
                  </div>
                </div>
                <div>
                  <div className="text-sm text-muted-foreground">{t("contentCount")}</div>
                  <div className="font-medium">
                    {summary.item_count} {t("items")}
                  </div>
                </div>
                <div>
                  <div className="text-sm text-muted-foreground">{t("triggerMethod")}</div>
                  <div className="font-medium">
                    {summary.triggered_by === "manual" ? t("manual") : t("scheduled")}
                  </div>
                </div>
                <div>
                  <div className="text-sm text-muted-foreground">{t("generatedAt")}</div>
                  <div className="font-medium">
                    {new Date(summary.created_at).toLocaleString("zh-CN")}
                  </div>
                </div>
              </div>

              {/* 处理中状态 */}
              {(summary.status === "pending" || summary.status === "processing") && (
                <div className="flex items-center justify-center py-8 text-muted-foreground">
                  <Loader2 className="h-5 w-5 animate-spin mr-2" />
                  {t("reportGenerating")}
                </div>
              )}

              {/* 失败状态 */}
              {summary.status === "failed" && (
                <div className="text-center py-8 text-muted-foreground">
                  {summary.item_count === 0 ? (
                    t("noContentInPeriod")
                  ) : (
                    <span className="text-destructive">{t("reportGenerationFailed")}</span>
                  )}
                </div>
              )}

              {/* 报告内容 */}
              {summary.status === "completed" && summary.summary_text && (
                <div className="prose prose-sm max-w-none dark:prose-invert">
                  <ReactMarkdown>{summary.summary_text}</ReactMarkdown>
                </div>
              )}

              {/* 高亮列表 */}
              {summary.status === "completed" &&
                summary.highlights &&
                summary.highlights.length > 0 && (
                  <div className="space-y-3">
                    <h3 className="font-semibold">{t("featuredContent")}</h3>
                    <div className="space-y-2">
                      {summary.highlights.map((highlight, index) => (
                        <div key={index} className="p-3 border rounded-lg space-y-1">
                          <div className="flex items-center gap-2">
                            <Badge variant="outline" className="text-xs">
                              {highlight.platform}
                            </Badge>
                            <a
                              href={highlight.link}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="font-medium text-primary hover:underline flex items-center gap-1"
                            >
                              {highlight.title}
                              <ExternalLink className="h-3 w-3" />
                            </a>
                          </div>
                          <p className="text-sm text-muted-foreground">{highlight.summary}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
            </div>
          ) : (
            <div className="text-center py-8 text-muted-foreground">{tc("noData")}</div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
