import { useCallback, useEffect, useState } from "react";
import axios from "@/lib/axios";

/** 一笔消耗的分项。落库时的**快照**，不是实时重算的。 */
export interface UsageBreakdown {
  token: {
    billable_tokens: number;
    model: string | null;
    coefficient: string;
    /** 该模型没有显式系数，吃的是全局默认 */
    using_default: boolean;
    credits: string;
  };
  skills: BreakdownItem[];
  tools: BreakdownItem[];
}

export interface BreakdownItem {
  ref: number | string | null;
  name: string | null;
  count: number;
  coefficient: string;
  using_default: boolean;
  credits: string;
}

export interface UsageSummaryRow {
  key: number | null;
  key_text: string | null;
  label: string | null;
  turns: number;
  credits: string;
  prompt_tokens: number;
  completion_tokens: number;
  cache_read_tokens: number;
  last_at: string | null;
}

export interface UsageTurnRow {
  id: number;
  credits: string;
  created_at: string;
  breakdown: UsageBreakdown | null;
  tenant_id: number | null;
  user_id: number | null;
  user_name: string | null;
  detail_id: number;
  session_id: number;
  question: string | null;
  prompt_tokens: number | null;
  completion_tokens: number | null;
  cache_read_tokens: number | null;
  llm_calls: number | null;
  model_name: string | null;
  usage_partial: boolean | null;
}

export type GroupBy = "tenant" | "user" | "session";

export interface UsageFilters {
  groupBy: GroupBy;
  start?: string;
  end?: string;
  tenantId?: number;
  userId?: number;
  sessionId?: number;
}

function qs(params: Record<string, unknown>): string {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== "") sp.append(k, String(v));
  }
  const s = sp.toString();
  return s ? `?${s}` : "";
}

export function useUsageSummary(filters: UsageFilters) {
  const [items, setItems] = useState<UsageSummaryRow[]>([]);
  const [totals, setTotals] = useState({ credits: 0, turns: 0 });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const url = `/api/v1/billing/usage/summary${qs({
        group_by: filters.groupBy,
        start: filters.start,
        end: filters.end,
        tenant_id: filters.tenantId,
        user_id: filters.userId,
      })}`;
      const res = await axios.get(url);
      setItems(res.data?.items ?? []);
      setTotals(res.data?.totals ?? { credits: 0, turns: 0 });
    } catch (e: unknown) {
      // 权限不足（非超管查别的租户）会 403 —— 要显示出来，
      // 静默空列表会被读成"这段时间没有消耗"
      const detail = (e as { response?: { data?: { error?: string; detail?: string } } })?.response
        ?.data;
      setError(detail?.detail || detail?.error || "加载失败");
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, [filters.groupBy, filters.start, filters.end, filters.tenantId, filters.userId]);

  useEffect(() => {
    load();
  }, [load]);

  return { items, totals, loading, error, reload: load };
}

export function useUsageTurns(filters: UsageFilters, page: number, pageSize = 50) {
  const [items, setItems] = useState<UsageTurnRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const url = `/api/v1/billing/usage/turns${qs({
        start: filters.start,
        end: filters.end,
        tenant_id: filters.tenantId,
        user_id: filters.userId,
        session_id: filters.sessionId,
        page,
        page_size: pageSize,
      })}`;
      const res = await axios.get(url);
      setItems(res.data?.items ?? []);
      setTotal(res.data?.total ?? 0);
    } catch {
      setItems([]);
      setTotal(0);
    } finally {
      setLoading(false);
    }
  }, [
    filters.start,
    filters.end,
    filters.tenantId,
    filters.userId,
    filters.sessionId,
    page,
    pageSize,
  ]);

  useEffect(() => {
    load();
  }, [load]);

  return { items, total, loading, reload: load };
}

export interface RateRow {
  rate_type: string;
  ref_key: string;
  coefficient: string | number;
  note: string | null;
  updated_at: string | null;
}

export interface UsingDefaultRow {
  rate_type: string;
  ref_key: string;
  name: string;
}

