"use client";

import { useState, useMemo, memo, useCallback } from "react";
import { useTranslations } from "next-intl";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Edit } from "lucide-react";
import { Segment } from "@/hooks/useSegmentManagement";
import { useVectorization } from "@/hooks/useVectorization";
import { toast } from "sonner";
import axios from "@/lib/axios";
import { MarkdownRenderer } from "@/components/MarkdownRenderer";
import { Virtuoso } from "react-virtuoso";

interface SegmentDetailProps {
  isOpen: boolean;
  onClose: () => void;
  fileName: string;
  fileId: string;
  segments: Segment[];
  loading: boolean;
  onUpdateSegment: (segmentId: number, segmentText: string) => void;
}

// Translation type for SegmentCard
interface SegmentCardTranslations {
  segmentContentEmpty: string;
  segmentUpdated: string;
  updateSegmentFailed: string;
  segmentPending: string;
  segmentProcessing: string;
  segmentIndexed: string;
  segmentFailed: string;
  processingIndicator: string;
  cancel: string;
  save: string;
  saving: string;
  editSegment: string;
  segmentPlaceholder: string;
}

// 分段卡片组件
interface SegmentCardProps {
  segment: Segment;
  fileId: string;
  onUpdate: (updatedSegment: Segment) => void;
  translations: SegmentCardTranslations;
}

const SegmentCard = memo(({ segment, fileId, onUpdate, translations: t }: SegmentCardProps) => {
  const [isEditing, setIsEditing] = useState(false);
  const [editText, setEditText] = useState(segment.segment_text);
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    if (!editText.trim()) {
      toast.error(t.segmentContentEmpty);
      return;
    }

    try {
      setSaving(true);
      const response = await axios.put("/api/knowledge/segments/update", {
        segment_id: segment.id,
        segment_text: editText,
      });

      if (response.data.success) {
        onUpdate(response.data.segment);
        setIsEditing(false);
        toast.success(t.segmentUpdated);
      }
    } catch (error: any) {
      console.error("Update segment failed:", error);
      toast.error(t.updateSegmentFailed);
    } finally {
      setSaving(false);
    }
  };

  const handleCancel = () => {
    setEditText(segment.segment_text);
    setIsEditing(false);
  };

  return (
    <div className="border rounded p-6 bg-muted">
      <div className="flex items-center justify-between mb-2">
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-1">
            {segment.status === "indexed" && segment.segment_index !== undefined && (
              <span className="text-xs text-muted-foreground">#{segment.segment_index}</span>
            )}
            <Badge
              className={
                segment.status === "pending"
                  ? "bg-warning/10 text-warning"
                  : segment.status === "processing"
                    ? "bg-info/10 text-info"
                    : segment.status === "indexed"
                      ? "bg-success/10 text-success"
                      : "bg-destructive/10 text-destructive"
              }
            >
              {segment.status === "pending"
                ? t.segmentPending
                : segment.status === "processing"
                  ? t.segmentProcessing
                  : segment.status === "indexed"
                    ? t.segmentIndexed
                    : t.segmentFailed}
            </Badge>
          </div>
          {segment.status === "processing" && (
            <div className="flex items-center gap-2 text-xs text-primary">
              <div className="w-16 bg-primary/20 rounded-full h-1.5">
                <div
                  className="bg-primary h-1.5 rounded-full transition-all duration-300"
                  style={{ width: "100%" }}
                ></div>
              </div>
              <span>{t.processingIndicator}</span>
            </div>
          )}
        </div>

        <div className="flex gap-2">
          {isEditing ? (
            <>
              <Button size="sm" variant="outline" onClick={handleCancel} disabled={saving}>
                {t.cancel}
              </Button>
              <Button size="sm" onClick={handleSave} disabled={saving}>
                {saving ? t.saving : t.save}
              </Button>
            </>
          ) : (
            <Button
              size="sm"
              variant="outline"
              onClick={() => setIsEditing(true)}
              disabled={segment.status === "processing"}
            >
              <Edit className="h-4 w-4 mr-1" />
              {t.editSegment}
            </Button>
          )}
        </div>
      </div>

      {isEditing ? (
        <Textarea
          value={editText}
          onChange={(e) => setEditText(e.target.value)}
          className="min-h-[100px] text-sm"
          placeholder={t.segmentPlaceholder}
        />
      ) : (
        <div className="text-sm text-foreground leading-relaxed break-words">
          <MarkdownRenderer content={segment.segment_text} />
        </div>
      )}
    </div>
  );
});

SegmentCard.displayName = "SegmentCard";

