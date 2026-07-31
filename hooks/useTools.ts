import useSWR from "swr";
import axios from "@/lib/axios";
import { toast } from "sonner";

export interface ToolAppAssociation {
  app_id: number;
  app_name: string;
  custom_config: Record<string, any>;
  is_enabled: boolean;
  priority: number;
  created_at: string;
}

export interface Tool {
  id: number;
  name: string;
  display_name: string;
  description: string;
  /**
   * `tools` 表里实际存在三种值。**"native" 已经不会出现**——迁移 042 之后原生工具
   * 不再有行（名册在后端代码里，见 native_registry）；保留在联合类型里只为兼容尚未
   * 迁移的老数据。"workflow" 行不是工具，是长任务 kind 的启停开关。
   */
  tool_type: "native" | "mcp" | "workflow";
  category: string;
  icon?: string;
  default_config: Record<string, any>;
  is_enabled: boolean;
  is_system: boolean;
  version?: string;
  author?: string;
  documentation_url?: string;

  created_at: string;
  updated_at: string;
  statistics?: {
    total_calls: number;
    success_calls: number;
    failed_calls: number;
    success_rate: number;
    avg_execution_time_ms: number;
  };
  app_tools?: ToolAppAssociation[];
}

export interface ToolsResponse {
  tools: Tool[];
  total: number;
  page: number;
  page_size: number;
}

const fetcher = async (url: string) => {
  const response = await axios.get(url);
  return response.data;
};

export const useTools = (params?: {
  tool_type?: "native" | "mcp" | "workflow";
  category?: string;
  is_enabled?: boolean;
  page?: number;
  page_size?: number;
}) => {
  const queryParams = new URLSearchParams();
  if (params?.tool_type) queryParams.append("tool_type", params.tool_type);
  if (params?.category) queryParams.append("category", params.category);
  if (params?.is_enabled !== undefined) queryParams.append("is_enabled", String(params.is_enabled));
  if (params?.page) queryParams.append("page", String(params.page));
  if (params?.page_size) queryParams.append("page_size", String(params.page_size));

  const url = `/api/tools${queryParams.toString() ? `?${queryParams.toString()}` : ""}`;

  const { data, error, isLoading, mutate } = useSWR<ToolsResponse>(url, fetcher, {
    revalidateOnFocus: false,
    revalidateOnReconnect: true,
    dedupingInterval: 3000,
  });

  // 创建工具
  const createTool = async (tool: Partial<Tool>) => {
    try {
      const res = await axios.post("/api/tools", tool);
      if (res.data) {
        toast.success("工具创建成功");
        mutate();
        return res.data;
      }
    } catch (error: any) {
      console.error("Create tool error:", error);
      toast.error(error.response?.data?.detail || "创建工具失败");
      return null;
    }
  };

  // 更新工具
  const updateTool = async (id: number, tool: Partial<Tool>) => {
    try {
      const res = await axios.put(`/api/tools/${id}`, tool);
      if (res.data) {
        toast.success("工具更新成功");
        mutate();
        return res.data;
      }
    } catch (error: any) {
      console.error("Update tool error:", error);
      toast.error(error.response?.data?.detail || "更新工具失败");
      return null;
    }
  };

  // 删除工具
  const deleteTool = async (id: number) => {
    try {
      await axios.delete(`/api/tools/${id}`);
      toast.success("工具删除成功");
      mutate();
      return true;
    } catch (error: any) {
      console.error("Delete tool error:", error);
      toast.error(error.response?.data?.detail || "删除工具失败");
      return false;
    }
  };

  // 切换工具启用状态
  const toggleToolEnabled = async (id: number, is_enabled: boolean) => {
    try {
      const res = await axios.put(`/api/tools/${id}`, { is_enabled });
      if (res.data) {
        toast.success(is_enabled ? "工具已启用" : "工具已停用");
        mutate();
        return res.data;
      }
    } catch (error: any) {
      console.error("Toggle tool enabled error:", error);
      toast.error(error.response?.data?.detail || "操作失败");
      return null;
    }
  };

  return {
    tools: data?.tools || [],
    total: data?.total || 0,
    page: data?.page || 1,
    pageSize: data?.page_size || 20,
    loading: isLoading,
    error,
    createTool,
    updateTool,
    deleteTool,
    toggleToolEnabled,
    refresh: mutate,
  };
};

// 获取单个工具详情
export const useTool = (id: number | null, includeStatistics = false, includeAppTools = false) => {
  const params = new URLSearchParams();
  if (includeStatistics) params.append("include_statistics", "true");
  if (includeAppTools) params.append("include_app_tools", "true");

  const url = id ? `/api/tools/${id}${params.toString() ? `?${params.toString()}` : ""}` : null;

  const { data, error, isLoading, mutate } = useSWR<Tool>(url, fetcher, {
    revalidateOnFocus: false,
    revalidateOnReconnect: true,
  });

  return {
    tool: data,
    loading: isLoading,
    error,
    refresh: mutate,
  };
};
