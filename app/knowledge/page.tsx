"use client";

import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { ArrowLeft, Bug, Search } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

import { useCurrentUser } from "@/hooks/useCurrentUser";
import axios from "@/lib/axios";
import { SEGMENT_ALL_BATCH_SIZE } from "@/lib/knowledgeVectorizationConfig";
// Hooks
import { FileItem, useFileManagement } from "@/hooks/useFileManagement";
import { useSegmentManagement } from "@/hooks/useSegmentManagement";
import { useTagManagement } from "@/hooks/useTagManagement";
import { useVectorization } from "@/hooks/useVectorization";
import { downloadFileFromFile } from "@/lib/fileApi";
import { toast } from "sonner";

import { FilePreviewDialog } from "@/components/FilePreviewDialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Pagination } from "@/components/ui/pagination";
import { checkDeptAdmin, checkSuperAdmin, checkTenantAdmin } from "@/lib/clientPermissions";
import { BatchTagDialog } from "./components/BatchTagDialog";
import { FileActionToolbar } from "./components/FileActionToolbar";
import { FileEditDialog } from "./components/FileEditDialog";
import { FileFilter } from "./components/FileFilter";
import { CrawlerDialog } from "./components/CrawlerDialog";
// Components
import { FileList } from "./components/FileList";
import { FloatingUploadButton } from "./components/FloatingUploadButton";
import { SegmentDetail } from "./components/SegmentDetail";

type ApiError = {
  response?: {
    data?: {
      error?: string;
      message?: string;
    };
  };
  message?: string;
};

const getErrorMessage = (error: unknown, fallback: string) => {
  const apiError = error as ApiError;
  return (
    apiError.response?.data?.message ||
    apiError.response?.data?.error ||
    apiError.message ||
    fallback
  );
};

