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
  documentation_url?: string;
  /**
   * 创建人。取代了原来的 `author` —— 那是表单上一个手填的文本框，回答不了
   * 「谁建的」（线上 15 行里 14 行是 System 或 NULL）。这两个字段**只读**，
   * 后端从请求边界落库，表单里没有对应输入。
   *
   * `created_by` 为空 = 这一行建于该列存在之前，不是「创建人被删了」；
   * `created_by` 有值而 `created_by_name` 为空 = 用户已注销。
   */
  created_by?: number | null;
  created_by_name?: string | null;

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
  /**
   * 这个工具在 system prompt 里占多大。
   *
   * 界面上一个 MCP 工具只是一行地址（qcc-operation 的 default_config 才 140 字节），
   * 运行时它从对方服务器拉回几十个子工具的完整 JSON Schema，且**每一轮对话都全量
   * 重发**。2026-08-25 实测：一句「你好」耗 39,550 输入 token，其中约 92% 是工具定义。
   *
   * 缺席是正常的：native / workflow 类型不走 MCP 注册，本来就没有这个块。
   */
  footprint?: {
    /** 展开成几个子工具；0 且 status=failed 表示服务器连不上 */
    subtool_count: number;
    schema_chars: number;
    /** 粗估（len/2，与技能注入块同口径），不是精确值 */
    estimated_tokens: number;
    /**
     * - `ok`           已注册且（若体检过）握手成功
     * - `failed`       配置完整但连不上，原因见 `error`
     * - `unconfigured` 配置本身没填完（占位值 / 环境变量未设置），**后端没发过网络请求**。
     *                  与 failed 分开是因为处置相反：这个要改配置，不是等对端恢复。
     *
     * 缺席整个 footprint = **未验证**（配置完整但从没被用过，也没体检过），
     * 与 native / workflow 行（本来就不走 MCP 注册）长得一样。界面必须把"未验证"
     * 与"失败"分开画 —— 否则每个还没人用过的工具都看起来是坏的。
     */
    status: "ok" | "failed" | "unconfigured";
    /** 最近一次失败/未配置的原因。给人看的一句话，**不要拿它做分支判断**（措辞会变）。 */
    error?: string | null;
    /**
     * 最近一次「测试连接」的时刻（epoch 秒）。**只有主动体检才写**：
     * 缺席而 status=ok = 这个工具是被某次对话用到才注册的，没单独验证过。
     */
    checked_at?: number | null;
  };
}

/**
 * 「测试连接」的结果。
 *
 * 四种状态**互相不能塌成两档**（都塌成成功/失败会让人做错处置）：
 * `unconfigured` 要改配置，`failed` 要查对端或网络，`not_applicable` 是这类工具
 * 压根不建连接（native / workflow）。
 */
export interface ToolConnectionTestResult {
  status: "ok" | "failed" | "unconfigured" | "not_applicable";
  subtool_count: number;
  estimated_tokens: number;
  duration_ms: number;
  error?: string | null;
  /** 未配置时，具体哪些项没填 */
  missing?: string[];
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

/**
 * 对一个工具的**默认配置**做一次体检。
 *
 * 只在这一步会真的跟 MCP 对端握手（后端上限 20s），所以刻意**不放进 SWR** ——
 * SWR 的语义是"自动重取"，而这个动作不该在切窗口/重连时被悄悄重放，那是把
 * 一次用户点击变成反复握手。由调用方在点击时 await。
 *
 * 超时给 30s 且必须**长于后端那 20s**：前端先断的话，用户看到的是"请求超时"，
 * 而那次体检其实还在后端跑并会写下结论，界面上就会出现"刚说超时、刷新后变失败"
 * 这种对不上的现象。
 */
export async function testToolConnection(id: number): Promise<ToolConnectionTestResult | null> {
  try {
    // 留出代理完成 30 秒后端请求并回传响应的余量；与代理同为 30 秒会产生边界竞态。
    const res = await axios.post(`/api/tools/${id}/test-connection`, {}, { timeout: 35000 } as any);
    return res.data as ToolConnectionTestResult;
  } catch (error: any) {
    // 非 2xx（403 非管理员 / 404 工具被删 / 500）才走这里；连不上对端是
    // **200 + status=failed**，不落进这个分支。错误提示交给全局拦截器，这里只留日志。
    console.error("Test tool connection error:", error);
    return null;
  }
}

/**
 * 提示词占用量的显示口径（以 k 为单位）。
 *
 * **只有这一份实现。** 列表页与工具详情页都要显示这个数，两处各写一遍的话，
 * `estimated_tokens` 一样、显示出来却不一样，看的人不知道该信哪个 —— 而这正是
 * 后端把它做成共用口径（`ToolRegistry._footprint_entry`）要避免的事，前端不该
 * 在最后一公里把它重新分岔。
 */
export function formatTokens(n: number): string {
  return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);
}

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

  // 体检：结果由调用方就地展示，同时刷新列表让 footprint 读数跟着更新
  // （后端会把这次结论写进内存态，列表页那行状态位因此变绿/变红）
  const testConnection = async (id: number) => {
    const result = await testToolConnection(id);
    if (result) mutate();
    return result;
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
    testConnection,
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
