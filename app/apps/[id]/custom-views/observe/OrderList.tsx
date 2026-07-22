"use client";

import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ChevronLeft, ChevronRight, FileCheck, FileText, Search } from "lucide-react";
import { FAILED_PHASE_TO_STATE } from "./types";
import type { ObserveOrderListItem, OrderState } from "./types";
import { formatDateTime } from "./time";

// 状态用小圆点 + 中性文字表达（Linear 风格）：色彩落在圆点上，文字保持中性以稳过 WCAG AA
const STATE_DOT: Record<OrderState, string> = {
  queued: "bg-muted-foreground/40",
  downloading: "bg-blue-500", // info 语义 token 在租户主题下可能算出非法值，这里用可靠的蓝
  archived: "bg-blue-500",
  reviewing: "bg-warning",
  done: "bg-success",
  failed: "bg-destructive",
};

// 列表项左侧文件图标的底色：按状态着色，给单调列表一点语义色锚点
const STATE_ICON: Record<OrderState, string> = {
  queued: "bg-slate-100 text-slate-500",
  downloading: "bg-blue-100 text-blue-600",
  archived: "bg-indigo-100 text-indigo-600",
  reviewing: "bg-amber-100 text-amber-600",
  done: "bg-emerald-100 text-emerald-600",
  failed: "bg-red-100 text-red-600",
};

interface OrderListProps {
  // 标题可选：作为 Tab 内容渲染时由 Tab 触发器承担标题，这里只留搜索 + 表格
  title?: string;
  // count / empty 文案由调用方按列表类型传入，避免共享组件写死某一类的 i18n key
  countLabel?: string;
  emptyText: string;
  total: number;
  items: ObserveOrderListItem[];
  page: number;
  pageSize: number;
  selectedOrderId: string | null;
  onSelect: (orderId: string) => void;
  onPageChange: (page: number) => void;
  loading?: boolean;
  search?: { value: string; onChange: (v: string) => void; placeholder: string };
  // 时间列：进行中看创建时间，已结束看结束时间
  timeColumn?: "createdAt" | "endTime";
  // 已完成工单点「AI 预审报告」图标：上抛给页面统一弹窗（深链自动弹也复用同一弹窗）
  onOpenReport?: (order: ObserveOrderListItem) => void;
}

