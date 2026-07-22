"use client";

import { useTranslations } from "next-intl";
import { Rocket } from "lucide-react";
import { Tag } from "@/hooks/useTagManagement";

interface FileFilterProps {
  availableTags: Tag[];
  selectedTagId: string;
  selectedStatus: string;
  totalUnsegmentedCount: number;
  totalFiles: number;
  tagsLoading: boolean;
  vectorizingAll?: boolean;
  onTagFilter: (tagId: string) => void;
  onStatusFilter: (status: string) => void;
  onVectorizeAllUnsegmented: () => void;
}

export const FileFilter = ({
  availableTags,
  selectedTagId,
  selectedStatus,
  totalUnsegmentedCount,
  totalFiles,
  tagsLoading,
  vectorizingAll = false,
  onTagFilter,
  onStatusFilter,
  onVectorizeAllUnsegmented,
}: FileFilterProps) => {
  const t = useTranslations("knowledge");
  const showUnsegmentedFilter = totalFiles > 0 || selectedStatus === "unsegmented";
  const showSegmentAllButton = selectedStatus === "unsegmented" && totalUnsegmentedCount > 0;

  return (
    <div className="flex items-start justify-between gap-8">
      {/* 左侧：标签和状态筛选 */}
      <div className="flex-1">
        <div className="flex items-center gap-2 mb-2">
          {tagsLoading && (
            <div className="flex items-center gap-1 text-sm text-muted-foreground">
              <div className="w-3 h-3 border border-border border-t-primary rounded-full animate-spin"></div>
              <span>{t("loadingTags")}</span>
            </div>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => onTagFilter("all")}
            className={`px-3 py-1 rounded-full text-sm font-medium transition-colors ${
              selectedTagId === "all"
                ? "bg-primary/10 text-primary border border-primary/30"
                : "bg-muted text-muted-foreground border border-border hover:bg-muted/80"
            }`}
          >
            {t("allFiles")} ({totalFiles})
          </button>
          {availableTags.length > 0 ? (
            availableTags.map((tag) => (
              <button
                key={tag.id}
                type="button"
                onClick={() => onTagFilter(tag.id.toString())}
                className={`px-3 py-1 rounded-full text-sm font-medium transition-colors border ${
                  selectedTagId === tag.id.toString()
                    ? "text-white"
                    : "bg-muted text-muted-foreground hover:bg-muted/80"
                }`}
                style={{
                  backgroundColor: selectedTagId === tag.id.toString() ? tag.color : undefined,
                  color: selectedTagId === tag.id.toString() ? "white" : undefined,
                  borderColor: selectedTagId === tag.id.toString() ? tag.color : undefined,
                }}
              >
                {tag.name} ({tag.file_count})
              </button>
            ))
          ) : (
            <div className="text-sm text-muted-foreground px-3 py-1">{t("noTagsInDataset")}</div>
          )}
        </div>
      </div>

      {/* 右侧：文件数量和未分段统计 */}
      <div className="flex-shrink-0">
        <div className="flex items-center gap-3">
          <div className="flex flex-col items-end gap-2">
            <span className="text-sm text-muted-foreground">
              {t("fileCount")}：{totalFiles}
            </span>
            {showUnsegmentedFilter && (
              <>
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => onStatusFilter("unsegmented")}
                    className={`text-xs transition-colors ${
                      selectedStatus === "unsegmented"
                        ? "text-primary font-medium"
                        : "text-muted-foreground hover:text-primary"
                    }`}
                  >
                    {t("unsegmentedCount", { count: totalUnsegmentedCount })}
                  </button>
                  {selectedStatus === "unsegmented" && (
                    <button
                      type="button"
                      onClick={() => onStatusFilter("all")}
                      className="text-xs text-muted-foreground hover:text-foreground transition-colors ml-1"
                      title={t("clearFilter")}
                    >
                      ×
                    </button>
                  )}
                </div>
                {showSegmentAllButton && (
                  <button
                    type="button"
                    onClick={onVectorizeAllUnsegmented}
                    disabled={vectorizingAll || totalUnsegmentedCount === 0}
                    className="inline-flex h-7 items-center gap-1.5 rounded-md border border-primary/30 px-3 text-xs font-medium text-primary transition-colors hover:bg-primary/5 disabled:cursor-not-allowed disabled:border-border disabled:bg-muted/30 disabled:text-muted-foreground"
                  >
                    <Rocket className="h-3 w-3" />
                    {vectorizingAll ? t("segmentAllSubmitting") : t("segmentAll")}
                  </button>
                )}
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
