import { useState, useCallback, useRef } from "react";
import axios from "@/lib/axios";
import { toast } from "sonner";

export interface VectorizationStatus {
  [fileId: string]: {
    isPolling: boolean;
    progress: number;
    isClicked: boolean;
  };
}

export const useVectorization = (onFileStatusChange?: (fileId: string, fileData: any) => void) => {
  const [vectorizationStatus, setVectorizationStatus] = useState<VectorizationStatus>({});
  const pollingTimeouts = useRef<{ [fileId: string]: NodeJS.Timeout }>({});

  // 启动单个文件的分段
  const startVectorization = useCallback(async (fileId: string, fileStatus: string) => {
    // 立即设置按钮状态，防止重复点击
    setVectorizationStatus((prev) => ({
      ...prev,
      [fileId]: {
        isPolling: false,
        progress: 0,
        isClicked: true,
      },
    }));

    try {
      // 根据文件状态给出不同的提示
      if (fileStatus === "indexed") {
        const choice = window.confirm(
          "该文件已经完成分段。\n\n" +
            '点击"确定"：重新分段（将覆盖现有分段）\n' +
            '点击"取消"：取消操作'
        );
        if (!choice) {
          // 用户取消，重置按钮状态
          setVectorizationStatus((prev) => ({
            ...prev,
            [fileId]: {
              isPolling: false,
              progress: 0,
              isClicked: false,
            },
          }));
          return false;
        }
      } else if (fileStatus === "processing") {
        const choice = window.confirm(
          "该文件正在处理中。\n\n" +
            '点击"确定"：重新分段（将中断当前处理）\n' +
            '点击"取消"：取消操作'
        );
        if (!choice) {
          // 用户取消，重置按钮状态
          setVectorizationStatus((prev) => ({
            ...prev,
            [fileId]: {
              isPolling: false,
              progress: 0,
              isClicked: false,
            },
          }));
          return false;
        }
      }

      // 立即将文件状态改为 processing，不等待API返回
      onFileStatusChange?.(fileId, { status: "processing" });

      // 调用 Next.js API 进行分段
      const response = await axios.post("/api/knowledge/vectorize-file", {
        fileId,
        force: true, // 添加强制重新分段参数
      });
      const data = response.data;

      if (data.status === "processing") {
        // 开始轮询
        startPolling(fileId);
        return true;
      } else if (data.error) {
        toast.error(`分段失败: ${data.error}`);
        // 回滚文件状态到原始状态
        onFileStatusChange?.(fileId, { status: fileStatus });
        // 重置按钮状态，允许用户重试
        setVectorizationStatus((prev) => ({
          ...prev,
          [fileId]: {
            isPolling: false,
            progress: 0,
            isClicked: false,
          },
        }));
        return false;
      } else {
        toast.error("分段失败，请重试");
        // 回滚文件状态到原始状态
        onFileStatusChange?.(fileId, { status: fileStatus });
        // 重置按钮状态，允许用户重试
        setVectorizationStatus((prev) => ({
          ...prev,
          [fileId]: {
            isPolling: false,
            progress: 0,
            isClicked: false,
          },
        }));
        return false;
      }
    } catch (error) {
      // 回滚文件状态到原始状态
      onFileStatusChange?.(fileId, { status: fileStatus });
      // 重置按钮状态，允许用户重试
      setVectorizationStatus((prev) => ({
        ...prev,
        [fileId]: {
          isPolling: false,
          progress: 0,
          isClicked: false,
        },
      }));
      return false;
    }
  }, []);

  // 批量启动分段
  const startBatchVectorization = useCallback(
    async (fileIds: string[], fileStatusMap: { [fileId: string]: string }) => {
      // 分析文件状态，生成确认提示
      const statusCounts = {
        pending: 0,
        processing: 0,
        indexed: 0,
        failed: 0,
      };

      fileIds.forEach((fileId) => {
        const status = fileStatusMap[fileId];
        if (status in statusCounts) {
          statusCounts[status as keyof typeof statusCounts]++;
        }
      });

      // 显示开始提示
      toast.info(`开始批量分段 ${fileIds.length} 个文件...`);

      // 立即设置所有文件的按钮状态
      fileIds.forEach((fileId) => {
        setVectorizationStatus((prev) => ({
          ...prev,
          [fileId]: {
            isPolling: false,
            progress: 0,
            isClicked: true,
          },
        }));
        // 立即将文件状态改为 processing
        onFileStatusChange?.(fileId, { status: "processing" });
      });

      try {
        // 使用新的批量 API
        const response = await axios.post("/api/knowledge/vectorize-files-batch", {
          file_ids: fileIds,
          force: true, // 添加强制重新分段参数
        });
        const data = response.data;

        // 检查响应格式 - 支持新的批量响应格式
        if (data.success_count > 0 || data.task_ids?.length > 0) {
          // 批量请求成功，开始轮询所有文件
          fileIds.forEach((fileId) => {
            startPolling(fileId);
          });

          const successCount = data.success_count || data.task_ids?.length || fileIds.length;
          toast.success(`批量分段已启动！成功启动 ${successCount} 个文件`);
          return fileIds.map((fileId) => ({ fileId, success: true }));
        } else {
          // 批量请求失败
          const errorMessage = data.errors?.join(", ") || data.error || "批量分段失败";
          toast.error(`批量分段失败: ${errorMessage}`);

          // 回滚所有文件状态
          fileIds.forEach((fileId) => {
            const originalStatus = fileStatusMap[fileId];
            onFileStatusChange?.(fileId, { status: originalStatus });
            setVectorizationStatus((prev) => ({
              ...prev,
              [fileId]: {
                isPolling: false,
                progress: 0,
                isClicked: false,
              },
            }));
          });

          return fileIds.map((fileId) => ({ fileId, success: false, error: errorMessage }));
        }
      } catch (error) {
        const errorMessage = "批量分段请求失败，请重试";

        // 回滚所有文件状态
        fileIds.forEach((fileId) => {
          const originalStatus = fileStatusMap[fileId];
          onFileStatusChange?.(fileId, { status: originalStatus });
          setVectorizationStatus((prev) => ({
            ...prev,
            [fileId]: {
              isPolling: false,
              progress: 0,
              isClicked: false,
            },
          }));
        });

        return fileIds.map((fileId) => ({ fileId, success: false, error: errorMessage }));
      }
    },
    []
  );

  // 开始轮询文件状态
  const startPolling = useCallback((fileId: string) => {
    // 清除之前的轮询
    if (pollingTimeouts.current[fileId]) {
      clearTimeout(pollingTimeouts.current[fileId]);
    }

    setVectorizationStatus((prev) => ({
      ...prev,
      [fileId]: {
        ...prev[fileId],
        isPolling: true,
        progress: 50,
      },
    }));

    const poll = async () => {
      try {
        // 直接获取单个文件的状态，更高效
        const response = await axios.get(`/api/knowledge/file-status?id=${fileId}`);
        const fileData = response.data;

        if (!fileData || !fileData.file) {
          stopPolling(fileId);
          toast.error("文件不存在");
          return;
        }

        const currentFile = fileData.file;
        console.log("Polling result:", { fileId, status: currentFile.status });

        // 通知主页面文件状态已改变（每次轮询都更新）
        onFileStatusChange?.(fileId, currentFile);

        // 检查文件是否完成处理
        if (currentFile.status === "indexed") {
          stopPolling(fileId);
          // 不重置文件状态，保持按钮禁用
          return;
        } else if (currentFile.status === "failed") {
          stopPolling(fileId);
          // 不重置文件状态，保持按钮禁用
          toast.error("文件处理失败");
          return;
        }

        // 继续轮询
        pollingTimeouts.current[fileId] = setTimeout(poll, 3000);
      } catch (error) {
        console.error("进度轮询失败:", error);
        stopPolling(fileId);
        // 不重置文件状态，保持按钮禁用
        toast.error("轮询状态失败");
      }
    };

    poll();
  }, []);

  // 停止轮询
  const stopPolling = useCallback((fileId: string) => {
    if (pollingTimeouts.current[fileId]) {
      clearTimeout(pollingTimeouts.current[fileId]);
      delete pollingTimeouts.current[fileId];
    }

    setVectorizationStatus((prev) => ({
      ...prev,
      [fileId]: {
        ...prev[fileId],
        isPolling: false,
      },
    }));
  }, []);

  // 重置文件状态
  const resetFileStatus = useCallback((fileId: string) => {
    setVectorizationStatus((prev) => {
      const newStatus = { ...prev };
      delete newStatus[fileId];
      return newStatus;
    });
  }, []);

  // 停止所有轮询
  const stopAllPolling = useCallback(() => {
    Object.keys(pollingTimeouts.current).forEach((fileId) => {
      clearTimeout(pollingTimeouts.current[fileId]);
    });
    pollingTimeouts.current = {};
    setVectorizationStatus({});
  }, []);

  // 检查文件是否正在处理
  const isFileProcessing = useCallback(
    (fileId: string) => {
      return vectorizationStatus[fileId]?.isPolling || false;
    },
    [vectorizationStatus]
  );

  // 检查文件是否已点击
  const isFileClicked = useCallback(
    (fileId: string) => {
      return vectorizationStatus[fileId]?.isClicked || false;
    },
    [vectorizationStatus]
  );

  // 获取文件进度
  const getFileProgress = useCallback(
    (fileId: string) => {
      return vectorizationStatus[fileId]?.progress || 0;
    },
    [vectorizationStatus]
  );

  return {
    vectorizationStatus,
    startVectorization,
    startBatchVectorization,
    stopPolling,
    resetFileStatus,
    stopAllPolling,
    isFileProcessing,
    isFileClicked,
    getFileProgress,
  };
};
