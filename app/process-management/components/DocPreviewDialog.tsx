"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { FileText, User, Calendar, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import type { RelatedDoc } from "../types/process";
import { fetchDocument } from "../services/api";
import { docStatusStyles } from "./processConstants";

interface DocPreviewDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  doc: RelatedDoc | null;
}

export default function DocPreviewDialog({ open, onOpenChange, doc }: DocPreviewDialogProps) {
  const t = useTranslations("processManagement");
  const [content, setContent] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open || !doc) return;
    const controller = new AbortController();
    setLoading(true);
    setContent(null);
    fetchDocument(doc.id, { signal: controller.signal })
      .then((data) => setContent(data.content || null))
      .catch(() => setContent(null))
      .finally(() => setLoading(false));
    return () => controller.abort();
  }, [open, doc?.id]);

  if (!doc) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[720px] max-h-[85vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>{doc.name}</DialogTitle>
          <DialogDescription className="sr-only">{t("detail.preview")}</DialogDescription>
        </DialogHeader>

        {/* Meta */}
        <div className="flex items-center gap-4 text-xs text-muted-foreground pb-3 border-b flex-wrap">
          <span className="flex items-center gap-1">
            <FileText className="h-3.5 w-3.5" />
            {doc.id}
          </span>
          <span className="flex items-center gap-1">
            <User className="h-3.5 w-3.5" />
            {doc.owner} · {doc.dept}
          </span>
          <span className="flex items-center gap-1">
            <Calendar className="h-3.5 w-3.5" />
            {doc.createdAt}
          </span>
          <span
            className={cn(
              "inline-flex text-[11px] font-medium px-2 py-0.5 rounded-full border",
              docStatusStyles[doc.status]
            )}
          >
            {t(`status.${doc.status}`)}
          </span>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto rounded-lg border bg-muted/20 p-5">
          {loading ? (
            <div className="flex items-center justify-center py-10 text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin mr-2" />
              {t("conversion.loading")}
            </div>
          ) : content ? (
            <div
              className="prose prose-sm prose-invert max-w-none
                [&_h2]:text-sm [&_h2]:font-semibold [&_h2]:text-foreground [&_h2]:mt-5 [&_h2]:mb-2 [&_h2]:pb-1 [&_h2]:border-b [&_h2]:border-border
                [&_p]:text-sm [&_p]:text-muted-foreground [&_p]:mb-2 [&_p]:leading-relaxed
                [&_ul]:text-sm [&_ul]:text-muted-foreground [&_ul]:mb-2 [&_ul]:pl-5
                [&_li]:mb-1"
              dangerouslySetInnerHTML={{ __html: content }}
            />
          ) : (
            <p className="text-center text-muted-foreground py-10">{t("detail.noPreview")}</p>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t("import.close")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