export const SegmentDetail = ({
  isOpen,
  onClose,
  fileName,
  fileId,
  segments,
  loading,
  onUpdateSegment,
}: SegmentDetailProps) => {
  const t = useTranslations("knowledge");
  const tc = useTranslations("common");
  const { isFileProcessing, getFileProgress } = useVectorization();

  // Memoize translations for SegmentCard
  const segmentCardTranslations = useMemo<SegmentCardTranslations>(
    () => ({
      segmentContentEmpty: t("segmentContentEmpty"),
      segmentUpdated: t("segmentUpdated"),
      updateSegmentFailed: t("updateSegmentFailed"),
      segmentPending: t("segmentPending"),
      segmentProcessing: t("segmentProcessing"),
      segmentIndexed: t("segmentIndexed"),
      segmentFailed: t("segmentFailed"),
      processingIndicator: t("processingIndicator"),
      cancel: tc("cancel"),
      save: tc("save"),
      saving: t("saving"),
      editSegment: t("editSegment"),
      segmentPlaceholder: t("segmentPlaceholder"),
    }),
    [t, tc]
  );

  // 使用 useMemo 缓存统计数据计算
  const stats = useMemo(
    () => ({
      total: segments.length,
      pending: segments.filter((s) => s.status === "pending").length,
      processing: segments.filter((s) => s.status === "processing").length,
      indexed: segments.filter((s) => s.status === "indexed").length,
      failed: segments.filter((s) => s.status === "failed").length,
    }),
    [segments]
  );

  // 使用 useMemo 缓存过滤后的分段数据
  const filteredSegments = useMemo(
    () => segments.filter((segment) => segment && segment.id),
    [segments]
  );

  // 使用 useCallback 缓存更新回调
  const handleUpdateSegment = useCallback(
    (segmentId: number, segmentText: string) => {
      onUpdateSegment(segmentId, segmentText);
    },
    [onUpdateSegment]
  );

  const isProcessing = isFileProcessing(fileId);
  const progress = getFileProgress(fileId);

  return (
    <Sheet open={isOpen} onOpenChange={onClose}>
      <SheetContent className="w-[900px] max-w-[900px] sm:max-w-[900px] flex flex-col">
        <SheetHeader className="flex-shrink-0">
          <div className="flex items-center gap-2">
            <SheetTitle>
              {t("segmentDetail")} - {fileName}
            </SheetTitle>
          </div>
          {isProcessing && (
            <div className="flex items-center gap-2 text-sm text-primary mt-2">
              <span>{t("fileProgress")}：</span>
              <div className="w-32 bg-primary/20 rounded-full h-2">
                <div
                  className="bg-primary h-2 rounded-full transition-all duration-300"
                  style={{ width: `${progress}%` }}
                ></div>
              </div>
              <span>{progress}%</span>
            </div>
          )}
        </SheetHeader>

        <div className="flex-1 flex flex-col mt-6 min-h-0">
          {/* 分段统计信息 */}
          {segments.length > 0 && (
            <div className="bg-muted rounded-lg p-4 mb-4 flex-shrink-0">
              <div className="flex items-center justify-between text-sm text-muted-foreground">
                <span>{t("segmentStats")}：</span>
                <div className="flex items-center gap-4">
                  <span>
                    {t("total")}：{stats.total}
                  </span>
                  <span className="text-warning">
                    {t("pendingStatus")}：{stats.pending}
                  </span>
                  <span className="text-info">
                    {t("processingStatus")}：{stats.processing}
                  </span>
                  <span className="text-success">
                    {t("completedStatus")}：{stats.indexed}
                  </span>
                  <span className="text-destructive">
                    {t("failedStatus")}：{stats.failed}
                  </span>
                </div>
              </div>
              {isProcessing && (
                <div className="mt-2">
                  <div className="flex items-center gap-2 text-sm text-primary">
                    <span>{t("fileProgress")}：</span>
                    <div className="flex-1 bg-primary/20 rounded-full h-2">
                      <div
                        className="bg-primary h-2 rounded-full transition-all duration-300"
                        style={{ width: `${progress}%` }}
                      ></div>
                    </div>
                    <span>{progress}%</span>
                  </div>
                </div>
              )}
            </div>
          )}

          {loading ? (
            <div className="flex items-center justify-center py-8">
              <div className="flex items-center gap-2">
                <div className="w-4 h-4 border border-border border-t-primary rounded-full animate-spin"></div>
                <span className="text-muted-foreground">{t("loadingSegments")}</span>
              </div>
            </div>
          ) : segments.length === 0 ? (
            <div className="flex items-center justify-center py-8">
              <div className="text-muted-foreground">{t("noSegmentData")}</div>
            </div>
          ) : (
            <Virtuoso
              className="flex-1"
              data={filteredSegments}
              itemContent={(index, segment) => (
                <div className="pb-4 pr-2">
                  <SegmentCard
                    segment={segment}
                    fileId={fileId}
                    onUpdate={(updatedSegment) => {
                      handleUpdateSegment(segment.id, updatedSegment.segment_text);
                    }}
                    translations={segmentCardTranslations}
                  />
                </div>
              )}
              overscan={200}
            />
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
};
