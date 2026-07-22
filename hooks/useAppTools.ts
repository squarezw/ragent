import useSWR from "swr";
import axios from "@/lib/axios";
import { toast } from "sonner";
import type { Tool } from "./useTools";

export interface AppTool {
  id: number;
  app_id: number;
  tool_id: number;
  tool_name: string;
  tool_display_name: string;
  tool_type: "native" | "mcp";
  category: string;
  default_config: Record<string, any>;
  custom_config: Record<string, any>;
  final_config: Record<string, any>;
  is_enabled: boolean;
  priority: number;
  created_at: string;
  updated_at: string;
  statistics?: {
    total_calls: number;
    success_calls: number;
    failed_calls: number;
    success_rate: number;
    avg_execution_time_ms: number;
  };
}

export interface AppToolsResponse {
  app_id: number;
  app_name: string;
  tools: AppTool[];
  total: number;
}

const fetcher = async (url: string) => {
  const response = await axios.get(url);
  return response.data;
};

export const useAppTools = (appId: number | null, isEnabled?: boolean) => {
  const url = appId
    ? `/api/apps/${appId}/tools${isEnabled !== undefined ? `?is_enabled=${isEnabled}` : ""}`
    : null;

  const { data, error, isLoading, mutate } = useSWR<AppToolsResponse>(url, fetcher, {
    revalidateOnFocus: false,
    revalidateOnReconnect: true,
    dedupingInterval: 3000,
  });

  // 为应用绑定工具
  const bindTool = async (
    toolId: number,
    customConfig?: Record<string, any>,
    priority?: number
  ) => {
    if (!appId) return null;

    try {
      const res = await axios.post(`/api/apps/${appId}/tools`, {
        tool_id: toolId,
        custom_config: customConfig || {},
        priority: priority || 0,
      });
      if (res.data) {
        toast.success("工具绑定成功");
        mutate();
        return res.data;
      }
    } catch (error: any) {
      console.error("Bind tool error:", error);
      toast.error(error.response?.data?.detail || "绑定工具失败");
      return null;
    }
  };

  // 批量绑定工具
  const batchBindTools = async (
    tools: Array<{ tool_id: number; custom_config?: Record<string, any>; priority?: number }>
  ) => {
    if (!appId) return null;

    try {
      const res = await axios.post(`/api/apps/${appId}/tools/batch`, {
        tools,
      });
      if (res.data) {
        toast.success(`成功绑定 ${res.data.success_count} 个工具`);
        mutate();
        return res.data;
      }
    } catch (error: any) {
      console.error("Batch bind tools error:", error);
      toast.error(error.response?.data?.detail || "批量绑定工具失败");
      return null;
    }
  };

  // 解绑工具
  const unbindTool = async (appToolId: number) => {
    if (!appId) return false;

    try {
      await axios.delete(`/api/apps/${appId}/tools/${appToolId}`);
      toast.success("工具解绑成功");
      mutate();
      return true;
    } catch (error: any) {
      console.error("Unbind tool error:", error);
      toast.error(error.response?.data?.detail || "解绑工具失败");
      return false;
    }
  };

  return {
    appId: data?.app_id,
    appName: data?.app_name,
    tools: data?.tools || [],
    total: data?.total || 0,
    loading: isLoading,
    error,
    bindTool,
    batchBindTools,
    unbindTool,
    refresh: mutate,
  };
};

// 获取应用的所有工具统计
export const useAppToolsStatistics = (
  appId: number | null,
  startDate?: string,
  endDate?: string
) => {
  const params = new URLSearchParams();
  if (startDate) params.append("start_date", startDate);
  if (endDate) params.append("end_date", endDate);

  const url = appId
    ? `/api/apps/${appId}/tools/statistics${params.toString() ? `?${params.toString()}` : ""}`
    : null;

  const { data, error, isLoading, mutate } = useSWR(url, fetcher, {
    revalidateOnFocus: false,
    revalidateOnReconnect: true,
  });

  return {
    statistics: data,
    loading: isLoading,
    error,
    refresh: mutate,
  };
};
