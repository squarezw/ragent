"use client";

import { useState, useEffect, useRef } from "react";
import { useTranslations } from "next-intl";
import * as Dialog from "@radix-ui/react-dialog";
import { Button } from "@/components/ui/button";
import TagSelect from "@/components/TagSelect";
import { FileItem } from "@/hooks/useFileManagement";
import { Upload, X, FileText } from "lucide-react";
import { toast } from "sonner";
import axios from "@/lib/axios";
import { uploadFile } from "@/lib/ossUpload";

interface FileEditDialogProps {
  isOpen: boolean;
  onClose: () => void;
  file: FileItem | null;
  onSave: (
    fileId: string,
    updates: { originalname: string; tags: number[]; summary?: string }
  ) => void;
  onFileReplace?: (fileId: string) => void; // 文件替换成功后的回调
}

export const FileEditDialog = ({
  isOpen,
  onClose,
  file,
  onSave,
  onFileReplace,
}: FileEditDialogProps) => {
  const t = useTranslations("knowledge");
  const tc = useTranslations("common");
  const [fileName, setFileName] = useState("");
  const [selectedTags, setSelectedTags] = useState<number[]>([]);
  const [summary, setSummary] = useState("");
  const [saving, setSaving] = useState(false);
  const [newFile, setNewFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (file) {
      setFileName(file.originalname);
      setSelectedTags(file.tags?.map((tag) => tag.id) || []);
      setSummary(file.summary ?? "");
    }
    // 重置文件上传状态
    setNewFile(null);
    setUploading(false);
    setUploadProgress(0);
  }, [file, isOpen]);

  // 处理文件选择
  const handleFileSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = event.target.files?.[0];
    if (selectedFile) {
      setNewFile(selectedFile);
      // 如果用户选择了新文件，自动更新文件名
      if (!fileName.trim() || fileName === file?.originalname) {
        setFileName(selectedFile.name);
      }
    }
    // 清空文件输入框，允许重复选择相同文件
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  // 移除选择的文件
  const removeSelectedFile = () => {
    setNewFile(null);
  };

  // 处理文件替换
  const handleFileReplace = async () => {
    if (!file || !newFile) return;

    setUploading(true);
    setUploadProgress(0);

    try {
      // Step 1: Upload to OSS
      const objectKey = await uploadFile({
        file: newFile,
        category: "knowledge",
        onProgress: (percent) => setUploadProgress(percent),
      });

      // Step 2: Confirm replace with backend
      const response = await axios.post("/api/knowledge/replace", {
        objectKey,
        fileId: file.id,
        originalFilename: newFile.name,
        contentType: newFile.type || "application/octet-stream",
        size: newFile.size,
      });

      if (response.data.success) {
        toast.success(t("fileReplaceSuccess"));
        setNewFile(null);
        setUploadProgress(0);
        await onSave(file.id, {
          originalname: fileName.trim(),
          tags: selectedTags,
          summary,
        });
        if (onFileReplace) {
          onFileReplace(file.id);
        }
        onClose();
      }
    } catch (error: any) {
      console.error("File replacement failed:", error);
      toast.error(t("fileReplaceFailed"));
    } finally {
      setUploading(false);
    }
  };

  const handleSave = async () => {
    if (!file || !fileName.trim()) return;

    // 如果有新文件，先进行文件替换
    if (newFile) {
      await handleFileReplace();
      return;
    }

    setSaving(true);
    try {
      await onSave(file.id, {
        originalname: fileName.trim(),
        tags: selectedTags,
        summary,
      });
      onClose();
    } finally {
      setSaving(false);
    }
  };

  const handleClose = () => {
    if (!saving && !uploading) {
      onClose();
    }
  };

  return (
    <Dialog.Root open={isOpen} onOpenChange={handleClose}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/30 z-50" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-full max-w-2xl -translate-x-1/2 -translate-y-1/2 rounded-lg bg-card p-6 shadow-lg flex flex-col gap-4">
          <Dialog.Title className="text-lg font-bold">{t("editFile")}</Dialog.Title>

          <div className="space-y-4">
            <div>
              <label className="text-sm font-medium">{t("fileNameLabel")}</label>
              <input
                className="w-full border border-border rounded px-3 py-2 mt-1 bg-background text-foreground"
                value={fileName}
                onChange={(e) => setFileName(e.target.value)}
                placeholder={t("fileNamePlaceholder")}
                disabled={saving || uploading}
              />
            </div>

            {/* 文件替换区域 */}
            <div>
              <label className="text-sm font-medium">{t("replaceFile")}</label>
              <div className="mt-1">
                {!newFile ? (
                  <div className="border-2 border-dashed border rounded-lg p-6 text-center hover:border-muted-foreground/50 transition-colors">
                    <input
                      type="file"
                      ref={fileInputRef}
                      onChange={handleFileSelect}
                      accept=".pdf,.doc,.docx,.xls,.xlsx,.txt,.md,.csv,image/*"
                      className="hidden"
                      disabled={saving || uploading}
                    />
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => fileInputRef.current?.click()}
                      disabled={saving || uploading}
                      className="mb-2"
                    >
                      <Upload className="h-4 w-4 mr-2" />
                      {t("selectNewFile")}
                    </Button>
                    <p className="text-sm text-muted-foreground">{t("selectFileToReplace")}</p>
                  </div>
                ) : (
                  <div className="border rounded-lg p-3 bg-muted">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center space-x-2">
                        <FileText className="h-4 w-4 text-muted-foreground" />
                        <span className="text-sm font-medium">{newFile.name}</span>
                        <span className="text-xs text-muted-foreground">
                          ({(newFile.size / 1024 / 1024).toFixed(2)} MB)
                        </span>
                      </div>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={removeSelectedFile}
                        disabled={saving || uploading}
                      >
                        <X className="h-4 w-4" />
                      </Button>
                    </div>

                    {uploading && (
                      <div className="mt-2">
                        <div className="flex justify-between text-sm text-muted-foreground mb-1">
                          <span>{t("uploadingProgress")}</span>
                          <span>{uploadProgress}%</span>
                        </div>
                        <div className="w-full bg-muted rounded-full h-2">
                          <div
                            className="bg-primary h-2 rounded-full transition-all duration-300"
                            style={{ width: `${uploadProgress}%` }}
                          ></div>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
              <p className="text-xs text-muted-foreground mt-1">{t("replaceFileHelp")}</p>
            </div>

            <div>
              <TagSelect
                value={selectedTags}
                onChange={setSelectedTags}
                disabled={saving || uploading}
              />
            </div>

            <div>
              <label className="text-sm font-medium">摘要</label>
              <textarea
                className="w-full border border-border rounded px-3 py-2 mt-1 bg-background text-foreground text-sm"
                value={summary}
                onChange={(e) => setSummary(e.target.value)}
                placeholder="文件摘要，可留空"
                rows={4}
                disabled={saving || uploading}
              />
              <p className="text-xs text-muted-foreground mt-1">
                列表中将以小字显示摘要首行，点击展开查看全文。
              </p>
            </div>
          </div>

          <div className="flex gap-2 justify-end">
            <Button variant="outline" onClick={handleClose} disabled={saving || uploading}>
              {tc("cancel")}
            </Button>
            <Button onClick={handleSave} disabled={saving || uploading || !fileName.trim()}>
              {saving
                ? t("saving")
                : uploading
                  ? t("uploadingFile")
                  : newFile
                    ? t("replaceAction")
                    : tc("save")}
            </Button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
};
