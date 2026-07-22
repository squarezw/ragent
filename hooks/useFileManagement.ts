import axios from "@/lib/axios";
import { AxiosError } from "axios";
import { toast } from "sonner";
import useSWR from "swr";

export interface FileItem {
  id: string;
  originalname: string;
  mimetype: string;
  size: number;
  uploader_name?: string;
  upload_time?: string;
  filename: string;
  status: "pending" | "processing" | "indexed" | "failed";
  tags?: Array<{ id: number; name: string; color: string }>;
  user_id?: number; // 文件创建者ID
  summary?: string;
}

export interface PaginationData {
  page: number;
  total: number;
  total_pages: number;
}

export interface FileListParams {
  page: number;
  pageSize: number;
  tagId?: string;
  status?: string;
  datasetId?: string;
  searchKeyword?: string;
}

// 构建查询键和 URL
const buildFileListKey = (params: FileListParams) => {
  const queryParams = new URLSearchParams({
    page: params.page.toString(),
    page_size: params.pageSize.toString(),
  });

  if (params.tagId && params.tagId !== "all") {
    queryParams.append("tag_id", params.tagId);
  }

  if (params.status && params.status !== "all") {
    queryParams.append("status", params.status);
  }

  if (params.datasetId) {
    queryParams.append("dataset_id", params.datasetId);
  }

  if (params.searchKeyword?.trim()) {
    queryParams.append("search", params.searchKeyword.trim());
  }

  return `/api/knowledge/list?${queryParams}`;
};

// 数据获取函数
const fetcher = async (url: string) => {
  const response = await axios.get(url);
  const files = response.data.files || [];

  // 对文件进行排序：未分段的文件显示在前面
  const sortedFiles = files.sort((a: FileItem, b: FileItem) => {
    if (a.status !== "indexed" && b.status === "indexed") return -1;
    if (a.status === "indexed" && b.status !== "indexed") return 1;

    const timeA = new Date(a.upload_time || 0).getTime();
    const timeB = new Date(b.upload_time || 0).getTime();
    return timeB - timeA;
  });

  return {
    files: sortedFiles,
    pagination: response.data.pagination || {
      page: 1,
      total: 0,
      total_pages: 1,
    },
    unsegmented_count: response.data.unsegmented_count || 0,
    dataset: response.data.dataset || null,
  };
};

export const useFileManagement = (params: FileListParams) => {
  const key = buildFileListKey(params);

  const {
    data,
    error,
    isLoading,
    mutate: mutateLocal,
  } = useSWR(key, fetcher, {
    revalidateOnFocus: false, // 不在聚焦时自动重新验证
    revalidateOnReconnect: true, // 重新连接时重新验证
    dedupingInterval: 2000, // 2秒内的重复请求会被去重
  });

  // 删除文件
  const deleteFile = async (fileId: string) => {
    try {
      await axios.delete(`/api/knowledge/delete?id=${fileId}`);
      toast.success("文件删除成功");
      // 重新验证数据
      mutateLocal();
      return true;
    } catch (error) {
      return false;
    }
  };

  // 批量删除文件
  const deleteFiles = async (fileIds: string[]) => {
    try {
      const results = await Promise.allSettled(
        fileIds.map((id) => axios.delete(`/api/knowledge/delete?id=${id}`))
      );

      const successCount = results.filter((r) => r.status === "fulfilled").length;
      const failedCount = results.filter((r) => r.status === "rejected").length;

      if (failedCount === 0) {
        toast.success(`成功删除 ${fileIds.length} 个文件`);
        // 重新验证数据
        mutateLocal();
        return true;
      }
      // 获取第一个失败的错误信息
      const firstError = results.find((r) => r.status === "rejected");
      if (firstError && firstError.status === "rejected") {
        const error = firstError.reason;
        toast.error(error.response?.data?.error || `删除失败：${failedCount} 个文件无法删除`);
      } else {
        toast.error(`删除失败：${failedCount} 个文件无法删除`);
      }
      // 即使有部分失败，也刷新数据
      mutateLocal();
      return false;
    } catch (error) {
      if (error instanceof AxiosError) {
        toast.error(error.response?.data?.error || "批量删除文件失败");
      }

      return false;
    }
  };

  // 更新文件信息
  const updateFile = async (
    fileId: string,
    updates: { originalname?: string; tags?: number[]; summary?: string }
  ) => {
    try {
      const hasNameOrSummary =
        updates.originalname !== undefined || updates.summary !== undefined;
      if (hasNameOrSummary) {
        const payload: { id: string; originalname?: string; summary?: string } = {
          id: fileId,
        };
        if (updates.originalname !== undefined) payload.originalname = updates.originalname;
        if (updates.summary !== undefined) payload.summary = updates.summary;
        await axios.put("/api/knowledge/update", payload);
      }

      if (updates.tags) {
        await axios.post("/api/knowledge/file-tags", {
          file_id: fileId,
          tag_ids: updates.tags,
        });
      }

      toast.success("文件更新成功");
      // 重新验证数据
      mutateLocal();
      return true;
    } catch (error) {
      return false;
    }
  };

  // 更新单个文件的状态（用于轮询更新）
  const updateFileStatus = (fileId: string, fileData: FileItem) => {
    // 使用乐观更新
    mutateLocal(
      (currentData) => {
        if (!currentData) return currentData;

        const updatedFiles = currentData.files.map((file: FileItem) =>
          file.id === fileId ? { ...file, status: fileData.status } : file
        );

        // 更新未分段文件数量
        const currentFile = currentData.files.find((f: FileItem) => f.id === fileId);
        let newUnsegmentedCount = currentData.unsegmented_count;
        if (currentFile && currentFile.status !== "indexed" && fileData.status === "indexed") {
          newUnsegmentedCount = Math.max(0, currentData.unsegmented_count - 1);
        }

        return {
          ...currentData,
          files: updatedFiles,
          unsegmented_count: newUnsegmentedCount,
        };
      },
      { revalidate: false } // 不立即重新验证，因为这是乐观更新
    );
  };

  // 刷新数据
  const refresh = () => {
    mutateLocal();
  };

  return {
    fileList: data?.files || [],
    pagination: data?.pagination || { page: 1, total: 0, total_pages: 1 },
    loading: isLoading,
    error,
    totalUnsegmentedCount: data?.unsegmented_count || 0,
    dataset: data?.dataset || null,
    deleteFile,
    deleteFiles,
    updateFile,
    updateFileStatus,
    refresh,
  };
};
