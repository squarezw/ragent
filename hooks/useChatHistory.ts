import useSWR from "swr";
import axios from "@/lib/axios";

export interface ChatHistorySummary {
  id: number;
  summary: string;
  created_at?: string;
  updated_at?: string;
}

// 数据获取函数
const fetcher = async (url: string) => {
  const response = await axios.get(url);
  return response.data.history || [];
};

export const useChatHistory = (enabled: boolean = false, limit: number = 3) => {
  // 只有当 enabled 为 true 时才请求数据
  const { data, error, isLoading } = useSWR<ChatHistorySummary[]>(
    enabled ? `/api/chat/session/history?limit=${limit}` : null,
    fetcher,
    {
      revalidateOnFocus: false,
      revalidateOnReconnect: false,
      dedupingInterval: 5000, // 5秒去重
    }
  );

  return {
    history: data || [],
    loading: isLoading,
    error,
  };
};
