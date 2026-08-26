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
