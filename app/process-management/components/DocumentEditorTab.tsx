"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { ArrowLeft, FileText, Send, Loader2, Save, Download } from "lucide-react";
import axios from "@/lib/axios";
import { fetchDocument } from "../services/api";
import type { BackendDocument } from "../types/process";
import OnlyOfficeEditor from "./OnlyOfficeEditor";
import SubmitReviewDialog from "./SubmitReviewDialog";

export interface EditingContext {
  docId?: string;
  sessionId?: string;
}

interface DocumentEditorTabProps {
  onBack?: () => void;
  onAfterSubmitReview?: () => void;
  editingContext?: EditingContext | null;
  hideSubmitReview?: boolean;
}

export default function DocumentEditorTab({
  onBack,
  onAfterSubmitReview,
  editingContext,
  hideSubmitReview,
}: DocumentEditorTabProps) {
  const t = useTranslations("processManagement");

  const [docMeta, setDocMeta] = useState<BackendDocument | null>(null);
  const [saving, setSaving] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [exportMenuOpen, setExportMenuOpen] = useState(false);
  const [reviewDialogOpen, setReviewDialogOpen] = useState(false);
  const docKeyRef = useRef<string | null>(null);

  // Fetch document metadata for title display
  useEffect(() => {
    if (!editingContext?.docId) {
      setDocMeta(null);
      return;
    }
    let cancelled = false;
    const loadMeta = async () => {
      try {
        const doc = await fetchDocument(editingContext.docId!);
        if (!cancelled) setDocMeta(doc);
      } catch {
        // Non-critical — title will fall back to default
      }
    };
    loadMeta();
    return () => {
      cancelled = true;
    };
  }, [editingContext?.docId]);

  const forceSaveAndWait = useCallback(async () => {
    const key = docKeyRef.current;
    if (!key) return;
    await axios.post("/api/internal/onlyoffice/force-save", { key });
  }, []);

  const handleSubmitReview = useCallback(async () => {
    setSaving(true);
    try {
      await forceSaveAndWait();
      setReviewDialogOpen(true);
    } catch {
      toast.error(t("editor.saveFailed"));
    } finally {
      setSaving(false);
    }
  }, [forceSaveAndWait, t]);

  const handleSave = useCallback(async () => {
    setSaving(true);
    try {
      await forceSaveAndWait();
      toast.success(t("editor.saved"));
    } catch {
      toast.error(t("editor.saveFailed"));
    } finally {
      setSaving(false);
    }
  }, [t, editingContext?.docId, forceSaveAndWait]);

  const handleExportWord = useCallback(async () => {
    const ctx = editingContext;
    if (!ctx?.docId && !ctx?.sessionId) return;
    setExportMenuOpen(false);
    setExporting(true);
    toast.info(t("editor.wordExporting"));
    try {
      await forceSaveAndWait();
      const url = ctx.docId
        ? `/api/v1/process-management/process-documents/${ctx.docId}/file`
        : `/api/v1/process-management/handbook/download/${ctx.sessionId}`;

      const resp = await axios.get(url, { responseType: "blob", timeout: 30_000 });
      const blobUrl = URL.createObjectURL(resp.data);
      const a = document.createElement("a");
      a.href = blobUrl;
      const name = docMeta?.name?.replace(/\.docx$/i, "") || ctx.docId || ctx.sessionId;
      a.download = `${name}.docx`;
      a.click();
      URL.revokeObjectURL(blobUrl);
      toast.success(t("editor.wordExported"));
    } catch {
      toast.error(t("editor.exportFailed"));
    } finally {
      setExporting(false);
    }
  }, [editingContext, docMeta, forceSaveAndWait, t]);

  const handleExportPDF = useCallback(async () => {
    const ctx = editingContext;
    if (!ctx?.docId && !ctx?.sessionId) return;
    setExportMenuOpen(false);
    setExporting(true);
    toast.info(t("editor.pdfExporting"));
    try {
      await forceSaveAndWait();
      const type = ctx.sessionId ? "session" : "doc";
      const id = ctx.sessionId || ctx.docId;
      const filename = docMeta?.name?.replace(/\.docx$/i, "") || id;

      const resp = await axios.post(
        "/api/internal/docx/convert",
        { type, id, outputType: "pdf", filename },
        { responseType: "blob", timeout: 120_000 }
      );

      const blobUrl = URL.createObjectURL(resp.data);
      const a = document.createElement("a");
      a.href = blobUrl;
      a.download = `${filename}.pdf`;
      a.click();
      URL.revokeObjectURL(blobUrl);
      toast.success(t("editor.pdfExported"));
    } catch {
      toast.error(t("editor.exportFailed"));
    } finally {
      setExporting(false);
    }
  }, [editingContext, docMeta, forceSaveAndWait, t]);

  const docTitle = docMeta?.name || t("editor.title");

  // No editing context — empty state
  if (!editingContext?.docId && !editingContext?.sessionId) {
    return (
      <div className="flex flex-col flex-1 min-h-0">
        <div className="flex items-center px-4 py-3 border-b border-border bg-card">
          <button
            onClick={onBack}
            className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            <ArrowLeft className="w-4 h-4" />
            {t("editor.backToConversion")}
          </button>
        </div>
        <div className="flex-1 flex flex-col items-center justify-center text-muted-foreground">
          <FileText className="h-12 w-12 mb-4 opacity-30" />
          <p className="text-sm">{t("editor.noDocument")}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col flex-1 min-h-0">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border bg-card">
        <div className="flex items-center gap-3">
          <button
            onClick={onBack}
            className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            <ArrowLeft className="w-4 h-4" />
            {t("editor.backToConversion")}
          </button>
          <div className="w-px h-5 bg-border" />
          <h2 className="text-base font-semibold text-foreground truncate max-w-[300px]">
            {docTitle}
          </h2>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={handleSave}
            disabled={saving}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-md bg-primary text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50"
          >
            {saving ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Save className="w-3.5 h-3.5" />
            )}
            {t("editor.save")}
          </button>
          {/* Export dropdown */}
          <div className="relative">
            <button
              onClick={() => setExportMenuOpen((v) => !v)}
              disabled={exporting}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-md border border-border hover:bg-accent transition-colors disabled:opacity-50"
            >
              {exporting ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Download className="w-3.5 h-3.5" />
              )}
              {t("editor.export")}
            </button>
            {exportMenuOpen && (
              <>
                <div className="fixed inset-0 z-10" onClick={() => setExportMenuOpen(false)} />
                <div className="absolute right-0 top-full mt-1 z-20 w-40 bg-popover border border-border rounded-md shadow-md py-1">
                  <button
                    onClick={handleExportWord}
                    className="w-full text-left px-3 py-2 text-xs hover:bg-accent transition-colors"
                  >
                    {t("editor.exportWord")}
                  </button>
                  <button
                    onClick={handleExportPDF}
                    className="w-full text-left px-3 py-2 text-xs hover:bg-accent transition-colors"
                  >
                    {t("editor.exportPDF")}
                  </button>
                </div>
              </>
            )}
          </div>
          {!hideSubmitReview && !!docMeta?.session_id && !!docMeta?.ai_summary && (
            <button
              onClick={handleSubmitReview}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-md bg-green-600 text-white hover:bg-green-600/90 transition-colors"
            >
              <Send className="w-3.5 h-3.5" />
              {t("editor.submitReview")}
            </button>
          )}
        </div>
      </div>

      {/* OnlyOffice Editor */}
      <div className="relative flex flex-col flex-1 min-h-0">
        <OnlyOfficeEditor
          type={editingContext?.sessionId ? "session" : "doc"}
          id={(editingContext?.sessionId || editingContext?.docId)!}
          onDocKeyReady={(key) => {
            docKeyRef.current = key;
          }}
        />
        {saving && <div className="absolute inset-0 z-10 bg-background/20 cursor-not-allowed" />}
      </div>

      <SubmitReviewDialog
        open={reviewDialogOpen}
        onOpenChange={setReviewDialogOpen}
        docId={editingContext?.docId ?? null}
        docName={docMeta?.name ?? ""}
        initialDocNumber={docMeta?.doc_number ?? ""}
        onSuccess={() => onAfterSubmitReview?.()}
      />
    </div>
  );
}
