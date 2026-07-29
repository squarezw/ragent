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

const EMPTY_ENV: SkillUserEnv = { env: {}, declared_keys: [], updated_at: null };

/** 该 skill 没声明 env 模板、或端点不可用 → 不可配置，面板整块不渲染 */
const metaFetcher = async (url: string): Promise<SkillUserEnvMeta> => {
  try {
    return parseUserEnvMeta((await axios.get(url, { suppressErrorToast: true } as never)).data);
  } catch {
    return EMPTY_META;
  }
};

/** 从未配过 = 没有行，不是错误 */
const envFetcher = async (url: string): Promise<SkillUserEnv> => {
  try {
    return parseUserEnv((await axios.get(url, { suppressErrorToast: true } as never)).data);
  } catch {
    return EMPTY_ENV;
  }
};

function detailOf(error: unknown): string {
  const detail = (error as { response?: { data?: { detail?: unknown } } })?.response?.data?.detail;
  if (typeof detail === "string") return detail;
  return error instanceof Error ? error.message : String(error);
}

/**
 * 个人环境变量数据层（迁移 041）。
 *
 * 两条请求：meta（是否可配置 + 键名，**无值**）与 env（自己那份，含值）。
 * 保存是**全量替换**：payload 里没有的键后端就删掉。
 *
 * 值只在 payload 与 SWR 缓存里存在——**任何分支都不得把它写进 console/埋点**，
 * 出错只取后端 detail（保存失败的 detail 是中文校验信息，可直接展示）。
 */
export function useSkillUserEnv(skillId: number | null, enabled: boolean) {
  const key = enabled && skillId ? skillId : null;

  const meta = useSWR(key ? `/api/v1/skills/${key}/user-env/meta` : null, metaFetcher, {
    revalidateOnFocus: false,
    shouldRetryOnError: false,
  });
  // 值只在确认可配置后才取，避免给不相关的 skill 拉一份凭据到浏览器内存
  const env = useSWR(
    key && meta.data?.configurable ? `/api/v1/skills/${key}/user-env` : null,
    envFetcher,
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
    env: env.data?.env ?? {},
    declaredKeys: env.data?.declared_keys ?? meta.data?.declared_keys ?? [],
    updatedAt: env.data?.updated_at ?? null,
    envLoading: env.isLoading,
    saveEnv,
  };
}
