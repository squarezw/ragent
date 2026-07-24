"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Loader2 } from "lucide-react";

interface ReviewRejectDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** 被驳回对象的名称（对话框描述用） */
  targetName: string;
  /** 确认驳回；理由必填（契约：reject 时 comment 必填） */
  onConfirm: (comment: string) => Promise<boolean>;
}

/** 驳回弹窗：理由必填，skills / apps 审核共用 */
export default function ReviewRejectDialog({
  open,
  onOpenChange,
  targetName,
  onConfirm,
}: ReviewRejectDialogProps) {
  const t = useTranslations("reviews");
  const tc = useTranslations("common");
  const [comment, setComment] = useState("");
  const [submitting, setSubmitting] = useState(false);

  // 每次打开清空上次的理由
  useEffect(() => {
    if (open) setComment("");
  }, [open]);

  const handleConfirm = async () => {
    if (!comment.trim()) return;
    setSubmitting(true);
    const ok = await onConfirm(comment.trim());
    setSubmitting(false);
    if (ok) onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !submitting && onOpenChange(v)}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t("rejectTitle")}</DialogTitle>
          <DialogDescription>{t("rejectDesc", { name: targetName })}</DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <Label htmlFor="reject-comment">{t("rejectReason")} *</Label>
          <Textarea
            id="reject-comment"
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            placeholder={t("rejectReasonPlaceholder")}
            rows={4}
          />
          <p className="text-xs text-muted-foreground">{t("rejectReasonRequired")}</p>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
            {tc("cancel")}
          </Button>
          <Button
            variant="destructive"
            onClick={handleConfirm}
            disabled={submitting || !comment.trim()}
          >
            {submitting && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            {t("reject")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
