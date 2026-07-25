"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ChevronDown, ChevronRight, Loader2 } from "lucide-react";
import { latestReject, reviewActionLabelKey } from "@/lib/reviewLog";
import { useReviewLog } from "@/hooks/useReviews";
import type { ReviewLogItem, ReviewTargetType } from "@/types/review";

interface ReviewLogDialogProps {
  targetType: ReviewTargetType;
  /** null = 关闭（惰性：打开才拉取审核日志） */
  targetId: number | null;
  /** 对话框描述用的目标名称 */
  targetName?: string;
  onOpenChange: (open: boolean) => void;
}

function formatTime(dateStr: string | null): string {
  if (!dateStr) return "-";
  const date = new Date(dateStr);
  return Number.isNaN(date.getTime()) ? dateStr : date.toLocaleString();
}

/** 驳回理由 / 审核记录弹窗：最近一条 reject 突出展示，更早记录折叠列出 */
export default function ReviewLogDialog({
  targetType,
  targetId,
  targetName,
  onOpenChange,
}: ReviewLogDialogProps) {
  const t = useTranslations("reviews");
  const open = targetId !== null;
  const { items, loading, error } = useReviewLog(targetType, targetId, open);
  const [historyExpanded, setHistoryExpanded] = useState(false);

  // 每次打开收起历史记录
  useEffect(() => {
    if (open) setHistoryExpanded(false);
  }, [open]);

  const reject = latestReject(items);
  const history = reject ? items.filter((item) => item !== reject) : items;

  const actionLabel = (item: ReviewLogItem) => {
    const key = reviewActionLabelKey(item.action);
    return key ? t(key) : item.action || "-";
  };

  const renderHistoryRow = (item: ReviewLogItem) => (
    <div key={item.id} className="flex items-start gap-2 py-1.5 text-sm">
      <Badge variant={item.action === "reject" ? "destructive" : "secondary"} className="shrink-0">
        {actionLabel(item)}
      </Badge>
      <div className="min-w-0 flex-1">
        <div className="text-xs text-muted-foreground">
          {item.actor_name || t("reviewerFallback")} · {formatTime(item.created_at)}
        </div>
        {item.comment && (
          <p className="mt-0.5 whitespace-pre-wrap break-words text-sm">{item.comment}</p>
        )}
      </div>
    </div>
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("reviewLogTitle")}</DialogTitle>
          {targetName && (
            <DialogDescription>{t("reviewLogDesc", { name: targetName })}</DialogDescription>
          )}
        </DialogHeader>

        {loading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : error ? (
          <p className="py-4 text-sm text-muted-foreground">{t("reviewLogLoadFailed")}</p>
        ) : items.length === 0 ? (
          <p className="py-4 text-sm text-muted-foreground">{t("noReviewLog")}</p>
        ) : (
          <div className="space-y-3">
            {/* 最近一条驳回：理由 + 审核人 + 时间 */}
            {reject && (
              <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3 space-y-1">
                <div className="text-xs font-medium text-destructive">
                  {t("latestRejectReason")}
                </div>
                <p className="whitespace-pre-wrap break-words text-sm">
                  {reject.comment || t("noComment")}
                </p>
                <div className="text-xs text-muted-foreground">
                  {reject.actor_name || t("reviewerFallback")} · {formatTime(reject.created_at)}
                </div>
              </div>
            )}

            {/* 更早记录：有突出块时折叠，无驳回时直接平铺 */}
            {history.length > 0 &&
              (reject ? (
                <div>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 px-1 text-xs text-muted-foreground"
                    onClick={() => setHistoryExpanded((v) => !v)}
                  >
                    {historyExpanded ? (
                      <ChevronDown className="h-3.5 w-3.5 mr-1" />
                    ) : (
                      <ChevronRight className="h-3.5 w-3.5 mr-1" />
                    )}
                    {t("earlierRecords", { count: history.length })}
                  </Button>
                  {historyExpanded && (
                    <div className="mt-1 max-h-64 overflow-auto divide-y">
                      {history.map(renderHistoryRow)}
                    </div>
                  )}
                </div>
              ) : (
                <div className="max-h-72 overflow-auto divide-y">
                  {history.map(renderHistoryRow)}
                </div>
              ))}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
