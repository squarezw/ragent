"use client";

import { useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  type GroupBy,
  type UsageFilters,
  type UsageTurnRow,
  useCreditAccounts,
  useUsageSummary,
  useUsageTurns,
} from "@/hooks/useBilling";
import { ChevronDown, ChevronRight, Download } from "lucide-react";
import RechargeHistoryDialog from "./components/RechargeHistoryDialog";

/**
 * 用量明细。
 *
 * 层级：汇总（租户/用户/会话）→ 轮次明细 → 展开分项。
 * 每一笔积分都要能展开到产生它的那一轮，否则用户提出异议时无从解释。
 */
const RANGES: Array<{ key: string; label: string; days: number }> = [
  { key: "today", label: "今天", days: 0 },
  { key: "7d", label: "7 天", days: 7 },
  { key: "30d", label: "30 天", days: 30 },
];

function isoDay(offsetDays: number): string {
  const d = new Date();
  d.setDate(d.getDate() - offsetDays);
  return d.toISOString().slice(0, 10);
}

export default function BillingPage() {
  const [rangeKey, setRangeKey] = useState("7d");
  const [groupBy, setGroupBy] = useState<GroupBy>("user");
  const [drill, setDrill] = useState<{ userId?: number; sessionId?: number }>({});
  const [expanded, setExpanded] = useState<number | null>(null);

  const filters: UsageFilters = useMemo(() => {
    const r = RANGES.find((x) => x.key === rangeKey) ?? RANGES[1];
    return {
      groupBy,
      start: isoDay(r.days),
      end: isoDay(0),
      userId: drill.userId,
      sessionId: drill.sessionId,
    };
  }, [rangeKey, groupBy, drill]);

  const summary = useUsageSummary(filters);
  const turns = useUsageTurns(filters, 1, 100);
  const { accounts, totalBalance } = useCreditAccounts();
  const [historyTenant, setHistoryTenant] = useState<{ id: number; name: string } | null>(null);

  /**
   * 按租户汇总时，把「有余额但这段时间没消耗」的租户也并进来。
   *
   * 汇总表原本只列有消耗流水的租户。加了余额列之后，漏掉的那些租户会让
   * 「每行余额之和」对不上顶部的合计卡片 —— 一张自己和自己对不上的账，
   * 比没有这一列更糟。补进来的行轮次和 token 都是 0，那正是事实。
   */
  const tenantRows = useMemo(() => {
    if (groupBy !== "tenant") return summary.items;
    const seen = new Set(summary.items.map((r) => r.key));
    const extra = accounts
      .filter((a) => !seen.has(a.tenant_id))
      .map((a) => ({
        key: a.tenant_id,
        key_text: String(a.tenant_id),
        label: a.tenant_name ?? String(a.tenant_id),
        turns: 0,
        credits: 0,
        prompt_tokens: 0,
        completion_tokens: 0,
        cache_read_tokens: 0,
        last_at: null,
      }));
    return [...summary.items, ...extra];
  }, [groupBy, summary.items, accounts]);

  const balanceOfTenant = (tenantId: number | null) =>
    tenantId === null ? null : (accounts.find((a) => a.tenant_id === tenantId)?.balance ?? null);

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <h1 className="text-2xl font-semibold">用量明细</h1>
        <div className="flex items-center gap-2">
          {RANGES.map((r) => (
            <Button
              key={r.key}
              size="sm"
              variant={rangeKey === r.key ? "default" : "outline"}
              onClick={() => setRangeKey(r.key)}
            >
              {r.label}
            </Button>
          ))}
          <Button size="sm" variant="outline" onClick={() => exportCsv(turns.items)}>
            <Download className="h-3.5 w-3.5 mr-1.5" />
            导出
          </Button>
        </div>
      </div>

      {summary.error && (
        // 权限不足时必须说出来。静默空列表会被读成"这段时间没有消耗"
        <div className="rounded-md border border-destructive/50 text-destructive px-3 py-2 text-sm">
          {summary.error}
        </div>
      )}

      {/* 用 md: 而不是 sm:：项目里其他页面（monitoring / apps）都用 md:grid-cols-3，
          而 sm:grid-cols-3 全项目仅此一处。Tailwind 只生成扫到的类，新建目录下
          独一份的断点类容易在 JIT 增量构建里漏掉 —— 表现就是三块竖着排。
          跟着已有写法走，不给自己造一个只在这里用的类。 */}
      <div className={`grid grid-cols-1 gap-4 ${accounts.length > 0 ? "md:grid-cols-4" : "md:grid-cols-3"}`}>
        {/* 余额放第一块：用户打开这一页最常问的是「还剩多少」，
            而不是「花了多少」。没有组织账目知情范围的人拿到空集，卡片不出现，
            四列自动退回三列 —— 不给他们看到一个「余额 0」的假象。 */}
        {accounts.length > 0 && (
          <Stat
            label={accounts.length === 1 ? "剩余积分" : `剩余积分（${accounts.length} 个租户合计）`}
            value={totalBalance.toFixed(2)}
          />
        )}
        <Stat label="消耗积分" value={summary.totals.credits.toFixed(2)} />
        <Stat label="对话轮次" value={String(summary.totals.turns)} />
        <Stat
          label="折合人民币"
          // 1 元 = 5 积分
          value={`¥${(summary.totals.credits / 5).toFixed(2)}`}
        />
      </div>

      {/* 未登记的 tx_type 会让余额算漏，且没有任何症状 —— 所以报出来 */}
      {accounts.some((a) => a.unknown_tx > 0) && (
        <div className="rounded border border-amber-500/50 bg-amber-50 px-4 py-2 text-sm text-amber-900 dark:bg-amber-950 dark:text-amber-200">
          有 {accounts.reduce((n, a) => n + a.unknown_tx, 0)} 条流水的类型未登记，未计入余额。
          请检查后端 CREDIT_TX_SIGNS。
        </div>
      )}

      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-2">
          <CardTitle className="text-base">汇总</CardTitle>
          <div className="flex gap-1">
            {(["tenant", "user", "session"] as GroupBy[]).map((g) => (
              <Button
                key={g}
                size="sm"
                variant={groupBy === g ? "secondary" : "ghost"}
                onClick={() => {
                  setGroupBy(g);
                  setDrill({});
                }}
              >
                {g === "tenant" ? "按租户" : g === "user" ? "按用户" : "按会话"}
              </Button>
            ))}
          </div>
        </CardHeader>
        <CardContent>
          {summary.loading ? (
            <p className="text-sm text-muted-foreground py-4 text-center">加载中…</p>
          ) : summary.items.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4 text-center">这段时间没有消耗记录</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{groupBy === "session" ? "会话" : "名称"}</TableHead>
                  <TableHead className="text-right">轮次</TableHead>
                  <TableHead className="text-right">输入</TableHead>
                  <TableHead className="text-right">输出</TableHead>
                  <TableHead className="text-right">缓存命中</TableHead>
                  <TableHead className="text-right">积分</TableHead>
                  {groupBy === "tenant" && (
                    <>
                      <TableHead className="text-right">剩余积分</TableHead>
                      <TableHead className="w-28" />
                    </>
                  )}
                </TableRow>
              </TableHeader>
              <TableBody>
                {tenantRows.map((row) => (
                  <TableRow
                    key={`${row.key_text}`}
                    className="cursor-pointer"
                    onClick={() =>
                      setDrill(
                        groupBy === "user"
                          ? { userId: row.key ?? undefined }
                          : groupBy === "session"
                            ? { sessionId: row.key ?? undefined }
                            : {}
                      )
                    }
                  >
                    <TableCell>{row.label || row.key_text || "—"}</TableCell>
                    <TableCell className="text-right">{row.turns}</TableCell>
                    <TableCell className="text-right">
                      {row.prompt_tokens.toLocaleString()}
                    </TableCell>
                    <TableCell className="text-right">
                      {row.completion_tokens.toLocaleString()}
                    </TableCell>
                    <TableCell className="text-right text-emerald-600">
                      {row.cache_read_tokens.toLocaleString()}
                    </TableCell>
                    <TableCell className="text-right font-medium">
                      {Number(row.credits).toFixed(2)}
                    </TableCell>
                    {groupBy === "tenant" && (
                      <>
                        <TableCell className="text-right font-medium tabular-nums">
                          {/* 查不到账户时留「—」而不是 0：「余额 0」和「不知道余额」
                              是两回事，写成 0 会让人以为查过了。 */}
                          {balanceOfTenant(row.key) === null
                            ? "—"
                            : balanceOfTenant(row.key)!.toFixed(2)}
                        </TableCell>
                        <TableCell className="text-right">
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={(e) => {
                              e.stopPropagation();
                              if (row.key !== null) {
                                setHistoryTenant({
                                  id: row.key,
                                  name: row.label || row.key_text || String(row.key),
                                });
                              }
                            }}
                          >
                            充值明细
                          </Button>
                        </TableCell>
                      </>
                    )}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-2">
          <CardTitle className="text-base">
            轮次明细
            {drill.userId || drill.sessionId ? (
              <Button size="sm" variant="ghost" className="ml-2" onClick={() => setDrill({})}>
                清除筛选
              </Button>
            ) : null}
          </CardTitle>
          <span className="text-xs text-muted-foreground">共 {turns.total} 条</span>
        </CardHeader>
        <CardContent>
          {turns.items.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4 text-center">
              没有轮次记录。计费从 2026-08-26 起生效，此前的对话不产生流水。
            </p>
          ) : (
            <div className="rounded-md border divide-y text-sm">
              {turns.items.map((t) => (
                <TurnRow
                  key={t.id}
                  turn={t}
                  open={expanded === t.id}
                  onToggle={() => setExpanded(expanded === t.id ? null : t.id)}
                />
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* 充值明细走 modal（按租户汇总里每行一个按钮），不再另设一张全表 ——
          同一件事显示在两个地方，改了一处忘了另一处就会自相矛盾。 */}
      {historyTenant && (
        <RechargeHistoryDialog
          tenantId={historyTenant.id}
          tenantName={historyTenant.name}
          balance={balanceOfTenant(historyTenant.id)}
          onClose={() => setHistoryTenant(null)}
        />
      )}

    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <Card>
      <CardContent className="pt-6">
        <div className="text-xs text-muted-foreground">{label}</div>
        <div className="text-2xl font-semibold mt-1">{value}</div>
      </CardContent>
    </Card>
  );
}

function TurnRow({
  turn,
  open,
  onToggle,
}: {
  turn: UsageTurnRow;
  open: boolean;
  onToggle: () => void;
}) {
  const b = turn.breakdown;
  return (
    <div>
      {/* biome-ignore lint/a11y/useKeyWithClickEvents: 整行可点是表格惯例，键盘用户可用下方按钮 */}
      <div
        className="px-3 py-2 flex items-center gap-3 cursor-pointer hover:bg-muted/40"
        onClick={onToggle}
      >
        {open ? (
          <ChevronDown className="h-4 w-4 shrink-0" />
        ) : (
          <ChevronRight className="h-4 w-4 shrink-0" />
        )}
        <span className="text-xs text-muted-foreground whitespace-nowrap">
          {new Date(turn.created_at).toLocaleString()}
        </span>
        <span className="flex-1 truncate">{turn.question || "—"}</span>
        {turn.usage_partial ? (
          <Badge variant="outline" className="text-amber-600">
            中断
          </Badge>
        ) : null}
        <span className="text-xs font-mono text-muted-foreground whitespace-nowrap">
          {turn.model_name}
        </span>
        <span className="font-medium whitespace-nowrap">{Number(turn.credits).toFixed(2)}</span>
      </div>

      {open && b ? (
        <div className="px-9 pb-3 space-y-1 text-xs text-muted-foreground">
          <div>
            输入 {turn.prompt_tokens?.toLocaleString()} · 输出{" "}
            {turn.completion_tokens?.toLocaleString()} · 缓存命中{" "}
            {turn.cache_read_tokens?.toLocaleString()} · {turn.llm_calls} 次调用
          </div>
          <div>
            计费 token {b.token.billable_tokens.toLocaleString()} × {b.token.coefficient}
            {b.token.using_default ? "（默认系数）" : ""} = {b.token.credits}
            {/* 计费口径小于实际输入：工具定义那部分由平台吸收，不向用户收费 */}
            {turn.prompt_tokens && b.token.billable_tokens < turn.prompt_tokens ? (
              <span className="ml-1 text-emerald-600">
                （已扣除工具定义{" "}
                {(
                  turn.prompt_tokens +
                  (turn.completion_tokens ?? 0) -
                  b.token.billable_tokens
                ).toLocaleString()}
                ）
              </span>
            ) : null}
          </div>
          {b.skills.map((s) => (
            <div key={`s${s.ref}`}>
              skill {s.name} ×{s.count} × {s.coefficient}
              {s.using_default ? "（默认）" : ""} = {s.credits}
            </div>
          ))}
          {b.tools.map((t) => (
            <div key={`t${t.ref}`}>
              工具 {t.name} ×{t.count} × {t.coefficient}
              {t.using_default ? "（默认）" : ""} = {t.credits}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

/** 导出当前页明细。字段顺序对齐界面，方便人工核对 */
function exportCsv(rows: UsageTurnRow[]) {
  const head = [
    "时间",
    "用户",
    "会话",
    "问题",
    "模型",
    "输入token",
    "输出token",
    "缓存命中",
    "调用次数",
    "是否中断",
    "积分",
  ];
  const body = rows.map((r) => [
    new Date(r.created_at).toLocaleString(),
    r.user_name ?? r.user_id ?? "",
    r.session_id,
    (r.question ?? "").replace(/[\n\r,]/g, " "),
    r.model_name ?? "",
    r.prompt_tokens ?? 0,
    r.completion_tokens ?? 0,
    r.cache_read_tokens ?? 0,
    r.llm_calls ?? 0,
    r.usage_partial ? "是" : "否",
    Number(r.credits).toFixed(2),
  ]);
  // BOM：没有它 Excel 打开中文列头是乱码
  const csv = "﻿" + [head, ...body].map((r) => r.join(",")).join("\n");
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = `usage-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}
