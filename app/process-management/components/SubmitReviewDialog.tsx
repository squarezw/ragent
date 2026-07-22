"use client";

import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { submitDocumentReview, prepareReview } from "../services/api";

interface SubmitReviewDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  docId: string | null;
  docName: string;
  initialDocNumber: string;
  onSuccess: () => void;
}

export default function SubmitReviewDialog({
  open,
  onOpenChange,
  docId,
  docName,
  initialDocNumber,
  onSuccess,
}: SubmitReviewDialogProps) {
  const t = useTranslations("processManagement");

  const [updateDescription, setUpdateDescription] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [descriptionError, setDescriptionError] = useState(false);
  const [loadingSummaries, setLoadingSummaries] = useState(false);

  // Reset form and load AI-suggested change summary when dialog opens
  useEffect(() => {
    if (!open) return;

    setUpdateDescription("");
    setDescriptionError(false);

    if (!docId) return;

    let cancelled = false;
    setLoadingSummaries(true);
    prepareReview(docId)
      .then((result) => {
        if (cancelled) return;
        if (result.suggested_summary) {
          setUpdateDescription(result.suggested_summary);
        }
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setLoadingSummaries(false);
      });

    return () => {
      cancelled = true;
    };
  }, [open, docId]);

  const handleSubmit = useCallback(async () => {
    if (!docId) return;

    const trimmedDescription = updateDescription.trim();
    if (!trimmedDescription) {
      setDescriptionError(true);
      return;
    }

    setSubmitting(true);
    try {
      await submitDocumentReview(docId, {
        doc_number: initialDocNumber.trim(),
        file_name: docName,
        update_description: trimmedDescription,
      });
      toast.success(t("reviewDialog.submitSuccess"));
      onSuccess();
      onOpenChange(false);
    } catch {
      // 错误文案（含上游 docfuse 的 detail）由 lib/axios 的全局拦截器统一 toast，
      // 这里只负责不往下走成功分支。
    } finally {
      setSubmitting(false);
    }
  }, [docId, initialDocNumber, updateDescription, docName, t, onSuccess, onOpenChange]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[460px]">
        <DialogHeader>
          <DialogTitle>{t("reviewDialog.title")}</DialogTitle>
          <DialogDescription>{t("reviewDialog.description", { name: docName })}</DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 py-2">
          <div className="grid gap-1.5">
            <Label htmlFor="doc-number">{t("reviewDialog.docNumber")}</Label>
            <Input
              id="doc-number"
              value={initialDocNumber}
              readOnly
              disabled
              placeholder={t("reviewDialog.docNumberPlaceholder")}
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="update-desc">{t("reviewDialog.updateDescription")}</Label>
            <Textarea
              id="update-desc"
              value={updateDescription}
              onChange={(e) => {
                setUpdateDescription(e.target.value);
                if (descriptionError) setDescriptionError(false);
              }}
              placeholder={
                loadingSummaries
                  ? t("reviewDialog.loadingSummaries")
                  : t("reviewDialog.updateDescriptionPlaceholder")
              }
              rows={5}
              disabled={loadingSummaries}
              className={descriptionError ? "border-destructive" : ""}
            />
            {descriptionError && (
              <p className="text-xs text-destructive">
                {t("reviewDialog.updateDescriptionRequired")}
              </p>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
            {t("reviewDialog.cancel")}
          </Button>
          <Button onClick={handleSubmit} disabled={submitting || loadingSummaries}>
            {(submitting || loadingSummaries) && (
              <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />
            )}
            {t("reviewDialog.submit")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
