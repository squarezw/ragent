"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { FileItem } from "@/hooks/useFileManagement";
import { useVectorization } from "@/hooks/useVectorization";
import { Download, Edit, Eye, Rocket, Trash2 } from "lucide-react";

interface FileListProps {
  files: FileItem[];
  selectedFileIds: Set<string>;
  onSelectFile: (fileId: string, checked: boolean) => void;
  onSelectAll: (checked: boolean) => void;
  onShowSegments: (file: FileItem) => void;
  onEditFile: (file: FileItem) => void;
  onDeleteFile: (fileId: string) => void;
  onVectorizeFile: (fileId: string) => void;
  onPreviewFile: (file: FileItem) => void;
  onDownloadFile: (file: FileItem) => void;
  loading?: boolean;
  downloadingFileId?: string | null;
  canModifyFile?: (file: FileItem) => boolean;
  canDeleteFile?: (file: FileItem) => boolean;
}

// 格式化文件大小的工具函数
const formatFileSize = (bytes: number): string => {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${Math.floor(bytes / k ** i)} ${sizes[i]}`;
};

export const FileList = ({
  files,
  selectedFileIds,
  onSelectFile,
  onSelectAll,
  onShowSegments,
  onEditFile,
  onDeleteFile,
  onVectorizeFile,
  onPreviewFile,
  onDownloadFile,
  loading = false,
  downloadingFileId = null,
  canModifyFile,
  canDeleteFile,
}: FileListProps) => {
  const t = useTranslations("knowledge");
  const tc = useTranslations("common");
  const { isFileClicked, getFileProgress } = useVectorization();
  const [expandedSummaryIds, setExpandedSummaryIds] = useState<Set<string>>(new Set());

  const toggleSummary = (id: string) => {
    setExpandedSummaryIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  // Format upload time with translations
  const formatUploadTimeTranslated = (dateString: string) => {
    const date = new Date(dateString);
    const now = new Date();
    const diffInMs = now.getTime() - date.getTime();
    const diffInMinutes = Math.floor(diffInMs / (1000 * 60));
    const diffInHours = Math.floor(diffInMs / (1000 * 60 * 60));
    const diffInDays = Math.floor(diffInMs / (1000 * 60 * 60 * 24));

    if (diffInMinutes < 1) return t("justNow");
    if (diffInMinutes < 60) return t("minutesAgo", { minutes: diffInMinutes });
    if (diffInHours < 24) return t("hoursAgo", { hours: diffInHours });
    if (diffInDays < 7) return t("daysAgo", { days: diffInDays });

    const weeks = Math.floor(diffInDays / 7);
    if (weeks < 4) return t("weeksAgo", { weeks });

    return date.toLocaleDateString();
  };

  // Format file type with translations
  const formatFileTypeTranslated = (mimeType: string, fileName: string) => {
    const mime = mimeType.toLowerCase();
    const extension = fileName?.split(".").pop()?.toLowerCase();

    if (mime.includes("pdf")) return "PDF";
    if (
      mime.includes("word") ||
      mime.includes("document") ||
      extension === "doc" ||
      extension === "docx"
    )
      return "Word";
    if (
      mime.includes("excel") ||
      mime.includes("spreadsheet") ||
      extension === "xls" ||
      extension === "xlsx"
    )
      return "Excel";
    if (mime.includes("csv") || extension === "csv") return "CSV";
    if (mime.includes("markdown") || extension === "md") return "MD";
    if (mime.includes("text/plain") || extension === "txt") return "TXT";
    if (mime.includes("image/")) return t("image");
    if (extension === "ppt" || extension === "pptx") return "PPT";
    if (extension === "zip" || extension === "rar") return t("archive");
    if (extension === "json") return "JSON";
    if (extension === "xml") return "XML";
    if (extension === "html" || extension === "htm") return "HTML";
    if (extension === "css") return "CSS";
    if (extension === "js") return "JS";

    return extension?.toUpperCase() || t("file");
  };

  const isAllSelected = files.length > 0 && selectedFileIds.size === files.length;
  const isIndeterminate = selectedFileIds.size > 0 && selectedFileIds.size < files.length;

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="flex items-center gap-2">
          <div className="w-4 h-4 border border-border border-t-blue-500 rounded-full animate-spin" />
          <span className="text-muted-foreground">{tc("loading")}</span>
        </div>
      </div>
    );
  }

  if (files.length === 0) {
    return (
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-12">
              <Checkbox
                checked={isAllSelected}
                ref={(el) => {
                  if (el) {
                    (el as HTMLInputElement).indeterminate = isIndeterminate;
                  }
                }}
                onCheckedChange={onSelectAll}
              />
            </TableHead>
            <TableHead>{t("docName")}</TableHead>
            <TableHead>{t("tags")}</TableHead>
            <TableHead>{t("type")}</TableHead>
            <TableHead>{t("size")}</TableHead>
            <TableHead className="w-20">{t("uploader")}</TableHead>
            <TableHead className="w-24">{t("uploadTime")}</TableHead>
            <TableHead>{t("status")}</TableHead>
            <TableHead>{t("operation")}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          <TableRow>
            <TableCell colSpan={9} className="text-center py-12">
              <div className="flex flex-col items-center gap-4">
                <div className="text-muted-foreground text-lg">{t("noFilesYet")}</div>
                <div className="text-sm text-muted-foreground">{t("startUploadFirst")}</div>
              </div>
            </TableCell>
          </TableRow>
        </TableBody>
      </Table>
    );
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead className="w-12">
            <Checkbox
              checked={isAllSelected}
              ref={(el) => {
                if (el) {
                  (el as HTMLInputElement).indeterminate = isIndeterminate;
                }
              }}
              onCheckedChange={onSelectAll}
            />
          </TableHead>
          <TableHead>{t("docName")}</TableHead>
          <TableHead>{t("tags")}</TableHead>
          <TableHead>{t("type")}</TableHead>
          <TableHead>{t("size")}</TableHead>
          <TableHead className="w-20">{t("uploader")}</TableHead>
          <TableHead className="w-24">{t("uploadTime")}</TableHead>
          <TableHead>{t("status")}</TableHead>
          <TableHead>{t("operation")}</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {files.map((file) => {
          const isClicked = isFileClicked(file.id);
          const progress = getFileProgress(file.id);

          return (
            <TableRow key={file.id} className="group">
              <TableCell>
                <Checkbox
                  checked={selectedFileIds.has(file.id)}
                  onCheckedChange={(checked) => onSelectFile(file.id, checked as boolean)}
                />
              </TableCell>
              <TableCell style={{ maxWidth: "28rem" }}>
                <div className="flex items-center gap-2">
                  <span className="font-medium truncate">{file.originalname}</span>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => onPreviewFile(file)}
                    className="h-6 w-6 p-0 opacity-0 group-hover:opacity-100 transition-opacity duration-200 shrink-0"
                    title={t("viewOriginal")}
                  >
                    <Eye className="h-3 w-3" />
                  </Button>
                </div>
                {file.summary && (
                  <div
                    className="text-xs text-muted-foreground mt-0.5 cursor-pointer hover:text-foreground/70 transition-colors"
                    style={
                      expandedSummaryIds.has(file.id)
                        ? { whiteSpace: "pre-wrap", wordBreak: "break-word" }
                        : {
                            whiteSpace: "nowrap",
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                          }
                    }
                    onClick={() => toggleSummary(file.id)}
                    title={expandedSummaryIds.has(file.id) ? "收起" : "展开"}
                  >
                    {file.summary}
                  </div>
                )}
              </TableCell>
              <TableCell>
                {file.tags && file.tags.length > 0 ? (
                  <div className="flex flex-wrap gap-1">
                    {file.tags.map((tag) => (
                      <Badge
                        key={tag.id}
                        className="text-xs bg-muted text-muted-foreground border border-gray-200"
                      >
                        {tag.name}
                      </Badge>
                    ))}
                  </div>
                ) : (
                  <span className="text-gray-400">-</span>
                )}
              </TableCell>
              <TableCell className="text-sm text-muted-foreground font-medium">
                {formatFileTypeTranslated(file.mimetype, file.filename)}
              </TableCell>
              <TableCell>{formatFileSize(Number(file.size))}</TableCell>
              <TableCell className="text-sm text-muted-foreground font-medium">
                {file.uploader_name || "-"}
              </TableCell>
              <TableCell className="text-sm text-muted-foreground">
                {file.upload_time ? formatUploadTimeTranslated(file.upload_time) : "-"}
              </TableCell>
              <TableCell>
                <div className="flex flex-col gap-1">
                  <Badge
                    className={
                      file.status === "pending"
                        ? "bg-warning/10 text-warning"
                        : file.status === "processing"
                          ? "bg-info/10 text-info"
                          : file.status === "indexed"
                            ? "bg-success/10 text-success"
                            : "bg-destructive/10 text-destructive"
                    }
                  >
                    {file.status === "pending"
                      ? t("pending")
                      : file.status === "processing"
                        ? t("processing")
                        : file.status === "indexed"
                          ? t("completed")
                          : t("failed")}
                  </Badge>
                  {file.status === "processing" && (
                    <div className="flex flex-col gap-1 text-xs text-primary">
                      <div className="flex items-center gap-2">
                        <div className="w-16 bg-primary/20 rounded-full h-1.5">
                          <div
                            className="bg-primary h-1.5 rounded-full transition-all duration-300"
                            style={{ width: `${progress}%` }}
                          />
                        </div>
                        <span>{progress}%</span>
                      </div>
                    </div>
                  )}
                </div>
              </TableCell>
              <TableCell>
                <div className="flex items-center gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => onShowSegments(file)}
                    disabled={file.status === "pending"}
                    title={t("segments")}
                  >
                    <Eye className="h-4 w-4" />
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => onDownloadFile(file)}
                    disabled={downloadingFileId === file.id}
                    title={t("download")}
                  >
                    {downloadingFileId === file.id ? (
                      <div className="flex items-center gap-1">
                        <div className="w-3 h-3 border border-border border-t-primary rounded-full animate-spin" />
                      </div>
                    ) : (
                      <Download className="h-4 w-4" />
                    )}
                  </Button>
                  {canModifyFile?.(file) && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => onEditFile(file)}
                      title={tc("edit")}
                    >
                      <Edit className="h-4 w-4" />
                    </Button>
                  )}
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => onVectorizeFile(file.id)}
                    disabled={isClicked}
                    title={t("reprocess")}
                  >
                    {isClicked ? (
                      <div className="flex items-center gap-1">
                        <div className="w-3 h-3 border border-border border-t-primary rounded-full animate-spin" />
                      </div>
                    ) : (
                      <Rocket className="h-4 w-4" />
                    )}
                  </Button>
                  {canDeleteFile?.(file) && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => onDeleteFile(file.id)}
                      className="text-destructive border-destructive/30 hover:bg-destructive/5"
                      title={t("delete")}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  )}
                </div>
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
};
