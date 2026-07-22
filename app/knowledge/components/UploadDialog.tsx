"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { useTranslations } from "next-intl";
import * as Dialog from "@radix-ui/react-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  X,
  FileText,
  CheckCircle,
  AlertTriangle,
  Eye,
  ChevronDown,
  ChevronRight,
} from "lucide-react";
import { toast } from "sonner";
import axios from "@/lib/axios";
import { uploadFile } from "@/lib/ossUpload";
import TagSelect from "@/components/TagSelect";
import { FilePreviewDialog } from "@/components/FilePreviewDialog";
import { FileItem } from "@/hooks/useFileManagement";

interface UploadDialogProps {
  isOpen: boolean;
  onClose: () => void;
  datasetId: string;
  onUploadSuccess: () => void;
  initialFiles?: File[];
  onAutoVectorize?: (fileIds: string[]) => void;
}

// 现有文件信息（从数据库查询到的重复文件）
interface ExistingFile {
  id: string;
  filename: string;
  originalname: string;
  mimetype: string;
  size: number;
  upload_time: string;
  status: string;
  uploader_name?: string;
  shouldReplace: boolean; // 是否勾选替换此文件
}

interface UploadFile {
  file: File;
  id: string;
  status: "pending" | "uploading" | "success" | "error";
  progress: number;
  error?: string;
  // 新增字段
  duplicateFiles: ExistingFile[]; // 匹配到的现有文件列表（每个文件有自己的 shouldReplace）
  showDuplicates: boolean; // 是否展开显示重复文件列表
}

