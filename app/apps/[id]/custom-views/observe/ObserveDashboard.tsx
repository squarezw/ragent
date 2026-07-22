"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  AlertCircle,
  AlertTriangle,
  ChevronDown,
  Clock,
  Eye,
  FileText,
  Search,
  TrendingUp,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { Input } from "@/components/ui/input";
import { FAILED_PHASE_TO_STATE } from "./types";
import {
  fetchActiveOrders,
  fetchOrderDetail,
  fetchOrderLogs,
  fetchSummary,
  fetchTerminalOrders,
} from "./api";
import type {
  ObserveLogItem,
  ObserveOrderDetailData,
  ObserveOrderListData,
  ObserveOrderListItem,
  ObserveSummaryData,
  OrderState,
} from "./types";
import { OrderList } from "./OrderList";
import { ProcessAxis } from "./ProcessAxis";
import { ParamsPanel } from "./ParamsPanel";
import { LogsPanel } from "./LogsPanel";
import { ReviewReportModal } from "./ReviewReportModal";
import { deriveReviewReport } from "./deriveReport";

// 报告弹窗需要的最小工单信息（列表项 / 详情 order 都能提供）;
// 报告本体（reviewReport 原始 JSON）在详情接口里，打开弹窗时按 orderId 拉
type ReportTarget = Pick<ObserveOrderListItem, "orderId" | "serialNumber" | "productName">;

const POLL_INTERVAL_MS = 30_000;
const LOG_LIMIT = 100;

const EMPTY_LIST: ObserveOrderListData = { items: [], page: 1, pageSize: 5, total: 0 };

