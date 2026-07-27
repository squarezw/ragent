"use client";

import { useCallback } from "react";
import useSWR, { useSWRConfig } from "swr";
import axios from "@/lib/axios";
import { appSkillDiagnosticsKey, isAppSkillDiagnosticsKey } from "@/lib/skillDiagnosticsCache";
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
    appId ? appSkillDiagnosticsKey(appId) : null,
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

/**
 * 改变生效判定的写操作（绑定/解绑/优先级、skill 的 requires 与发布状态）都不在诊断
 * hook 里，全部经由这里失效，否则同屏会出现"未绑定任何 Skill"和"1 个未生效"并存。
 * 传 appId 只失效该应用；不传则失效所有应用的诊断。
 */
export function useInvalidateAppSkillDiagnostics() {
  const { mutate } = useSWRConfig();

  return useCallback(
    async (appId?: number | null) => {
      if (appId == null) {
        await mutate(isAppSkillDiagnosticsKey);
        return;
      }
      await mutate(appSkillDiagnosticsKey(appId));
    },
    [mutate]
  );
}
