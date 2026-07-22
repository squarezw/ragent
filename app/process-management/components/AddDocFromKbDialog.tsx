"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { ChevronRight, Database, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import axios from "@/lib/axios";
import { createDocument, copyKnowledgeFileToDoc } from "../services/api";
import { formatFileSize } from "./processConstants";

interface Dataset {
  id: string;
  name: string;
  file_count?: number;
}

interface FileItem {
  id: string;
  filename: string;
  originalname: string;
  object_key?: string;
  size: number;
  upload_time: string;
}

function formatElapsed(s: number) {
  const m = Math.floor(s / 60);
  const sec = s % 60;
  if (m > 0) return `${m}:${sec.toString().padStart(2, "0")}`;
  return `${sec}s`;
}

interface AddDocFromKbDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  nodeId: string;
  onAdded?: () => void;
}

export default function AddDocFromKbDialog({
  open,
  onOpenChange,
  nodeId,
  onAdded,
}: AddDocFromKbDialogProps) {
  const t = useTranslations("processManagement");
  const [datasets, setDatasets] = useState<Dataset[]>([]);
  const [datasetsLoading, setDatasetsLoading] = useState(false);
  const [expandedDs, setExpandedDs] = useState<Set<string>>(new Set());
  const [dsFiles, setDsFiles] = useState<Record<string, FileItem[]>>({});
  const [dsFilesLoading, setDsFilesLoading] = useState<Set<string>>(new Set());
  const [selectedFile, setSelectedFile] = useState<{
    id: string;
    key: string;
    name: string;
  } | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (submitting) {
      setElapsed(0);
      timerRef.current = setInterval(() => setElapsed((s) => s + 1), 1000);
    } else if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [submitting]);

  const loadDatasets = useCallback(async () => {
    setDatasetsLoading(true);
    try {
      const resp = await axios.get("/api/datasets");
      setDatasets(resp.data || []);
    } catch {
      setDatasets([]);
    } finally {
      setDatasetsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (open) {
      loadDatasets();
      setSelectedFile(null);
      setDsFiles({});
      setExpandedDs(new Set());
    }
  }, [open, loadDatasets]);

  const loadFiles = useCallback(
    async (datasetId: string) => {
      // Use functional updater to check cache without depending on dsFiles
      let alreadyLoaded = false;
      setDsFiles((prev) => {
        if (prev[datasetId]) {
          alreadyLoaded = true;
        }
        return prev;
      });
      if (alreadyLoaded) return;

      setDsFilesLoading((prev) => new Set(prev).add(datasetId));
      try {
        const resp = await axios.get("/api/knowledge/list", {
          params: { dataset_id: datasetId, page_size: 100 },
        });
        const files: FileItem[] = resp.data?.files || [];
        setDsFiles((prev) => ({ ...prev, [datasetId]: files }));
      } catch {
        setDsFiles((prev) => ({ ...prev, [datasetId]: [] }));
      } finally {
        setDsFilesLoading((prev) => {
          const next = new Set(prev);
          next.delete(datasetId);
          return next;
        });
      }
    },
    []
  );

  const toggleDs = (id: string) => {
    setExpandedDs((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
        loadFiles(id);
      }
      return next;
    });
  };

  const handleConfirm = async () => {
    if (!selectedFile) return;
    setSubmitting(true);
    try {
      const doc = await createDocument({
        node_id: nodeId,
        name: selectedFile.name,
        file_path: `kb_file_${selectedFile.id}`,
      });
      await copyKnowledgeFileToDoc(doc.id, selectedFile.id);
      toast.success(t("addDocDialog.addSuccess", { name: selectedFile.name }));
      onAdded?.();
      onOpenChange(false);
    } catch {
      toast.error(t("addDocDialog.addFailed"));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[560px]">
        <DialogHeader>
          <DialogTitle>{t("addDocDialog.title")}</DialogTitle>
          <p className="text-xs text-muted-foreground mt-1">
            {t("addDocDialog.subtitle")}
          </p>
        </DialogHeader>

        <RadioGroup
          value={selectedFile?.id ?? ""}
          onValueChange={() => {}}
          className="max-h-[400px] overflow-y-auto space-y-1.5 pr-1"
        >
          {datasetsLoading ? (
            <div className="flex items-center justify-center py-8 text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin mr-2" />
              <span className="text-sm">{t("addDocDialog.loadingKbs")}</span>
            </div>
          ) : datasets.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground text-sm">
              {t("addDocDialog.noKbs")}
            </div>
          ) : (
            datasets.map((ds) => {
              const dsOpen = expandedDs.has(ds.id);
              const files = dsFiles[ds.id] || [];
              const isLoadingFiles = dsFilesLoading.has(ds.id);
              return (
                <div key={ds.id}>
                  <button
                    className="flex items-center gap-2 w-full px-2.5 py-2 rounded-md bg-muted/40 border text-sm font-semibold hover:bg-muted/60 transition-colors"
                    onClick={() => toggleDs(ds.id)}
                  >
                    <ChevronRight
                      className={cn(
                        "h-3.5 w-3.5 text-muted-foreground transition-transform",
                        dsOpen && "rotate-90"
                      )}
                    />
                    <Database className="h-4 w-4 flex-shrink-0" />
                    <span className="flex-1 text-left truncate">
                      {ds.name}
                    </span>
                    {ds.file_count != null && (
                      <span className="text-xs text-muted-foreground font-normal">
                        {ds.file_count} {t("addDocDialog.files")}
                      </span>
                    )}
                  </button>

                  {dsOpen && (
                    <div className="pl-7 mt-1 space-y-0.5">
                      {isLoadingFiles ? (
                        <div className="flex items-center gap-2 px-2 py-2 text-xs text-muted-foreground">
                          <Loader2 className="h-3 w-3 animate-spin" />
                          {t("addDocDialog.loadingFiles")}
                        </div>
                      ) : files.length === 0 ? (
                        <div className="px-2 py-2 text-xs text-muted-foreground">
                          {t("addDocDialog.noFiles")}
                        </div>
                      ) : (
                        files.map((file) => {
                          const displayName =
                            file.originalname || file.filename;
                          return (
                            <label
                              key={file.id}
                              className="flex items-center gap-2 px-2 py-1.5 rounded cursor-pointer hover:bg-muted/30 transition-colors"
                              onClick={() =>
                                setSelectedFile({
                                  id: file.id,
                                  key: file.object_key || file.filename,
                                  name: displayName,
                                })
                              }
                            >
                              <RadioGroupItem value={file.id} />
                              <span className="flex-1 text-xs text-foreground truncate">
                                {displayName}
                              </span>
                              <span className="text-[11px] text-muted-foreground flex-shrink-0">
                                {formatFileSize(file.size)}
                              </span>
                            </label>
                          );
                        })
                      )}
                    </div>
                  )}
                </div>
              );
            })
          )}
        </RadioGroup>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t("addDocDialog.cancel")}
          </Button>
          <Button
            disabled={!selectedFile || submitting}
            onClick={handleConfirm}
          >
            {submitting ? (
              <>
                <Loader2 className="h-3 w-3 animate-spin mr-1" />
                {t("addDocDialog.submittingBtn")} {formatElapsed(elapsed)}
              </>
            ) : (
              t("addDocDialog.confirmBtn")
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