export default function ObserveDashboard() {
  const t = useTranslations("zdObserve");

  // 深链：?orderId=PROD_xxx 直接定位该工单（按单号拉详情，不要求它在当前列表/分页内）
  const searchParams = useSearchParams();
  const initialOrderId = searchParams?.get("orderId") ?? null;

  const [summary, setSummary] = useState<ObserveSummaryData | null>(null);
  const [loadError, setLoadError] = useState(false);

  const [ordersTab, setOrdersTab] = useState<"active" | "terminal">("active");
  // 出入参 / 节点日志详情默认折叠，点开再展开——首屏只露流程时间轴，信息密度可控
  const [detailExpanded, setDetailExpanded] = useState(false);

  // AI 预审报告弹窗（行内图标 + 深链自动弹共用）
  const [reportTarget, setReportTarget] = useState<ReportTarget | null>(null);
  // 报告数据 = 该工单详情（reviewReport 原始 JSON + 派生要用的 order 字段）
  const [reportDetail, setReportDetail] = useState<ObserveOrderDetailData | null>(null);
  // 拉取三态：loading 转圈 / error 失败提示 / ready 且 report=null 才是「确实没有报告」
  const [reportStatus, setReportStatus] = useState<"loading" | "error" | "ready">("ready");
  // 防竞态：快速连点不同工单的报告图标时，只接受「仍是当前弹窗工单」的响应
  const reportOrderIdRef = useRef<string | null>(null);
  // 深链命中已完成单时，延迟自动弹报告的定时器——卸载时清掉，避免 setState on unmounted
  const reportTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => clearTimeout(reportTimerRef.current ?? undefined), []);

  // 手动点报告图标：先作废深链待弹定时器，免得 1s 后又被切回深链那个单。
  // preloaded：深链路径已经拉过详情，直接复用，不再打一次接口。
  const openReport = useCallback((order: ReportTarget, preloaded?: ObserveOrderDetailData) => {
    clearTimeout(reportTimerRef.current ?? undefined);
    reportOrderIdRef.current = order.orderId;
    setReportTarget(order);
    setReportDetail(preloaded ?? null);
    if (preloaded) {
      setReportStatus("ready");
      return;
    }
    setReportStatus("loading");
    // 失败提示只在弹窗里给（fetchStatus=error），压掉全局错误 toast——否则
    // 「后端原始报错 toast + 弹窗良性占位」两个矛盾信号同时出现
    fetchOrderDetail(order.orderId, { suppressErrorToast: true })
      .then((d) => {
        if (reportOrderIdRef.current !== order.orderId) return;
        setReportDetail(d);
        setReportStatus("ready");
      })
      .catch(() => {
        if (reportOrderIdRef.current !== order.orderId) return;
        setReportStatus("error");
      });
  }, []);

  const closeReport = useCallback(() => {
    reportOrderIdRef.current = null;
    setReportTarget(null);
    setReportDetail(null);
    setReportStatus("ready");
  }, []);

  // 原始 JSON → 展示模型（规则见 deriveReport.ts）;弹窗未开 / 报告未落库时为 null
  const reviewReport = useMemo(
    () => (reportDetail ? deriveReviewReport(reportDetail) : null),
    [reportDetail]
  );

  const [activePage, setActivePage] = useState(1);
  const [activeQ, setActiveQ] = useState("");
  const [activeQDebounced, setActiveQDebounced] = useState("");
  const [activeData, setActiveData] = useState<ObserveOrderListData>(EMPTY_LIST);

  const [terminalPage, setTerminalPage] = useState(1);
  const [terminalQ, setTerminalQ] = useState("");
  const [terminalQDebounced, setTerminalQDebounced] = useState("");
  const [terminalData, setTerminalData] = useState<ObserveOrderListData>(EMPTY_LIST);

  const [selectedOrderId, setSelectedOrderId] = useState<string | null>(null);
  const [detail, setDetail] = useState<ObserveOrderDetailData | null>(null);

  const [selectedPhase, setSelectedPhase] = useState<OrderState | null>(null);
  const [errorOnly, setErrorOnly] = useState(false);
  const [logs, setLogs] = useState<ObserveLogItem[]>([]);
  const [logsAfter, setLogsAfter] = useState<number | null>(null);
  const [logsHasMore, setLogsHasMore] = useState(false);
  const [logsLoading, setLogsLoading] = useState(false);

  // 已展示日志的 id 集合：增量轮询 / 加载更多统一按 id 去重——避免 nextAfter 为 null 时整批重拉导致重复，
  // 也避免轮询与「加载更多」并发拉到同一页时双重追加。
  const seenLogIdsRef = useRef<Set<number>>(new Set());

  // 仅轮询 refreshAll 用：把选中态塞进 ref，避免列进依赖导致 30s 定时器频繁重建
  const stateRef = useRef({ selectedOrderId, selectedPhase, errorOnly });
  stateRef.current = { selectedOrderId, selectedPhase, errorOnly };

  // ── 搜索防抖（回到第 1 页）──
  useEffect(() => {
    const id = setTimeout(() => {
      setTerminalQDebounced(terminalQ);
      setTerminalPage(1);
    }, 400);
    return () => clearTimeout(id);
  }, [terminalQ]);

  useEffect(() => {
    const id = setTimeout(() => {
      setActiveQDebounced(activeQ);
      setActivePage(1);
    }, 400);
    return () => clearTimeout(id);
  }, [activeQ]);

  // ── 列表 / 统计卡：随分页、搜索变化拉取 ──
  const loadLists = useCallback(async () => {
    const [s, a, tm] = await Promise.all([
      fetchSummary(),
      fetchActiveOrders(activePage, activeQDebounced),
      fetchTerminalOrders(terminalPage, terminalQDebounced),
    ]);
    setSummary(s);
    setActiveData(a);
    setTerminalData(tm);
  }, [activePage, activeQDebounced, terminalPage, terminalQDebounced]);

  useEffect(() => {
    loadLists()
      .then(() => setLoadError(false))
      .catch(() => setLoadError(true));
  }, [loadLists]);

  // ── 选中工单：拉详情，并默认选中当前活跃/失败节点 ──
  const loadDetail = useCallback(
    async (orderId: string, opts?: { suppressErrorToast?: boolean }) => {
      const d = await fetchOrderDetail(orderId, opts);
      setDetail(d);
      return d;
    },
    []
  );

  const handleSelectOrder = useCallback(
    async (orderId: string, opts?: { fromDeepLink?: boolean }) => {
      // 选了新工单：作废上一个深链待弹的报告定时器，避免它稍后把弹窗强行切回旧单（竞态）
      clearTimeout(reportTimerRef.current ?? undefined);
      setSelectedOrderId(orderId);
      setSelectedPhase(null);
      setLogs([]);
      seenLogIdsRef.current = new Set();
      setLogsAfter(null);
      setLogsHasMore(false);
      try {
        // 深链失败属预期（失效书签 / 错单号）：关掉全局 toast，下面给本地化提示，不弹后端原始英文
        const d = await loadDetail(orderId, { suppressErrorToast: opts?.fromDeepLink });
        // 默认聚焦失败节点，否则活跃节点
        const focus =
          d.nodes.find((n) => n.status === "failed") ?? d.nodes.find((n) => n.status === "active");
        if (focus) setSelectedPhase(focus.phase);

        // 深链命中已完成工单：切到「已结束」Tab 定位，1s 后自动弹出预审报告。
        // 详情刚拉过，直接作为 preloaded 传入，弹窗不再重复打详情接口。
        if (opts?.fromDeepLink && d.order.state === "done") {
          setOrdersTab("terminal");
          reportTimerRef.current = setTimeout(() => {
            openReport(
              {
                orderId: d.order.orderId,
                serialNumber: d.order.serialNumber,
                productName: d.order.productName,
              },
              d
            );
          }, 1000);
        }
      } catch {
        // 深链给的单号无效（失效书签 / 手敲错单号）：清掉选中，让下方默认选中 effect 回退到第一个
        // 进行中工单——否则页面卡在错误态，且 30s 轮询会反复拿这个坏单号去打详情接口。
        // 普通列表点击失败只报错、不回退：那个单号本来就在列表里，回退会和 effect 形成无限循环。
        if (opts?.fromDeepLink) {
          setSelectedOrderId(null);
          toast.error(t("deepLinkNotFound", { id: orderId }));
        } else {
          setLoadError(true);
        }
      }
    },
    [loadDetail, openReport, t]
  );

  // 进页面默认选中：优先 ?order= 深链指定的工单，否则回退到第一个进行中工单。
  // 仅在尚无选中时触发，不打断用户后续手动选择；深链只认一次，处理过就不再抢占。
  const deepLinkHandledRef = useRef(false);
  useEffect(() => {
    if (selectedOrderId) return;
    if (!deepLinkHandledRef.current && initialOrderId) {
      deepLinkHandledRef.current = true;
      handleSelectOrder(initialOrderId, { fromDeepLink: true });
      return;
    }
    const first = activeData.items[0];
    if (first) handleSelectOrder(first.orderId);
  }, [activeData, selectedOrderId, initialOrderId, handleSelectOrder]);

  // 列表点击：选中后把「流程追踪」滚进视口（已完成工单在页底，需上滚才看得到）。
  // 只置 flag，等 detail 加载完、卡片高度稳定后再滚（见下方 effect），避免 fetch 期间布局抖动导致落点偏移；
  // 也借此避开 30s 轮询刷新 detail / 初次自动选中时误滚（那两条路径不会置 flag）。
  const axisRef = useRef<HTMLDivElement>(null);
  const shouldScrollRef = useRef(false);
  const handleSelectFromList = useCallback(
    (orderId: string) => {
      shouldScrollRef.current = true;
      handleSelectOrder(orderId);
    },
    [handleSelectOrder]
  );

  useEffect(() => {
    if (!shouldScrollRef.current || !detail) return;
    shouldScrollRef.current = false;
    requestAnimationFrame(() => {
      axisRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  }, [detail]);

  // 按 id 去重追加：返回是否真的追加了新日志（轮询据此决定要不要推进游标）。
  const appendLogs = useCallback((items: ObserveLogItem[]) => {
    const fresh = items.filter((l) => !seenLogIdsRef.current.has(l.id));
    if (fresh.length === 0) return false;
    for (const l of fresh) seenLogIdsRef.current.add(l.id);
    setLogs((prev) => [...prev, ...fresh]);
    return true;
  }, []);

  // ── 节点日志：phase / errorOnly 变化时重新拉一批 ──
  const loadLogsFresh = useCallback(
    async (orderId: string, phase: OrderState, onlyError: boolean) => {
      setLogsLoading(true);
      try {
        const data = await fetchOrderLogs(orderId, {
          phase,
          level: onlyError ? "error" : undefined,
          limit: LOG_LIMIT,
        });
        seenLogIdsRef.current = new Set(data.items.map((l) => l.id));
        setLogs(data.items);
        setLogsAfter(data.nextAfter);
        setLogsHasMore(data.hasMore);
      } finally {
        setLogsLoading(false);
      }
    },
    []
  );

  useEffect(() => {
    if (!selectedOrderId || !selectedPhase) return;
    loadLogsFresh(selectedOrderId, selectedPhase, errorOnly).catch(() => setLoadError(true));
  }, [selectedOrderId, selectedPhase, errorOnly, loadLogsFresh]);

  const handleLoadMore = useCallback(async () => {
    if (!selectedOrderId || !selectedPhase || logsAfter == null) return;
    setLogsLoading(true);
    try {
      const data = await fetchOrderLogs(selectedOrderId, {
        phase: selectedPhase,
        level: errorOnly ? "error" : undefined,
        after: logsAfter,
        limit: LOG_LIMIT,
      });
      appendLogs(data.items);
      setLogsAfter(data.nextAfter);
      setLogsHasMore(data.hasMore);
    } finally {
      setLogsLoading(false);
    }
  }, [selectedOrderId, selectedPhase, errorOnly, logsAfter, appendLogs]);

  // logsAfter 给轮询用的 ref（避免把它列进 refreshAll 依赖导致定时器重建）
  const logsAfterRef = useRef<number | null>(logsAfter);
  logsAfterRef.current = logsAfter;

  // ── 统一刷新（手动按钮 + 30s 轮询共用）──
  const refreshAll = useCallback(async () => {
    const { selectedOrderId, selectedPhase, errorOnly } = stateRef.current;
    try {
      await loadLists();
      if (selectedOrderId) await loadDetail(selectedOrderId);
      // 日志增量：带 after 拉新增追加（不重复全量）
      if (selectedOrderId && selectedPhase) {
        const after = logsAfterRef.current;
        const data = await fetchOrderLogs(selectedOrderId, {
          phase: selectedPhase,
          level: errorOnly ? "error" : undefined,
          after: after ?? undefined,
          limit: LOG_LIMIT,
        });
        if (appendLogs(data.items)) {
          setLogsAfter(data.nextAfter);
          setLogsHasMore(data.hasMore);
        }
      }
      setLoadError(false);
    } catch {
      setLoadError(true);
    }
  }, [loadLists, loadDetail, appendLogs]);

  // refreshAll 会随分页/搜索变化而重建；用 ref 持有最新版本，让下方定时器只在挂载时建一次，
  // 否则每次翻页或搜索都会把 30s 轮询时钟整个重置，频繁操作的用户永远等不到自动刷新。
  const refreshAllRef = useRef(refreshAll);
  refreshAllRef.current = refreshAll;

  // ── 30s 静默轮询 ──
  useEffect(() => {
    const poll = setInterval(() => {
      refreshAllRef.current();
    }, POLL_INTERVAL_MS);
    return () => clearInterval(poll);
  }, []);

  return (
    <div className="space-y-4 animate-in fade-in duration-500">
      {loadError && (
        <div className="flex items-center gap-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          <AlertCircle className="h-4 w-4" />
          {t("loadFailed")}
          <Button variant="ghost" size="sm" className="h-6 ml-auto" onClick={refreshAll}>
            {t("retry")}
          </Button>
        </div>
      )}

      {/* 统计卡 */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          {
            label: t("stats.total"),
            value: summary?.total,
            icon: FileText,
            iconClass: "text-blue-500 bg-blue-50",
          },
          {
            label: t("stats.inProgress"),
            value: summary?.inProgress,
            icon: Clock,
            iconClass: "text-amber-500 bg-amber-50",
          },
          {
            label: t("stats.reviewing"),
            value: summary?.reviewing,
            icon: Eye,
            iconClass: "text-violet-500 bg-violet-50",
          },
          {
            label: t("stats.avgProgress"),
            value: summary ? `${Math.round(summary.avgProgress * 100)}%` : undefined,
            icon: TrendingUp,
            iconClass: "text-emerald-500 bg-emerald-50",
          },
        ].map((s, i) => (
          <StatCard
            key={s.label}
            label={s.label}
            value={s.value}
            icon={s.icon}
            iconClass={s.iconClass}
            index={i}
          />
        ))}
      </div>

      {/* 流程追踪 + 出入参 + 节点日志 */}
      <Card ref={axisRef} className="scroll-mt-4 p-4 space-y-4">
        <h3 className="text-sm font-semibold">{t("axis.title")}</h3>
        {detail ? (
          <>
            <ProcessAxis
              nodes={detail.nodes}
              selectedPhase={selectedPhase}
              onSelectPhase={setSelectedPhase}
            />
            <Separator />
            {detail.order.failedPhase && (
              <div className="flex items-center gap-2 rounded-md bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700">
                <AlertTriangle className="h-4 w-4 shrink-0" />
                <span>
                  {t("axis.failedBanner", {
                    phase: t(`states.${FAILED_PHASE_TO_STATE[detail.order.failedPhase]}` as never),
                    reason: detail.order.failureReason || "—",
                  })}
                </span>
              </div>
            )}
            <button
              type="button"
              onClick={() => setDetailExpanded((v) => !v)}
              className="flex w-full items-center justify-between text-sm font-semibold hover:text-foreground"
            >
              <span>{t("axis.details")}</span>
              <span className="flex items-center gap-1 text-xs font-normal text-muted-foreground">
                {detailExpanded ? t("axis.collapse") : t("axis.expand")}
                <ChevronDown
                  className={`h-4 w-4 transition-transform ${detailExpanded ? "rotate-180" : ""}`}
                />
              </span>
            </button>
            {detailExpanded && (
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                <div>
                  <h4 className="mb-2 text-sm font-semibold">{t("params.title")}</h4>
                  <ParamsPanel params={detail.params} />
                </div>
                <div>
                  <LogsPanel
                    selectedPhase={selectedPhase}
                    logs={logs}
                    errorOnly={errorOnly}
                    onErrorOnlyChange={setErrorOnly}
                    hasMore={logsHasMore}
                    onLoadMore={handleLoadMore}
                    loading={logsLoading}
                  />
                </div>
              </div>
            )}
          </>
        ) : (
          <div className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
            {t("axis.selectPrompt")}
          </div>
        )}
      </Card>

      {/* 进行中 / 已结束 工单（Tab 切换）*/}
      <Tabs value={ordersTab} onValueChange={(v) => setOrdersTab(v as "active" | "terminal")}>
        {/* Tab 与搜索框同一行：搜索按当前 Tab 切换绑定的查询态 */}
        <div className="flex items-center justify-between gap-4">
          <TabsList>
            <TabsTrigger value="active">
              {t("ordersTabs.active")}
              <span className="ml-1.5 text-xs text-muted-foreground tabular-nums">
                {activeData.total}
              </span>
            </TabsTrigger>
            <TabsTrigger value="terminal">
              {t("ordersTabs.terminal")}
              <span className="ml-1.5 text-xs text-muted-foreground tabular-nums">
                {terminalData.total}
              </span>
            </TabsTrigger>
          </TabsList>

          <div className="relative w-80 max-w-full">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
            {ordersTab === "active" ? (
              <Input
                value={activeQ}
                onChange={(e) => setActiveQ(e.target.value)}
                placeholder={t("activeOrders.searchPlaceholder")}
                className="pl-10 h-9"
              />
            ) : (
              <Input
                value={terminalQ}
                onChange={(e) => setTerminalQ(e.target.value)}
                placeholder={t("terminalOrders.searchPlaceholder")}
                className="pl-10 h-9"
              />
            )}
          </div>
        </div>

        <TabsContent value="active" className="mt-3">
          <OrderList
            emptyText={t("activeOrders.empty")}
            total={activeData.total}
            items={activeData.items}
            page={activePage}
            pageSize={5}
            selectedOrderId={selectedOrderId}
            onSelect={handleSelectFromList}
            onPageChange={setActivePage}
            onOpenReport={openReport}
          />
        </TabsContent>

        <TabsContent value="terminal" className="mt-3">
          <OrderList
            emptyText={t("terminalOrders.empty")}
            total={terminalData.total}
            items={terminalData.items}
            page={terminalPage}
            pageSize={20}
            selectedOrderId={selectedOrderId}
            onSelect={handleSelectFromList}
            onPageChange={setTerminalPage}
            timeColumn="endTime"
            onOpenReport={openReport}
          />
        </TabsContent>
      </Tabs>

      <ReviewReportModal
        open={reportTarget !== null}
        onOpenChange={(open) => {
          if (!open) closeReport();
        }}
        serialNumber={reportTarget?.serialNumber ?? ""}
        productName={reportTarget?.productName ?? ""}
        report={reviewReport}
        rawReport={reportDetail?.reviewReport ?? null}
        fetchStatus={reportStatus}
      />
    </div>
  );
}

function StatCard({
  label,
  value,
  icon: Icon,
  iconClass,
  index = 0,
}: {
  label: string;
  value: number | string | undefined;
  icon: LucideIcon;
  iconClass: string;
  index?: number;
}) {
  return (
    <Card
      className="flex items-center gap-3 p-4 animate-in fade-in slide-in-from-bottom-1 fill-mode-both"
      style={{ animationDelay: `${index * 60}ms`, animationDuration: "400ms" }}
    >
      <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${iconClass}`}>
        <Icon className="h-[18px] w-[18px]" />
      </span>
      <div className="min-w-0">
        <div className="text-xs text-muted-foreground">{label}</div>
        <div className="mt-0.5 text-xl font-bold tabular-nums text-foreground">{value ?? "—"}</div>
      </div>
    </Card>
  );
}
