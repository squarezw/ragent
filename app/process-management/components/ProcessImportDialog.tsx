"use client";

import { useRef, useState } from "react";
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
import { Upload, CheckCircle2, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { importProcessTree } from "../services/api";

interface ProcessImportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onImported?: () => void;
}

export default function ProcessImportDialog({
  open,
  onOpenChange,
  onImported,
}: ProcessImportDialogProps) {
  const t = useTranslations("processManagement");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);

  const acceptFile = (file: File) => {
    if (!file.name.endsWith(".xlsx") && !file.name.endsWith(".xls")) {
      toast.error(t("import.uploadFormat"));
      return;
    }
    setSelectedFile(file);
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) acceptFile(file);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const file = e.dataTransfer.files?.[0];
    if (file) acceptFile(file);
  };

  const handleUpload = async () => {
    if (!selectedFile) return;
    setUploading(true);
    try {
      const result = await importProcessTree(selectedFile, { replace: true });
      toast.success(
        t("import.importSuccess", {
          count: String(
            Object.values(result.node_count || {}).reduce((a: number, b: number) => a + b, 0)
          ),
        })
      );
      setSelectedFile(null);
      onOpenChange(false);
      onImported?.();
    } catch (e: unknown) {
      const err = e as {
        response?: { data?: { error?: { message?: string }; detail?: string } };
        message?: string;
      };
      const msg =
        err.response?.data?.error?.message ||
        err.response?.data?.detail ||
        err.message ||
        "Import failed";
      toast.error(msg);
    } finally {
      setUploading(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!uploading) {
          onOpenChange(v);
          if (!v) setSelectedFile(null);
        }
      }}
    >
      <DialogContent className="max-w-[520px]">
        <DialogHeader>
          <DialogTitle>{t("import.title")}</DialogTitle>
          <DialogDescription className="sr-only">{t("import.title")}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div>
            <p className="text-xs text-muted-foreground mb-2">{t("import.uploadLabel")}</p>
            <input
              ref={fileInputRef}
              type="file"
              accept=".xlsx,.xls"
              className="hidden"
              onChange={handleFileSelect}
            />
            <div
              className="border-2 border-dashed rounded-lg p-8 text-center cursor-pointer hover:border-primary/50 hover:bg-muted/20 transition-colors"
              onClick={() => fileInputRef.current?.click()}
              onDragOver={(e) => e.preventDefault()}
              onDrop={handleDrop}
            >
              <Upload className="h-7 w-7 mx-auto mb-2 text-muted-foreground" />
              {selectedFile ? (
                <p className="text-sm font-medium">{selectedFile.name}</p>
              ) : (
                <>
                  <p className="text-sm text-muted-foreground">{t("import.uploadHint")}</p>
                  <p className="text-xs text-muted-foreground/60 mt-1">
                    {t("import.uploadFormat")}
                  </p>
                </>
              )}
            </div>
          </div>

          <p className="text-[11px] text-muted-foreground leading-relaxed">{t("import.hint")}</p>
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => {
              onOpenChange(false);
              setSelectedFile(null);
            }}
            disabled={uploading}
          >
            {t("import.close")}
          </Button>
          <Button onClick={handleUpload} disabled={!selectedFile || uploading}>
            {uploading && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}
            {t("import.reimport")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