export function useRates() {
  const [defaults, setDefaults] = useState<Record<string, number>>({});
  const [explicit, setExplicit] = useState<RateRow[]>([]);
  const [usingDefault, setUsingDefault] = useState<UsingDefaultRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await axios.get("/api/v1/billing/rates");
      setDefaults(res.data?.defaults ?? {});
      setExplicit(res.data?.explicit ?? []);
      setUsingDefault(res.data?.using_default ?? []);
    } catch (e: unknown) {
      const detail = (e as { response?: { data?: { detail?: string } } })?.response?.data;
      setError(detail?.detail || "仅超级管理员可管理计费系数");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const save = useCallback(
    async (
      rateType: string,
      refKey: string,
      coefficient: number,
      note?: string,
      reason?: string
    ) => {
      await axios.put("/api/v1/billing/rates", {
        rate_type: rateType,
        ref_key: refKey,
        coefficient,
        note: note || null,
        reason: reason || null,
      });
      await load();
    },
    [load]
  );

  const remove = useCallback(
    async (rateType: string, refKey: string) => {
      await axios.delete(
        `/api/v1/billing/rates/${encodeURIComponent(rateType)}/${encodeURIComponent(refKey)}`
      );
      await load();
    },
    [load]
  );

  return { defaults, explicit, usingDefault, loading, error, reload: load, save, remove };
}

// ── 积分账户与充值 ─────────────────────────────────────────────────────

export interface CreditAccount {
  tenant_id: number;
  tenant_name: string | null;
  balance: number;
  recharged: number;
  consumed: number;
  /** > 0 说明后端有未登记的 tx_type，余额算漏了。见 CREDIT_TX_SIGNS。 */
  unknown_tx: number;
  /** 是否已纳入余额拦截。充过一次值即纳入；未纳入的租户余额为负也照用。 */
  enforced?: boolean;
}

export interface RechargeRecord {
  id: number;
  tenant_id: number;
  tenant_name: string | null;
  tx_type: string;
  amount: number;
  note: string | null;
  created_at: string;
  operator_id: number | null;
  operator_name: string | null;
  operator_username: string | null;
}

/**
 * 租户积分账户。余额由后端从流水现算，前端不做任何加减 ——
 * 两边各算一次，迟早有一次算得不一样，而不一样的那个数是钱。
 */
export function useCreditAccounts(tenantId?: number) {
  const [accounts, setAccounts] = useState<CreditAccount[]>([]);
  const [totalBalance, setTotalBalance] = useState(0);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const url = tenantId ? `/api/v1/billing/accounts?tenant_id=${tenantId}` : "/api/v1/billing/accounts";
      const res = await axios.get(url);
      setAccounts(res.data?.items ?? []);
      setTotalBalance(res.data?.total_balance ?? 0);
    } catch {
      // 没有组织账目知情范围的人拿到的是空集而不是错误（后端如此设计），
      // 真出错时也降级成「不显示余额」，不该让整页挂掉。
      setAccounts([]);
      setTotalBalance(0);
    } finally {
      setLoading(false);
    }
  }, [tenantId]);

  useEffect(() => {
    load();
  }, [load]);

  /**
   * 充值。`idempotencyKey` 由调用方在**打开充值框时**生成，不是提交时 ——
   * 提交时生成的话，双击会产生两个不同的 key，等于没有幂等。
   */
  const recharge = useCallback(
    async (tenant_id: number, amount: number, note: string, idempotencyKey: string) => {
      const res = await axios.post("/api/v1/billing/recharge", {
        tenant_id,
        amount,
        note: note || null,
        idempotency_key: idempotencyKey,
      });
      await load();
      return res.data as { id: number; amount: number; balance: number; duplicate: boolean };
    },
    [load]
  );

  return { accounts, totalBalance, loading, reload: load, recharge };
}

export function useRecharges(tenantId?: number, page = 1, pageSize = 50) {
  const [items, setItems] = useState<RechargeRecord[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const qs = new URLSearchParams({ page: String(page), page_size: String(pageSize) });
      if (tenantId) qs.set("tenant_id", String(tenantId));
      const res = await axios.get(`/api/v1/billing/recharges?${qs.toString()}`);
      setItems(res.data?.items ?? []);
      setTotal(res.data?.total ?? 0);
    } catch {
      setItems([]);
      setTotal(0);
    } finally {
      setLoading(false);
    }
  }, [tenantId, page, pageSize]);

  useEffect(() => {
    load();
  }, [load]);

  return { items, total, loading, reload: load };
}
