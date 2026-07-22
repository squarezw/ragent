import useSWR from "swr";
import axios from "@/lib/axios";
import { toast } from "sonner";

export interface Dataset {
  id: string;
  name: string;
  visibility: string;
  file_count?: number;
  updated_at: string;
  created_at?: string;
  owner_tenant_name?: string;
  color?: string; // UI 使用的颜色
  graph_status?: "pending" | "processing" | "done";
  settings?: {
    splitMode?: string;
    fixedLength?: number;
    segmentModel?: string;
    contentParsing?: string;
    enhanced?: boolean;
    promptType?: string;
    vectorWeight?: number;
    textWeight?: number;
    rerankService?: string;
  };
}

// 数据获取函数
const fetcher = async (url: string) => {
  const response = await axios.get(url);
  return response.data || [];
};

export const useDatasets = () => {
  const { data, error, isLoading, mutate } = useSWR<Dataset[]>("/api/datasets", fetcher, {
    revalidateOnFocus: false,
    revalidateOnReconnect: true,
    dedupingInterval: 3000, // 3秒内的重复请求会被去重
  });

  // 创建数据集
  const createDataset = async (params: {
    name: string;
    description?: string;
    visibility: string;
    settings: any;
    owner_tenant_id?: number;
    owner_dept_id?: number;
  }) => {
    try {
      const res = await axios.post("/api/datasets", {
        name: params.name.trim(),
        description: params.description,
        visibility: params.visibility,
        settings: params.settings,
        owner_tenant_id: params.owner_tenant_id,
        owner_dept_id: params.owner_dept_id,
      });

      if (res.data && res.data.id) {
        toast.success("知识库创建成功！");
        // 重新验证数据
        mutate();
        return res.data;
      } else {
        toast.error("创建失败");
        return null;
      }
    } catch (error: any) {
      console.error("Create dataset error:", error);
      toast.error(error.response?.data?.error || error.response?.data?.message || "创建失败");
      return null;
    }
  };

  // 更新数据集
  const updateDataset = async (
    id: string,
    params: {
      name: string;
      description?: string;
      visibility: string;
      settings: any;
      owner_tenant_id?: number | null;
      owner_dept_id?: number | null;
      user_id?: number | null;
    }
  ) => {
    try {
      const res = await axios.put(`/api/datasets/${id}`, {
        name: params.name.trim(),
        description: params.description,
        visibility: params.visibility,
        settings: params.settings,
        owner_tenant_id: params.owner_tenant_id,
        owner_dept_id: params.owner_dept_id,
        user_id: params.user_id,
      });

      if (res.data && res.data.id) {
        toast.success("知识库更新成功！");
        // 重新验证数据
        mutate();
        return res.data;
      } else {
        toast.error("更新失败");
        return null;
      }
    } catch (error: any) {
      console.error("Update dataset error:", error);
      toast.error(error.response?.data?.error || error.response?.data?.message || "更新失败");
      return null;
    }
  };

  // 删除数据集
  const deleteDataset = async (id: string) => {
    try {
      await axios.delete(`/api/datasets/${id}`);
      toast.success("数据集删除成功");
      // 重新验证数据
      mutate();
      return true;
    } catch (error: any) {
      console.error("删除数据集失败:", error);
      toast.error(error.response?.data?.error || "删除数据集失败");
      return false;
    }
  };

  return {
    datasets: data || [],
    loading: isLoading,
    error,
    createDataset,
    updateDataset,
    deleteDataset,
    refresh: mutate,
  };
};