export function OrderList({
  title,
  countLabel,
  emptyText,
  total,
  items,
  page,
  pageSize,
  selectedOrderId,
  onSelect,
  onPageChange,
  loading,
  search,
  timeColumn = "createdAt",
  onOpenReport,
}: OrderListProps) {
  const t = useTranslations("zdObserve");
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  // done 但预审报告有问题(issueCount>0):状态文案仍「已完成」,但圆点/图标染黄提示有未通过项
  const hasReviewIssues = (o: ObserveOrderListItem) =>
    o.state === "done" && (o.reviewIssueCount ?? 0) > 0;

  return (
    <div className="space-y-2">
      {(title || search) && (
        <div className={`flex items-center gap-4 ${title ? "justify-between" : "justify-end"}`}>
          {title && (
            <h3 className="text-sm font-semibold">
              {title}
              <span className="ml-1 text-muted-foreground font-normal">{countLabel}</span>
            </h3>
          )}
          {search && (
            <div className="relative w-80 max-w-full">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
              <Input
                value={search.value}
                onChange={(e) => search.onChange(e.target.value)}
                placeholder={search.placeholder}
                className="pl-10 h-9"
              />
            </div>
          )}
        </div>
      )}

      <div className="rounded-lg border divide-y overflow-hidden">
        {items.map((o) => {
          const isSelected = selectedOrderId === o.orderId;
          // 时间列：进行中看创建时间；已结束看结束时间——即 updatedAt（进入终态的时刻，
          // 后端返回的 endTime 实为 OA 交期，非完成时间）。两者都是 ISO，统一按东八区格式化。
          const timeLabel =
            timeColumn === "endTime" ? t("orderColumns.endTime") : t("orderColumns.createdAt");
          const timeValue = formatDateTime(timeColumn === "endTime" ? o.updatedAt : o.createdAt);
          return (
            // 行用 div 而非 button：button 内文字无法框选，用户要能拖选复制单号
            // biome-ignore lint/a11y/useSemanticElements: 见上，刻意用 div 以支持文字选择
            <div
              key={o.orderId}
              role="button"
              tabIndex={0}
              // 拖选文字（复制单号）时 getSelection 非空，跳过跳转，避免一选就误触
              onClick={() => {
                if (window.getSelection()?.toString()) return;
                onSelect(o.orderId);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  onSelect(o.orderId);
                }
              }}
              // 选中态用主题色：左侧强调条 + 主题底色；未选中保留透明边占位避免抖动
              className={`flex w-full cursor-pointer items-center gap-3 border-l-2 px-3 py-2.5 text-left transition-colors ${
                isSelected
                  ? "border-l-primary bg-primary/10 hover:bg-primary/10"
                  : "border-l-transparent hover:bg-muted/40"
              }`}
            >
              <span
                className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${
                  hasReviewIssues(o) ? "bg-amber-100 text-amber-600" : STATE_ICON[o.state]
                }`}
              >
                <FileText className="h-[18px] w-[18px]" />
              </span>

              <div className="min-w-0 flex-1">
                <div
                  className={`truncate text-sm font-medium ${isSelected ? "text-primary" : ""}`}
                  title={o.productName}
                >
                  {o.productName}
                </div>
                {/* 单号 / 产品号：可框选复制；阻止冒泡，点/拖这行都不触发行跳转 */}
                {/* biome-ignore lint/a11y/noStaticElementInteractions: 仅用于阻止冒泡以保留文字选择，非交互控件 */}
                {/* biome-ignore lint/a11y/useKeyWithClickEvents: 同上，无独立语义，键盘操作由整行承担 */}
                <div
                  className="w-fit max-w-full truncate text-xs text-muted-foreground select-text cursor-text"
                  onClick={(e) => e.stopPropagation()}
                  onMouseDown={(e) => e.stopPropagation()}
                >
                  {o.serialNumber}
                  {o.productCode ? ` · ${o.productCode}` : ""}
                </div>
              </div>

              {/* 右侧元数据列：minWidth 保底逐行对齐（inline style 保证生成），空值也占位。
                  客户名 92~350px 内不截断（列自行撑开，挤占左侧产品名的 flex 富余），超 350px 才截断 */}
              <div
                className="shrink-0 whitespace-nowrap text-right"
                style={{ minWidth: 92, maxWidth: 350 }}
              >
                {o.customerName && (
                  <>
                    <div className="text-[11px] text-muted-foreground">
                      {t("orderColumns.customer")}
                    </div>
                    <div className="truncate text-xs" title={o.customerName}>
                      {o.customerName}
                    </div>
                  </>
                )}
              </div>
              <div className="shrink-0 text-right" style={{ width: 128 }}>
                {timeValue && (
                  <>
                    <div className="text-[11px] text-muted-foreground">{timeLabel}</div>
                    <div className="text-xs text-muted-foreground">{timeValue}</div>
                  </>
                )}
              </div>

              <span
                className="inline-flex shrink-0 items-center justify-end gap-1.5 text-xs text-muted-foreground"
                style={{ width: 100 }}
              >
                <span
                  className={`h-1.5 w-1.5 shrink-0 rounded-full ${
                    hasReviewIssues(o) ? "bg-amber-500" : STATE_DOT[o.state]
                  }`}
                />
                <span className="truncate">
                  {o.stateLabel}
                  {o.state === "failed" && o.failedPhase
                    ? ` · ${t(`states.${FAILED_PHASE_TO_STATE[o.failedPhase]}` as never)}`
                    : ""}
                </span>
              </span>

              {/* 动作位：固定宽度占位，逐行对齐；已完成工单显示报告图标，点击打开 */}
              <div className="flex shrink-0 justify-center" style={{ width: 32 }}>
                {o.state === "done" && (
                  <button
                    type="button"
                    title={t("reviewReport.button")}
                    aria-label={t("reviewReport.button")}
                    onClick={(e) => {
                      e.stopPropagation();
                      onOpenReport?.(o);
                    }}
                    // 键盘 Enter/Space 会冒泡到整行的 onKeyDown 触发选中，这里拦掉避免「开弹窗 + 选中」双触发
                    onKeyDown={(e) => e.stopPropagation()}
                    className="flex h-7 w-7 items-center justify-center rounded-md text-primary transition-colors hover:bg-primary/10"
                  >
                    <FileCheck className="h-4 w-4" />
                  </button>
                )}
              </div>
            </div>
          );
        })}
        {items.length === 0 && (
          <div className="px-3 py-6 text-center text-sm text-muted-foreground">
            {loading ? "…" : emptyText}
          </div>
        )}
      </div>

      {totalPages > 1 && (
        <div className="flex items-center justify-end gap-2 text-sm text-muted-foreground">
          <Button
            variant="outline"
            size="sm"
            disabled={page <= 1}
            onClick={() => onPageChange(page - 1)}
          >
            <ChevronLeft className="h-4 w-4" />
            {t("pagination.prev")}
          </Button>
          <span>{t("pagination.pageInfo", { page, totalPages })}</span>
          <Button
            variant="outline"
            size="sm"
            disabled={page >= totalPages}
            onClick={() => onPageChange(page + 1)}
          >
            {t("pagination.next")}
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      )}
    </div>
  );
}
