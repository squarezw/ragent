import useSWR from "swr";
import axios from "@/lib/axios";

export interface Tag {
  id: number;
  name: string;
  color: string;
  file_count: number;
}

// 构建查询键
const buildTagsKey = (datasetId?: string) => {
  const params = new URLSearchParams();
  if (datasetId) {
    params.append("dataset_id", datasetId);
  }
  return `/api/knowledge/tags-summary?${params}`;
};

// 数据获取函数
const fetcher = async (url: string) => {
  const response = await axios.get(url);
  return response.data.tags || [];
};

export const useTagManagement = (datasetId?: string) => {
  const key = buildTagsKey(datasetId);

  const { data, error, isLoading, mutate } = useSWR<Tag[]>(key, fetcher, {
    revalidateOnFocus: false,
    revalidateOnReconnect: true,
    dedupingInterval: 5000, // 5秒内的重复请求会被去重
  });

  // 创建标签
  const createTag = async (name: string, color: string) => {
    try {
      const response = await axios.post("/api/knowledge/tags", {
        name,
        color,
        dataset_id: datasetId,
      });

      if (response.data.success) {
        // 重新验证数据
        mutate();
        return response.data.tag;
      }
      return null;
    } catch (error) {
      console.error("创建标签失败:", error);
      return null;
    }
  };

  // 更新标签
  const updateTag = async (tagId: number, updates: { name?: string; color?: string }) => {
    try {
      const response = await axios.put(`/api/knowledge/tags/${tagId}`, updates);

      if (response.data.success) {
        // 重新验证数据
        mutate();
        return true;
      }
      return false;
    } catch (error) {
      console.error("更新标签失败:", error);
      return false;
    }
  };

  // 删除标签
  const deleteTag = async (tagId: number) => {
    try {
      const response = await axios.delete(`/api/knowledge/tags/${tagId}`);

      if (response.data.success) {
        // 重新验证数据
        mutate();
        return true;
      }
      return false;
    } catch (error) {
      console.error("删除标签失败:", error);
      return false;
    }
  };

  return {
    availableTags: data || [],
    loading: isLoading,
    error,
    createTag,
    updateTag,
    deleteTag,
    refresh: mutate,
  };
};
