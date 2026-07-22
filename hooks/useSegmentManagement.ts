import useSWR from "swr";
import axios from "@/lib/axios";
import { toast } from "sonner";

export interface Segment {
  id: number;
  file_id: string;
  segment_text: string;
  segment_index?: number;
  status: "pending" | "processing" | "indexed" | "failed";
  created_at?: string;
  updated_at?: string;
}

// 数据获取函数
const fetcher = async (url: string) => {
  const response = await axios.get(url);
  return response.data.segments || [];
};

export const useSegmentManagement = (fileId?: string) => {
  // 只有当 fileId 存在时才进行请求
  const key = fileId ? `/api/knowledge/segments?file_id=${fileId}` : null;

  const { data, error, isLoading, mutate } = useSWR<Segment[]>(key, fetcher, {
    revalidateOnFocus: false,
    revalidateOnReconnect: false,
    dedupingInterval: 2000,
  });

  // 更新分段
  const updateSegment = async (segmentId: number, segmentText: string) => {
    try {
      await axios.put("/api/knowledge/segments/update", {
        segment_id: segmentId,
        segment_text: segmentText,
      });

      toast.success("分段更新成功");

      // 乐观更新
      mutate(
        (currentData) => {
          if (!currentData) return currentData;
          return currentData.map((seg) =>
            seg.id === segmentId ? { ...seg, segment_text: segmentText } : seg
          );
        },
        { revalidate: false }
      );

      return true;
    } catch (error) {
      toast.error("更新分段失败");
      return false;
    }
  };

  return {
    segments: data || [],
    loading: isLoading,
    error,
    updateSegment,
    refresh: mutate,
  };
};