export const UploadDialog = ({
  isOpen,
  onClose,
  datasetId,
  onUploadSuccess,
  initialFiles = [],
  onAutoVectorize,
}: UploadDialogProps) => {
  const t = useTranslations("knowledge");
  const tc = useTranslations("common");
  const [files, setFiles] = useState<UploadFile[]>([]);
  const [selectedTags, setSelectedTags] = useState<number[]>([]);
  const [uploading, setUploading] = useState(false);
  const [checkingDuplicates, setCheckingDuplicates] = useState(false);
  const [previewFile, setPreviewFile] = useState<FileItem | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // 检查重复文件（在指定数据集内）
  const checkDuplicates = useCallback(
    async (filesToCheck: UploadFile[]) => {
      if (filesToCheck.length === 0) return;

      setCheckingDuplicates(true);
      try {
        const filenames = filesToCheck.map((f) => f.file.name);
        const response = await axios.post("/api/knowledge/check-duplicates", {
          filenames,
          dataset_id: datasetId,
        });

        const duplicates = response.data.duplicates || {};

        // 使用传入的文件列表来更新（避免异步状态问题）
        const updatedFiles = filesToCheck.map((f) => {
          const dups = (duplicates[f.file.name] || []).map((dup: any) => ({
            ...dup,
            shouldReplace: true, // 默认勾选替换
          }));
          return {
            ...f,
            duplicateFiles: dups,
            showDuplicates: dups.length > 0, // 有重复时默认展开
          };
        });

        setFiles(updatedFiles);
      } catch (error) {
        console.error("检查重复文件失败:", error);
      } finally {
        setCheckingDuplicates(false);
      }
    },
    [datasetId]
  );

  // 处理初始文件
  useEffect(() => {
    if (initialFiles.length > 0) {
      const newFiles: UploadFile[] = initialFiles.map((file) => ({
        file,
        id: Math.random().toString(36).substr(2, 9),
        status: "pending",
        progress: 0,
        duplicateFiles: [],
        showDuplicates: false,
      }));

      // 检查重复（会自动设置 files 状态）
      if (datasetId) {
        checkDuplicates(newFiles);
      } else {
        setFiles(newFiles);
      }
    }
  }, [initialFiles, datasetId, checkDuplicates]);

  const handleFileSelect = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFiles = Array.from(event.target.files || []);

    const newFiles: UploadFile[] = selectedFiles.map((file) => ({
      file,
      id: Math.random().toString(36).substr(2, 9),
      status: "pending",
      progress: 0,
      duplicateFiles: [],
      showDuplicates: false,
    }));

    const updatedFiles = [...files, ...newFiles];

    // 清空文件输入框，允许重复选择相同文件
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }

    // 检查重复（会自动设置 files 状态）
    if (datasetId) {
      checkDuplicates(updatedFiles);
    } else {
      setFiles(updatedFiles);
    }
  };

  // 切换单个现有文件的替换状态
  const toggleDuplicateFileReplace = (uploadFileId: string, duplicateFileId: string) => {
    setFiles((prev) =>
      prev.map((f) => {
        if (f.id !== uploadFileId) return f;
        return {
          ...f,
          duplicateFiles: f.duplicateFiles.map((dup) =>
            dup.id === duplicateFileId ? { ...dup, shouldReplace: !dup.shouldReplace } : dup
          ),
        };
      })
    );
  };

  // 切换显示重复文件列表
  const toggleShowDuplicates = (fileId: string) => {
    setFiles((prev) =>
      prev.map((f) => (f.id === fileId ? { ...f, showDuplicates: !f.showDuplicates } : f))
    );
  };

  // 完全移除文件
  const removeFile = (fileId: string) => {
    setFiles((prev) => prev.filter((f) => f.id !== fileId));
  };

  // 预览现有文件
  const handlePreviewExistingFile = (existingFile: ExistingFile) => {
    // 转换为 FileItem 格式供 FilePreviewDialog 使用
    const fileItem: FileItem = {
      id: existingFile.id,
      filename: existingFile.filename,
      originalname: existingFile.originalname,
      mimetype: existingFile.mimetype,
      size: existingFile.size,
      status: existingFile.status as any,
      upload_time: existingFile.upload_time,
      uploader_name: existingFile.uploader_name,
    };
    setPreviewFile(fileItem);
  };

  const handleUpload = async () => {
    if (files.length === 0) {
      toast.error(t("noFilesToUpload"));
      return;
    }

    setUploading(true);

    // Build per-file replace maps
    const replaceMap: { [filename: string]: string[] } = {};
    files.forEach((fileObj) => {
      const selectedDups = fileObj.duplicateFiles.filter((d) => d.shouldReplace);
      if (selectedDups.length > 0) {
        replaceMap[fileObj.file.name] = selectedDups.map((d) => d.id);
      }
    });

    const tagsString = selectedTags.length > 0 ? selectedTags.join(",") : "";

    // Update all files to uploading
    setFiles((prev) => prev.map((f) => ({ ...f, status: "uploading" as const, progress: 0 })));

    interface FileResult {
      id: string;
      filename: string;
      isReplacement: boolean;
    }

    const allFileResults: FileResult[] = [];
    let hasError = false;

    // Upload a single file: OSS upload + backend confirm
    const uploadSingleFile = async (fileObj: UploadFile) => {
      try {
        // Step 1: Upload to OSS with progress
        const objectKey = await uploadFile({
          file: fileObj.file,
          category: "knowledge",
          onProgress: (percent) => {
            setFiles((prev) =>
              prev.map((f) => (f.id === fileObj.id ? { ...f, progress: percent } : f))
            );
          },
        });

        // Step 2: Confirm with backend
        const fileReplaceMap: { [filename: string]: string[] } = {};
        if (replaceMap[fileObj.file.name]) {
          fileReplaceMap[fileObj.file.name] = replaceMap[fileObj.file.name];
        }

        const response = await axios.post("/api/knowledge/upload-confirm", {
          objectKey,
          originalFilename: fileObj.file.name,
          contentType: fileObj.file.type || "application/octet-stream",
          size: fileObj.file.size,
          datasetId,
          tags: tagsString,
          replaceMap: Object.keys(fileReplaceMap).length > 0 ? fileReplaceMap : undefined,
        });

        if (response.data.files) {
          allFileResults.push(...response.data.files);
        }

        // Mark this file as success
        setFiles((prev) =>
          prev.map((f) =>
            f.id === fileObj.id ? { ...f, status: "success" as const, progress: 100 } : f
          )
        );
      } catch (error: any) {
        console.error(`Upload failed (${fileObj.file.name}):`, error);
        hasError = true;

        // Mark this file as error
        setFiles((prev) =>
          prev.map((f) =>
            f.id === fileObj.id
              ? {
                  ...f,
                  status: "error" as const,
                  error: error.response?.data?.error || error.message || t("uploadFailed"),
                }
              : f
          )
        );
      }
    };

    // Upload files concurrently with a limit of 3
    const concurrencyLimit = 3;
    const queue = [...files];
    const executing: Promise<void>[] = [];

    while (queue.length > 0) {
      const fileObj = queue.shift()!;
      const task = uploadSingleFile(fileObj);
      executing.push(task);

      if (executing.length >= concurrencyLimit) {
        await Promise.race(executing);
        // Remove settled promises
        for (let i = executing.length - 1; i >= 0; i--) {
          const settled = await Promise.race([
            executing[i].then(() => true),
            Promise.resolve(false),
          ]);
          if (settled) executing.splice(i, 1);
        }
      }
    }

    // Wait for remaining uploads
    await Promise.allSettled(executing);

    // Show results
    if (allFileResults.length > 0) {
      const replacedCount = allFileResults.filter((f) => f.isReplacement).length;
      const newCount = allFileResults.length - replacedCount;

      let message = "";
      if (replacedCount > 0 && newCount > 0) {
        message = t("uploadSuccessNew", { count: newCount, replaced: replacedCount });
      } else if (replacedCount > 0) {
        message = t("uploadSuccessReplace", { count: replacedCount });
      } else {
        message = t("uploadSuccessCount", { count: newCount });
      }
      toast.success(message);

      // Auto-vectorize
      try {
        const fileIds = allFileResults.map((f) => f.id);
        if (fileIds.length > 0) {
          if (onAutoVectorize) {
            onAutoVectorize(fileIds);
            toast.info(t("autoSegmentStarted"));
          } else {
            await axios.post("/api/knowledge/vectorize-files-batch", {
              file_ids: fileIds,
              force: false,
            });
            toast.info(t("autoSegmentStarted"));
          }
        }
      } catch (e) {
        console.error("Auto-segment failed:", e);
        toast.error(t("autoSegmentFailed"));
      }

      if (!hasError) {
        // Delay close to let user see success state
        setTimeout(() => {
          onUploadSuccess();
          handleClose();
        }, 1000);
      } else {
        // Some files failed, still refresh to show successful uploads
        onUploadSuccess();
      }
    } else if (hasError) {
      // All files failed — status already set per-file
    }

    setUploading(false);
  };

  const handleClose = () => {
    if (!uploading) {
      setFiles([]);
      setSelectedTags([]);
      setPreviewFile(null);
      // 清空文件输入框
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
      onClose();
    }
  };

  const getFileIcon = (mimetype: string) => {
    if (mimetype.startsWith("image/")) return "🖼️";
    if (mimetype === "application/pdf") return "📄";
    if (mimetype.includes("word")) return "📝";
    if (mimetype.includes("excel") || mimetype.includes("spreadsheet")) return "📊";
    if (mimetype.startsWith("text/")) return "📄";
    return "📁";
  };

  const getStatusIcon = (status: UploadFile["status"]) => {
    switch (status) {
      case "pending":
        return <FileText className="h-4 w-4 text-muted-foreground" />;
      case "uploading":
        return (
          <div className="w-4 h-4 border-2 border-primary border-t-transparent rounded-full animate-spin" />
        );
      case "success":
        return <CheckCircle className="h-4 w-4 text-success" />;
      case "error":
        return <X className="h-4 w-4 text-destructive" />;
    }
  };

  // 计算要替换的现有文件数量
  const totalReplaceCount = files.reduce(
    (sum, f) => sum + f.duplicateFiles.filter((d) => d.shouldReplace).length,
    0
  );

  return (
    <>
      <Dialog.Root open={isOpen} onOpenChange={handleClose}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 bg-black/30 z-50" />
          <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-full max-w-2xl -translate-x-1/2 -translate-y-1/2 rounded-lg bg-card p-6 shadow-lg flex flex-col max-h-[80vh]">
            <Dialog.Title className="text-lg font-bold mb-4">
              {t("uploadFilesTitle")} {files.length > 0 && `(${files.length})`}
            </Dialog.Title>

            <div className="space-y-4 flex-1 overflow-y-auto">
              {/* 文件选择区域 */}
              <div>
                <Label htmlFor="file-upload">
                  {files.length > 0 ? t("continueAddFiles") : t("selectFiles")}
                </Label>
                <div className="mt-2">
                  <Input
                    id="file-upload"
                    type="file"
                    multiple
                    accept=".pdf,.doc,.docx,.xls,.xlsx,.txt,.md,.csv,image/*"
                    onChange={handleFileSelect}
                    ref={fileInputRef}
                    className="cursor-pointer"
                    disabled={uploading}
                  />
                  <p className="text-xs text-muted-foreground mt-1">
                    {t("supportedFormats")}
                    {files.length > 0 && t("canAddMoreFiles")}
                  </p>
                </div>
              </div>

              {/* 标签选择 */}
              <div>
                <TagSelect value={selectedTags} onChange={setSelectedTags} disabled={uploading} />
              </div>

              {/* 检查中提示 */}
              {checkingDuplicates && (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <div className="w-4 h-4 border-2 border-muted-foreground border-t-transparent rounded-full animate-spin" />
                  {t("checkingDuplicates")}
                </div>
              )}

              {/* 文件列表 */}
              {files.length > 0 && (
                <div>
                  <Label>{t("filesToUpload")}</Label>
                  <div className="mt-2 space-y-2 max-h-60 overflow-y-auto">
                    {files.map((fileObj) => (
                      <div
                        key={fileObj.id}
                        className={`border rounded-lg transition-all ${
                          fileObj.duplicateFiles.length > 0 ? "border-amber-300 bg-amber-50" : ""
                        }`}
                      >
                        {/* 文件主行 */}
                        <div className="flex items-center gap-3 p-3">
                          <span className="text-lg flex-shrink-0">
                            {getFileIcon(fileObj.file.type)}
                          </span>

                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium truncate">{fileObj.file.name}</p>
                            <div className="flex items-center gap-2">
                              <p className="text-xs text-muted-foreground">
                                {(fileObj.file.size / 1024 / 1024).toFixed(2)} MB
                              </p>

                              {/* 重复文件提示 */}
                              {fileObj.duplicateFiles.length > 0 && (
                                <button
                                  type="button"
                                  onClick={() => toggleShowDuplicates(fileObj.id)}
                                  className="flex items-center gap-1 text-xs text-amber-600 hover:text-amber-700"
                                >
                                  <AlertTriangle className="h-3 w-3" />
                                  <span>
                                    {t("foundDuplicateFiles", {
                                      count: fileObj.duplicateFiles.length,
                                    })}
                                  </span>
                                  {fileObj.showDuplicates ? (
                                    <ChevronDown className="h-3 w-3" />
                                  ) : (
                                    <ChevronRight className="h-3 w-3" />
                                  )}
                                </button>
                              )}
                            </div>

                            {fileObj.status === "uploading" && (
                              <div className="mt-1">
                                <div className="w-full bg-muted rounded-full h-2">
                                  <div
                                    className="bg-primary h-2 rounded-full transition-all duration-300"
                                    style={{ width: `${fileObj.progress}%` }}
                                  />
                                </div>
                                <p className="text-xs text-muted-foreground mt-1">
                                  {fileObj.progress}%
                                </p>
                              </div>
                            )}

                            {fileObj.status === "error" && fileObj.error && (
                              <p className="text-xs text-destructive mt-1">{fileObj.error}</p>
                            )}
                          </div>

                          <div className="flex items-center gap-2 flex-shrink-0">
                            {/* 显示替换数量 */}
                            {fileObj.duplicateFiles.length > 0 && (
                              <span className="text-xs text-amber-600">
                                {t("replaceCount", {
                                  selected: fileObj.duplicateFiles.filter((d) => d.shouldReplace)
                                    .length,
                                  total: fileObj.duplicateFiles.length,
                                })}
                              </span>
                            )}

                            {getStatusIcon(fileObj.status)}

                            {/* 彻底移除按钮 */}
                            {fileObj.status === "pending" && (
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => removeFile(fileObj.id)}
                                disabled={uploading}
                                className="h-8 w-8 p-0"
                                title={t("removeFile")}
                              >
                                <X className="h-4 w-4" />
                              </Button>
                            )}
                          </div>
                        </div>

                        {/* 重复文件列表（展开时显示） */}
                        {fileObj.showDuplicates && fileObj.duplicateFiles.length > 0 && (
                          <div className="px-3 pb-3 pt-0">
                            <div className="bg-card rounded border border-amber-200 divide-y divide-amber-100">
                              <div className="px-3 py-2 text-xs font-medium text-amber-700 bg-amber-100">
                                {t("duplicateReplaceHint")}
                              </div>
                              {fileObj.duplicateFiles.map((dupFile) => (
                                <div
                                  key={dupFile.id}
                                  className={`flex items-center gap-3 px-3 py-2 ${!dupFile.shouldReplace ? "opacity-50" : ""}`}
                                >
                                  <span className="text-sm">{getFileIcon(dupFile.mimetype)}</span>
                                  <div className="flex-1 min-w-0">
                                    <p
                                      className={`text-xs font-medium truncate ${dupFile.shouldReplace ? "line-through" : "text-muted-foreground"}`}
                                    >
                                      {dupFile.originalname}
                                    </p>
                                    <p className="text-xs text-muted-foreground">
                                      {(dupFile.size / 1024 / 1024).toFixed(2)} MB ·
                                      {dupFile.uploader_name && ` ${dupFile.uploader_name} · `}
                                      {new Date(dupFile.upload_time).toLocaleDateString("zh-CN")}
                                    </p>
                                  </div>
                                  <Button
                                    size="sm"
                                    variant="ghost"
                                    onClick={() => handlePreviewExistingFile(dupFile)}
                                    className="h-7 px-2 text-xs"
                                    title={t("previewFile")}
                                  >
                                    <Eye className="h-3 w-3 mr-1" />
                                    {t("previewFile")}
                                  </Button>
                                  {/* 勾选框 - 是否替换此文件 */}
                                  <Checkbox
                                    checked={dupFile.shouldReplace}
                                    onCheckedChange={() =>
                                      toggleDuplicateFileReplace(fileObj.id, dupFile.id)
                                    }
                                    disabled={uploading || fileObj.status !== "pending"}
                                    title={
                                      dupFile.shouldReplace
                                        ? t("cancelReplace")
                                        : t("confirmReplace")
                                    }
                                  />
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* 操作按钮 */}
            <div className="flex gap-2 justify-end mt-6 pt-4 border-t">
              <Button variant="outline" onClick={handleClose} disabled={uploading}>
                {tc("cancel")}
              </Button>
              <Button
                onClick={handleUpload}
                disabled={files.length === 0 || uploading || checkingDuplicates}
              >
                {uploading
                  ? t("uploadingFile")
                  : totalReplaceCount > 0
                    ? t("uploadFilesWithReplace", {
                        count: files.length,
                        replace: totalReplaceCount,
                      })
                    : t("uploadFilesButton", { count: files.length })}
              </Button>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>

      {/* 文件预览对话框 */}
      <FilePreviewDialog
        file={previewFile}
        open={!!previewFile}
        onOpenChange={(v) => !v && setPreviewFile(null)}
      />
    </>
  );
};
