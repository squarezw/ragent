"use client";

import { useCallback } from "react";
import useSWR from "swr";
import axios from "@/lib/axios";
import { parseUserEnv, parseUserEnvMeta } from "@/lib/skillUserEnv";
import type { SkillUserEnv, SkillUserEnvMeta, SkillUserEnvPayload } from "@/types/skill";

const EMPTY_META: SkillUserEnvMeta = {
  configurable: false,
  template_path: null,
  template_stage: null,
  declared_keys: [],
  configured_keys: [],
};

/**
 * 未加载时的兜底必须是**模块级常量**，不能写 `?? {}` / `?? []`。
 * 后者每次渲染都是新引用，会让消费方按 env / declaredKeys 建行的 useEffect
 * 每渲染都触发一次 setState —— 死循环。
 */
const EMPTY_VALUES: Readonly<Record<string, string>> = {};
const EMPTY_KEYS: readonly string[] = [];

/** 该 skill 没声明 env 模板、或端点不可用 → 不可配置，面板整块不渲染 */
const metaFetcher = async (url: string): Promise<SkillUserEnvMeta> => {
  try {
    return parseUserEnvMeta((await axios.get(url, { suppressErrorToast: true } as never)).data);
  } catch {
    return EMPTY_META;
  }
};

const envFetcher = async (url: string): Promise<SkillUserEnv> =>
  parseUserEnv((await axios.get(url, { suppressErrorToast: true } as never)).data);

function detailOf(error: unknown): string {
  const detail = (error as { response?: { data?: { detail?: unknown } } })?.response?.data?.detail;
  if (typeof detail === "string") return detail;
  return error instanceof Error ? error.message : String(error);
}

export interface SharedEnv {
  can_manage: boolean;
  use_organization: boolean;
  configured_keys: string[];
  shareable_keys: string[];
  revision: number;
}

export function useSkillUserEnv(skillId: number | null, enabled: boolean, scope: string | null, allowShared: boolean) {
  const key = enabled && scope && skillId ? skillId : null;

  const meta = useSWR(key ? [`/api/v1/skills/${key}/user-env/meta`, scope] : null, ([url]) => metaFetcher(url), {
    revalidateOnFocus: false,
    shouldRetryOnError: false,
  });
  // 值只在确认可配置后才取，避免给不相关的 skill 拉一份凭据到浏览器内存
  const env = useSWR(
    key && meta.data?.configurable ? [`/api/v1/skills/${key}/user-env`, scope] : null,
    ([url]) => envFetcher(url),
    { revalidateOnFocus: false, shouldRetryOnError: false }
  );

  const sharedUrl = `/api/v1/skills/${skillId}/shared-env`;
  const shared = useSWR<SharedEnv>(
    key && allowShared ? [sharedUrl, scope] : null,
    async ([url]: [string, string]) => (await axios.get<SharedEnv>(url, { suppressErrorToast: true } as never)).data,
    { revalidateOnFocus: false, shouldRetryOnError: false }
  );

  const saveEnv = useCallback(
    async (payload: SkillUserEnvPayload): Promise<{ ok: boolean; detail?: string }> => {
      if (!skillId) return { ok: false, detail: "no skill" };
      try {
        const res = await axios.put(`/api/v1/skills/${skillId}/user-env`, payload, {
          suppressErrorToast: true,
        } as never);
        await env.mutate(parseUserEnv(res.data), { revalidate: false });
        // 「已配置 N/M」来自 meta，保存后必须重取，否则计数与表单打架
        await meta.mutate();
        return { ok: true };
      } catch (error) {
        return { ok: false, detail: detailOf(error) };
      }
    },
    [skillId, env.mutate, meta.mutate]
  );

  return {
    meta: meta.data ?? EMPTY_META,
    metaLoading: meta.isLoading,
    env: env.data?.env ?? EMPTY_VALUES,
    declaredKeys: env.data?.declared_keys ?? meta.data?.declared_keys ?? EMPTY_KEYS,
    updatedAt: env.data?.updated_at ?? null,
    envLoading: env.isLoading,
    envError: env.error,
    reloadEnv: () => env.mutate(),
    saveEnv,
    shared,
    sharedUrl,
  };
}
