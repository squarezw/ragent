"use client";

import useSWR from "swr";
import axios from "@/lib/axios";
import { parseSkillDiagnostics, summarizeDiagnostics } from "@/lib/skillRequires";
import type { AppSkillDiagnostics } from "@/types/skill";

// 403（无权看这个应用）/ 404（旧后端没这个端点）都归一为 null，区块整体不渲染
const fetcher = async (url: string): Promise<AppSkillDiagnostics | null> => {
  try {
    const res = await axios.get(url, { suppressErrorToast: true } as never);
    return parseSkillDiagnostics(res.data);
  } catch {
    return null;
  }
};

/** 应用详情页「Skill 生效状态」诊断数据 */
export function useAppSkillDiagnostics(appId: number | null) {
  const { data, isLoading, mutate } = useSWR<AppSkillDiagnostics | null>(
    appId ? `/api/v1/apps/${appId}/skills/diagnostics` : null,
    fetcher,
    { revalidateOnFocus: false, dedupingInterval: 3000 }
  );

  return {
    diagnostics: data ?? null,
    summary: summarizeDiagnostics(data ?? null),
    loading: isLoading,
    refresh: mutate,
  };
}
