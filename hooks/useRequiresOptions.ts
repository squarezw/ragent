"use client";

import useSWR from "swr";
import axios from "@/lib/axios";
import { parseRequiresOptions } from "@/lib/skillRequires";
import type { RequiresOptions } from "@/types/skill";

const EMPTY: RequiresOptions = { tools: [], workflows: [] };

// 选项拿不到不该挡住编辑：降级成空清单，UI 回落到纯手工输入
const fetcher = async (url: string): Promise<RequiresOptions> => {
  try {
    const res = await axios.get(url, { suppressErrorToast: true } as never);
    return parseRequiresOptions(res.data);
  } catch {
    return EMPTY;
  }
};

/** requires 受控多选的候选项（全局启用的 native/mcp 工具 + 全部注册 workflow kind） */
export function useRequiresOptions() {
  const { data, isLoading, mutate } = useSWR<RequiresOptions>(
    "/api/v1/skills/requires-options",
    fetcher,
    { revalidateOnFocus: false, dedupingInterval: 60000 }
  );

  const options = data || EMPTY;
  return {
    options,
    loading: isLoading,
    /** 后端没给任何候选项：UI 提示「只能手工输入」而不是干瞪一个空列表 */
    unavailable: !isLoading && options.tools.length === 0 && options.workflows.length === 0,
    refresh: mutate,
  };
}