export default function KnowledgePage() {
  const t = useTranslations("knowledge");
  const tc = useTranslations("common");
  const router = useRouter();
  const searchParams = useSearchParams();
  const datasetId = searchParams?.get("dataset") || undefined;
  const fileIdFromUrl = searchParams?.get("file") || undefined;

  // 状态管理
  const [selectedFileIds, setSelectedFileIds] = useState<Set<string>>(new Set());
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize] = useState(20);
  const [selectedTagId, setSelectedTagId] = useState<string>("all");
  const [selectedStatus, setSelectedStatus] = useState<string>("all");
  const [searchKeyword, setSearchKeyword] = useState<string>("");

  // 对话框状态
  const [showSegmentsSheet, setShowSegmentsSheet] = useState(false);
  const [showEditFileDialog, setShowEditFileDialog] = useState(false);
  const [showBatchTagDialog, setShowBatchTagDialog] = useState(false);
  const [showSegmentAllConfirm, setShowSegmentAllConfirm] = useState(false);
  const [showCrawlerDialog, setShowCrawlerDialog] = useState(false);
  const [previewFile, setPreviewFile] = useState<FileItem | null>(null);
  const previewDismissedRef = useRef(false);

  // 当前操作的文件
  const [currentFile, setCurrentFile] = useState<FileItem | null>(null);
  const [currentFileName, setCurrentFileName] = useState<string>("");
  const [currentFileId, setCurrentFileId] = useState<string>("");

  // 批量操作状态
  const [batchDeleting, setBatchDeleting] = useState(false);
  const [vectorizingAll, setVectorizingAll] = useState(false);
  const [vectorizeAllRefreshUntil, setVectorizeAllRefreshUntil] = useState<number | null>(null);
  const [downloadingFileId, setDownloadingFileId] = useState<string | null>(null);

  // 自定义 Hooks
  const {
    fileList,
    pagination,
    loading,
    totalUnsegmentedCount,
    dataset,
    deleteFile,
    deleteFiles,
    updateFile,
    updateFileStatus,
    refresh: refreshFileList,
  } = useFileManagement({
    page: currentPage,
    pageSize,
    tagId: selectedTagId,
    status: selectedStatus,
    datasetId,
    searchKeyword,
  });

  // 文件状态改变时的回调
  const handleFileStatusChange = useCallback(
    (fileId: string, fileData: FileItem) => {
      // 只更新特定文件的状态，不刷新整个页面
      updateFileStatus(fileId, fileData);
    },
    [updateFileStatus]
  );

  const { startVectorization, startBatchVectorization } = useVectorization(handleFileStatusChange);

  const { availableTags, loading: tagsLoading } = useTagManagement(datasetId);

  const { segments, loading: segmentsLoading, updateSegment } = useSegmentManagement(currentFileId);

  useEffect(() => {
    if (!vectorizeAllRefreshUntil || selectedStatus !== "unsegmented") return;

    if (Date.now() >= vectorizeAllRefreshUntil || totalUnsegmentedCount === 0) {
      setVectorizeAllRefreshUntil(null);
      return;
    }

    const intervalId = window.setInterval(() => {
      if (Date.now() >= vectorizeAllRefreshUntil) {
        setVectorizeAllRefreshUntil(null);
        return;
      }

      refreshFileList();
    }, 8000);

    return () => window.clearInterval(intervalId);
  }, [refreshFileList, selectedStatus, totalUnsegmentedCount, vectorizeAllRefreshUntil]);

  // 通过 URL 参数自动打开文件预览
  useEffect(() => {
    if (fileIdFromUrl && !previewFile && !previewDismissedRef.current) {
      const targetFile = fileList?.find((f: FileItem) => f.id === fileIdFromUrl);
      if (targetFile) {
        setPreviewFile(targetFile);
      } else if (!loading) {
        // 文件不在当前页，用最小信息打开预览（对话框内部会根据 ID 获取文件详情）
        setPreviewFile({ id: fileIdFromUrl } as FileItem);
      }
    }
    // fileIdFromUrl 变化时重置 dismissed 状态
    if (!fileIdFromUrl) {
      previewDismissedRef.current = false;
    }
  }, [fileIdFromUrl, fileList, previewFile, loading]);

  // 获取当前用户信息
  const { user } = useCurrentUser();

  // 检查用户是否有权限编辑文件
  const canModifyFile = useCallback(
    (file: FileItem) => {
      if (!user) return false;

      // 文件创建者可以修改
      if (file.user_id && Number(file.user_id) === Number(user.id)) {
        return true;
      }

      // 超级管理员、租户管理员、部门管理员可以修改所有文件
      if (checkSuperAdmin(user) || checkTenantAdmin(user) || checkDeptAdmin(user)) {
        return true;
      }

      return false;
    },
    [user]
  );

  // 检查用户是否有权限删除文件
  const canDeleteFile = useCallback(
    (file: FileItem) => {
      if (!user) return false;

      // 文件创建者可以删除
      if (file.user_id && Number(file.user_id) === Number(user.id)) {
        return true;
      }

      // 超级管理员、租户管理员、部门管理员可以删除所有文件
      if (checkSuperAdmin(user) || checkTenantAdmin(user) || checkDeptAdmin(user)) {
        return true;
      }

      return false;
    },
    [user]
  );

  // 文件选择处理
  const handleSelectFile = useCallback((fileId: string, checked: boolean) => {
    setSelectedFileIds((prev) => {
      const newSet = new Set(prev);
      if (checked) {
        newSet.add(fileId);
      } else {
        newSet.delete(fileId);
      }
      return newSet;
    });
  }, []);

  const handleSelectAll = useCallback(
    (checked: boolean) => {
      if (checked) {
        setSelectedFileIds(new Set(fileList.map((file: FileItem) => file.id)));
      } else {
        setSelectedFileIds(new Set());
      }
    },
    [fileList]
  );

  // 筛选处理
  const handleTagFilter = useCallback((tagId: string) => {
    setSelectedTagId(tagId);
    setCurrentPage(1);
  }, []);

  const handleStatusFilter = useCallback((status: string) => {
    setSelectedStatus(status);
    setCurrentPage(1);
  }, []);

  const handleSearchChange = useCallback((keyword: string) => {
    setSearchKeyword(keyword);
    setCurrentPage(1);
  }, []);

  // 分页处理
  const handlePageChange = useCallback((page: number) => {
    setCurrentPage(page);
  }, []);

  // 文件操作处理
  const handleShowSegments = useCallback(async (file: FileItem) => {
    setCurrentFileName(file.originalname);
    setCurrentFileId(file.id);
    setShowSegmentsSheet(true);
  }, []);

  const handleEditFile = useCallback((file: FileItem) => {
    setCurrentFile(file);
    setShowEditFileDialog(true);
  }, []);

  const handleDeleteFile = useCallback(
    async (fileId: string) => {
      if (!window.confirm(t("deleteFileConfirm"))) return;

      // deleteFile 内部会自动调用 mutate 刷新数据
      await deleteFile(fileId);
    },
    [deleteFile, t]
  );

  const handleVectorizeFile = useCallback(
    async (fileId: string) => {
      const file = fileList.find((f: FileItem) => f.id === fileId);
      if (!file) return;

      const success = await startVectorization(fileId, file.status);
      if (success) {
        // 不需要刷新整个页面，轮询会自动更新文件状态
        // 文件状态更新会通过 handleFileStatusChange 回调自动处理
      }
    },
    [startVectorization, fileList]
  );

  // 批量操作处理
  const handleBatchVectorize = useCallback(async () => {
    if (selectedFileIds.size === 0) return;

    const selectedFiles = fileList.filter((file: FileItem) => selectedFileIds.has(file.id));
    const fileStatusMap = selectedFiles.reduce(
      (acc: { [fileId: string]: string }, file: FileItem) => {
        acc[file.id] = file.status;
        return acc;
      },
      {}
    );

    await startBatchVectorization(Array.from(selectedFileIds), fileStatusMap);

    // 不需要刷新整个页面，轮询会自动更新文件状态
    // 文件状态更新会通过 handleFileStatusChange 回调自动处理
  }, [selectedFileIds, fileList, startBatchVectorization]);

  const handleBatchDelete = useCallback(async () => {
    if (selectedFileIds.size === 0) return;

    const selectedFiles = fileList.filter((file: FileItem) => selectedFileIds.has(file.id));
    const processingFiles = selectedFiles.filter((file: FileItem) => file.status === "processing");
    const pendingFiles = selectedFiles.filter((file: FileItem) => file.status === "pending");
    const indexedFiles = selectedFiles.filter((file: FileItem) => file.status === "indexed");
    const failedFiles = selectedFiles.filter((file: FileItem) => file.status === "failed");

    let confirmMessage = `${t("batchDeleteConfirm", { count: selectedFiles.length })}\n\n`;

    const statusDetails = [];
    if (pendingFiles.length > 0)
      statusDetails.push(t("pendingCount", { count: pendingFiles.length }));
    if (processingFiles.length > 0)
      statusDetails.push(t("processingCount", { count: processingFiles.length }));
    if (indexedFiles.length > 0)
      statusDetails.push(t("indexedCount", { count: indexedFiles.length }));
    if (failedFiles.length > 0) statusDetails.push(t("failedCount", { count: failedFiles.length }));

    confirmMessage += `${t("fileStatusDetails", { details: statusDetails.join(", ") })}\n\n`;
    confirmMessage += t("deleteWarning");

    if (processingFiles.length > 0) {
      confirmMessage += `\n\n${t("processingWarning", { count: processingFiles.length })}`;
    }

    const choice = window.confirm(confirmMessage);
    if (!choice) return;

    setBatchDeleting(true);
    try {
      const success = await deleteFiles(Array.from(selectedFileIds));
      if (success) {
        setSelectedFileIds(new Set());
        // deleteFiles 内部会自动调用 mutate 刷新数据
      }
    } finally {
      setBatchDeleting(false);
    }
  }, [selectedFileIds, fileList, deleteFiles, t]);

  const handleBatchTag = useCallback(
    async (tagIds: number[]) => {
      if (selectedFileIds.size === 0 || tagIds.length === 0) return;

      try {
        const promises = Array.from(selectedFileIds).map((id) => updateFile(id, { tags: tagIds }));

        await Promise.all(promises);
        setSelectedFileIds(new Set());
      } catch (error: unknown) {
        toast.error(getErrorMessage(error, t("batchTagFailed")));
      }
    },
    [selectedFileIds, updateFile, t]
  );

  const handleOpenSegmentAllConfirm = useCallback(() => {
    if (!datasetId) {
      toast.error(t("selectDatasetFirst"));
      return;
    }

    if (totalUnsegmentedCount === 0) {
      toast.info(t("segmentAllNoFiles"));
      return;
    }

    setShowSegmentAllConfirm(true);
  }, [datasetId, totalUnsegmentedCount, t]);

  const handleVectorizeAllUnsegmented = useCallback(async () => {
    if (!datasetId || totalUnsegmentedCount === 0) {
      setShowSegmentAllConfirm(false);
      return;
    }

    setShowSegmentAllConfirm(false);
    setVectorizingAll(true);
    try {
      const response = await axios.post("/api/knowledge/vectorize-unsegmented-files", {
        dataset_id: datasetId,
      });
      const data = response.data || {};
      const startedCount = Number(data.started_count || 0);
      const queuedCount = Number(data.queued_count || 0);
      const skippedCount = Number(data.skipped_count || 0);

      if (startedCount === 0 && queuedCount === 0) {
        toast.info(
          skippedCount > 0
            ? `${t("segmentAllNoFiles")} ${t("segmentAllSkipped", { count: skippedCount })}`
            : t("segmentAllNoFiles")
        );
      } else {
        const message =
          startedCount === 0
            ? t("segmentAllQueued", { count: queuedCount })
            : queuedCount > 0
              ? t("segmentAllStartedWithQueue", {
                  started: startedCount,
                  queued: queuedCount,
                })
              : t("segmentAllStarted", { count: startedCount });
        const skippedMessage =
          skippedCount > 0 ? ` ${t("segmentAllSkipped", { count: skippedCount })}` : "";

        toast.success(`${message}${skippedMessage}`);
      }

      setSelectedStatus("unsegmented");
      setCurrentPage(1);
      setSelectedFileIds(new Set());
      setVectorizeAllRefreshUntil(Date.now() + 5 * 60 * 1000);
      refreshFileList();
    } catch (error: unknown) {
      toast.error(getErrorMessage(error, t("segmentAllFailed")));
    } finally {
      setVectorizingAll(false);
    }
  }, [datasetId, refreshFileList, totalUnsegmentedCount, t]);

  // 文件编辑处理
  const handleSaveFile = useCallback(
    async (fileId: string, updates: { originalname: string; tags: number[]; summary?: string }) => {
      // updateFile 内部会自动调用 mutate 刷新数据
      await updateFile(fileId, updates);
    },
    [updateFile]
  );

  // 文件替换成功后的处理（启动分段和轮询）
  const handleFileReplace = useCallback(
    async (fileId: string) => {
      // 先刷新列表，确保新文件状态出现在 UI 中
      refreshFileList();

      // 文件替换后，状态会重置为 "pending"，直接使用这个状态
      // 稍等片刻等待 SWR 同步，然后启动分段处理和轮询
      setTimeout(() => {
        // 构建状态映射（文件替换后状态应该是 "pending"）
        const fileStatusMap: { [fileId: string]: string } = {
          [fileId]: "pending",
        };

        // 启动分段处理和轮询
        startBatchVectorization([fileId], fileStatusMap);
      }, 400);
    },
    [refreshFileList, startBatchVectorization]
  );

  // 分段更新处理
  const handleUpdateSegment = useCallback(
    async (segmentId: number, segmentText: string) => {
      await updateSegment(segmentId, segmentText);
    },
    [updateSegment]
  );

  // 预览文件处理
  const handlePreviewFile = useCallback((file: FileItem) => {
    setPreviewFile(file);
  }, []);

  // 下载文件处理
  const handleDownloadFile = useCallback(
    async (file: FileItem) => {
      // 设置下载状态
      setDownloadingFileId(file.id);

      try {
        await downloadFileFromFile(file);
      } catch (error: unknown) {
        const errorMessage = getErrorMessage(error, t("deleteFailed"));
        toast.error(t("downloadError", { message: errorMessage }));
      } finally {
        // 清除下载状态
        setDownloadingFileId(null);
      }
    },
    [t]
  );

  return (
    <div className="space-y-6">
      {/* 页面标题 */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">
            {datasetId ? dataset?.name || tc("loading") : t("fileManagement")}
          </h1>
        </div>
        <div className="flex items-center gap-3">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              type="text"
              placeholder={t("searchPlaceholder")}
              value={searchKeyword}
              onChange={(e) => handleSearchChange(e.target.value)}
              className="pl-10 w-64"
            />
          </div>
          {checkSuperAdmin(user) && user?.username === "admin" && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowCrawlerDialog(true)}
              disabled={!datasetId}
              title={datasetId ? t("crawlerTooltip") : t("crawlerSelectDatasetFirst")}
            >
              <Bug className="h-4 w-4 mr-2" />
              {t("crawlerTask")}
            </Button>
          )}
          {datasetId && (
            <Button variant="outline" onClick={() => router.push("/datasets")}>
              <ArrowLeft className="h-4 w-4 mr-2" />
              {t("back")}
            </Button>
          )}
        </div>
      </div>

      <Card>
        <CardHeader>
          <FileFilter
            availableTags={availableTags}
            selectedTagId={selectedTagId}
            selectedStatus={selectedStatus}
            totalUnsegmentedCount={totalUnsegmentedCount}
            totalFiles={pagination.total}
            tagsLoading={tagsLoading}
            vectorizingAll={vectorizingAll}
            onTagFilter={handleTagFilter}
            onStatusFilter={handleStatusFilter}
            onVectorizeAllUnsegmented={handleOpenSegmentAllConfirm}
          />
        </CardHeader>

        <CardContent>
          {/* 批量操作工具栏 */}
          <FileActionToolbar
            selectedFileIds={selectedFileIds}
            files={fileList}
            onBatchVectorize={handleBatchVectorize}
            onBatchTag={() => setShowBatchTagDialog(true)}
            onBatchDelete={handleBatchDelete}
            onClearSelection={() => setSelectedFileIds(new Set())}
            batchDeleting={batchDeleting}
          />

          {/* 文件列表 */}
          <FileList
            files={fileList}
            selectedFileIds={selectedFileIds}
            onSelectFile={handleSelectFile}
            onSelectAll={handleSelectAll}
            onShowSegments={handleShowSegments}
            onEditFile={handleEditFile}
            onDeleteFile={handleDeleteFile}
            onVectorizeFile={handleVectorizeFile}
            onPreviewFile={handlePreviewFile}
            onDownloadFile={handleDownloadFile}
            loading={loading}
            downloadingFileId={downloadingFileId}
            canModifyFile={canModifyFile}
            canDeleteFile={canDeleteFile}
          />

          {/* 分页组件 */}
          <Pagination
            pagination={pagination}
            onPageChange={handlePageChange}
            itemName={t("filesUnit")}
          />
        </CardContent>
      </Card>

      {/* 分段详情 Sheet */}
      <SegmentDetail
        isOpen={showSegmentsSheet}
        onClose={() => setShowSegmentsSheet(false)}
        fileName={currentFileName}
        fileId={currentFileId}
        segments={segments}
        loading={segmentsLoading}
        onUpdateSegment={handleUpdateSegment}
      />

      {/* 文件编辑对话框 */}
      <FileEditDialog
        isOpen={showEditFileDialog}
        onClose={() => setShowEditFileDialog(false)}
        file={currentFile}
        onSave={handleSaveFile}
        onFileReplace={handleFileReplace}
      />

      {/* 批量打标签对话框 */}
      <BatchTagDialog
        isOpen={showBatchTagDialog}
        onClose={() => setShowBatchTagDialog(false)}
        selectedCount={selectedFileIds.size}
        onSave={handleBatchTag}
      />

      <CrawlerDialog
        open={showCrawlerDialog}
        onOpenChange={setShowCrawlerDialog}
        datasetId={datasetId}
      />

      <AlertDialog open={showSegmentAllConfirm} onOpenChange={setShowSegmentAllConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("segmentAllConfirmTitle")}</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-3">
                <p>{t("segmentAllConfirmDescription", { count: totalUnsegmentedCount })}</p>
                <ul className="list-disc space-y-1 pl-5">
                  <li>{t("segmentAllConfirmOnlyUnsegmented")}</li>
                  <li>{t("segmentAllConfirmBatching", { batchSize: SEGMENT_ALL_BATCH_SIZE })}</li>
                  <li>{t("segmentAllConfirmAfterSubmit")}</li>
                </ul>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={vectorizingAll}>{t("segmentAllCancel")}</AlertDialogCancel>
            <AlertDialogAction onClick={handleVectorizeAllUnsegmented} disabled={vectorizingAll}>
              {vectorizingAll ? t("segmentAllSubmitting") : t("segmentAllConfirmAction")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* 文件预览对话框 */}
      <FilePreviewDialog
        file={previewFile}
        open={!!previewFile}
        onOpenChange={(v) => {
          if (!v) {
            setPreviewFile(null);
            if (fileIdFromUrl) {
              previewDismissedRef.current = true;
              const url = new URL(window.location.href);
              url.searchParams.delete("file");
              router.replace(url.pathname + url.search, { scroll: false });
            }
          }
        }}
        datasetId={datasetId}
      />

      {/* 悬浮上传按钮 */}
      {datasetId && (
        <FloatingUploadButton
          datasetId={datasetId}
          onUploadSuccess={() => {
            // 上传成功后刷新文件列表
            refreshFileList();
          }}
          onAutoVectorize={(fileIds: string[]) => {
            // 先刷新列表，确保新文件出现在 UI 中，状态更新才能覆盖到行
            refreshFileList();
            // 稍等片刻等待 SWR 同步（mutate 不返回 Promise 的封装）
            setTimeout(() => {
              const latestList = fileList || [];
              const fileStatusMap = fileIds.reduce(
                (acc: { [fileId: string]: string }, id: string) => {
                  const file = latestList.find((f: FileItem) => f.id === id);
                  acc[id] = file?.status || "pending";
                  return acc;
                },
                {}
              );
              // 触发与手动一致的交互（确认、状态更新、轮询）
              startBatchVectorization(fileIds, fileStatusMap);
            }, 400);
          }}
        />
      )}
    </div>
  );
}
