import useSWR from "swr";
import axios from "@/lib/axios";

export interface ToolExecution {
  id: number;
  tool_id: number;
  tool_name?: string;
  app_id: number | null;
  app_name?: string;
  user_id: number | null;
  status: "success" | "failed";
  input_args: Record<string, any>;
  output_summary: string | null;
  error_type: string | null;
  error_detail: string | null;
  error_stack_trace: string | null;
  execution_time_ms: number;
  created_at: string;
}

export interface ToolExecutionsResponse {
  executions: ToolExecution[];
  total: number;
  page: number;
  page_size: number;
}

export interface ToolStatistics {
  tool_id: number;
  tool_name: string;
  app_id: number | null;
  stat_date: string;
  total_calls: number;
  success_calls: number;
  failed_calls: number;
  avg_execution_time_ms: number;
  min_execution_time_ms: number;
  max_execution_time_ms: number;
}

export interface ToolStatisticsResponse {
  tool_id: number;
  tool_name: string;
  app_id: number | null;
  app_name: string | null;
  start_date: string;
  end_date: string;
  statistics: ToolStatistics[];
  summary: {
    total_calls: number;
    success_calls: number;
    failed_calls: number;
    success_rate: number;
    avg_execution_time_ms: number;
  };
}

const fetcher = async (url: string) => {
  const response = await axios.get(url);
  return response.data;
};

// 查询工具执行记录
export const useToolExecutions = (params?: {
  tool_id?: number;
  app_id?: number;
  status?: "success" | "failed";
  start_date?: string;
  end_date?: string;
  page?: number;
  page_size?: number;
}) => {
  const queryParams = new URLSearchParams();
  if (params?.tool_id) queryParams.append("tool_id", String(params.tool_id));
  if (params?.app_id) queryParams.append("app_id", String(params.app_id));
  if (params?.status) queryParams.append("status", params.status);
  if (params?.start_date) queryParams.append("start_date", params.start_date);
  if (params?.end_date) queryParams.append("end_date", params.end_date);
  if (params?.page) queryParams.append("page", String(params.page));
  if (params?.page_size) queryParams.append("page_size", String(params.page_size));

  const url = `/api/tools/executions${queryParams.toString() ? `?${queryParams.toString()}` : ""}`;

  const { data, error, isLoading, mutate } = useSWR<ToolExecutionsResponse>(url, fetcher, {
    revalidateOnFocus: false,
    revalidateOnReconnect: true,
    dedupingInterval: 5000,
  });

  return {
    executions: data?.executions || [],
    total: data?.total || 0,
    page: data?.page || 1,
    pageSize: data?.page_size || 20,
    loading: isLoading,
    error,
    refresh: mutate,
  };
};

// 获取工具的统计数据
export const useToolStatistics = (
  toolId: number | null,
  appId?: number | null,
  startDate?: string,
  endDate?: string
) => {
  const params = new URLSearchParams();
  if (appId !== null && appId !== undefined) params.append("app_id", String(appId));
  if (startDate) params.append("start_date", startDate);
  if (endDate) params.append("end_date", endDate);

  const url = toolId
    ? `/api/tools/${toolId}/statistics${params.toString() ? `?${params.toString()}` : ""}`
    : null;

  const { data, error, isLoading, mutate } = useSWR<ToolStatisticsResponse>(url, fetcher, {
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
