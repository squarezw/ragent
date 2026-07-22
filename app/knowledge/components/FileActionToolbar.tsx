"use client";

import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Rocket, Tag, Trash2 } from "lucide-react";
import { useVectorization } from "@/hooks/useVectorization";

interface FileActionToolbarProps {
  selectedFileIds: Set<string>;
  files: Array<{ id: string; status: string }>;
  onBatchVectorize: () => void;
  onBatchTag: () => void;
  onBatchDelete: () => void;
  onClearSelection: () => void;
  batchDeleting?: boolean;
}

export const FileActionToolbar = ({
  selectedFileIds,
  files,
  onBatchVectorize,
  onBatchTag,
  onBatchDelete,
  onClearSelection,
  batchDeleting = false,
}: FileActionToolbarProps) => {
  const t = useTranslations("knowledge");
  const { isFileProcessing, isFileClicked, getFileProgress } = useVectorization();

  if (selectedFileIds.size === 0) {
    return null;
  }

  const selectedFiles = files.filter((file) => selectedFileIds.has(file.id));
  const processingFiles = selectedFiles.filter(
    (file) => isFileProcessing(file.id) || isFileClicked(file.id)
  );

  // 计算平均进度
  const avgProgress =
    processingFiles.length > 0
      ? Math.round(
          processingFiles.reduce((sum, file) => sum + getFileProgress(file.id), 0) /
            processingFiles.length
        )
      : 0;

  return (
    <div className="flex items-center gap-4 mb-4 p-3 bg-primary/5 rounded-lg border">
      <span className="text-sm text-primary">
        {t("selectedFiles", { count: selectedFileIds.size })}
      </span>

      <Button
        size="sm"
        variant="outline"
        onClick={onBatchVectorize}
        disabled={processingFiles.length > 0 || batchDeleting}
      >
        <Rocket className="h-4 w-4 mr-1" />
        {t("segment")}
      </Button>

      <Button size="sm" variant="outline" onClick={onBatchTag} disabled={batchDeleting}>
        <Tag className="h-4 w-4 mr-1" />
        {t("addTags")}
      </Button>

      {processingFiles.length > 0 && (
        <div className="flex items-center gap-2 text-sm text-primary">
          <span>{t("fileProcessing")}</span>
          <div className="flex items-center gap-2">
            <span>({avgProgress}%)</span>
            <div className="w-20 bg-primary/20 rounded-full h-1.5">
              <div
                className="bg-primary h-1.5 rounded-full transition-all duration-300"
                style={{ width: `${avgProgress}%` }}
              ></div>
            </div>
          </div>
        </div>
      )}

      <Button
        size="sm"
        variant="outline"
        onClick={onBatchDelete}
        disabled={batchDeleting}
        className="text-destructive border-destructive/30 hover:bg-destructive/5"
      >
        <Trash2 className="h-4 w-4 mr-1" />
        {batchDeleting ? t("deleting") : t("deleteAction")}
      </Button>

      <Button size="sm" variant="ghost" onClick={onClearSelection} disabled={batchDeleting}>
        {t("cancelSelection")}
      </Button>
    </div>
  );
};
