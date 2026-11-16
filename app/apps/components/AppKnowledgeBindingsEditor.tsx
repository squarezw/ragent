"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { Loader2, Plus } from "lucide-react";
import axios from "@/lib/axios";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

type Dataset = {
  id: string;
  name: string;
  owner_tenant_id?: number | null;
  visibility?: string;
  dimension?: number | null;
};

export default function AppKnowledgeBindingsEditor({
  appId,
  ownerTenantId,
  settings,
  datasetIds,
  onSaved,
}: {
  appId: number;
  ownerTenantId?: number | null;
  settings?: Record<string, unknown>;
  datasetIds: string[];
  onSaved: () => Promise<void>;
}) {
  const t = useTranslations("apps");
  const tc = useTranslations("common");
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<boolean | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [dirty, setDirty] = useState(false);
  const [datasets, setDatasets] = useState<Dataset[]>([]);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const [saving, setSaving] = useState(false);
  const active = useRef(true);
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);

  useEffect(() => {
    if (!open) return;
    let current = true;
    setLoading(true);
    setFailed(false);
    setDatasets([]);
    axios
      .get<Dataset[]>("/api/datasets")
      .then(({ data }) => {
        if (current)
          setDatasets(
            data.filter(
              (dataset) =>
                dataset.visibility === "public" ||
                (!!ownerTenantId && Number(dataset.owner_tenant_id) === ownerTenantId)
            )
          );
      })
      .catch(() => {
        if (current) setFailed(true);
      })
      .finally(() => {
        if (current) setLoading(false);
      });
    return () => {
      current = false;
    };
  }, [open, ownerTenantId]);

  const begin = () => {
    const stored = settings?.auto_select_datasets;
    setMode(typeof stored === "boolean" ? stored : null);
    setSelected([...datasetIds]);
    setDirty(false);
    setOpen(true);
  };
  const selectedDimensions = datasets
    .filter((dataset) => selected.includes(dataset.id))
    .map((dataset) => dataset.dimension)
    .filter((dimension) => dimension !== undefined);
  const selectedDimension =
    selectedDimensions.length > 0 &&
    selectedDimensions.every((dimension) => dimension === selectedDimensions[0])
      ? selectedDimensions[0]
      : undefined;
  const dimensionBlocked = (dataset: Dataset) =>
    selectedDimension !== undefined &&
    dataset.dimension !== undefined &&
    dataset.dimension !== selectedDimension &&
    !selected.includes(dataset.id);
  const missing = selected.filter((id) => !datasets.some((dataset) => dataset.id === id));
  const save = async () => {
    if (!dirty || mode === null || loading || failed || saving || (!mode && missing.length > 0))
      return;
    setSaving(true);
    try {
      await axios.put(`/api/v1/apps/${appId}/datasets`, {
        auto_select_datasets: mode,
        dataset_ids: mode ? [] : selected,
      });
      if (!active.current) return;
      await onSaved();
      if (!active.current) return;
      setOpen(false);
      toast.success(t("knowledgeBindingsSaved"));
    } catch (error: unknown) {
      if (!active.current) return;
      const detail = (error as { response?: { data?: { detail?: unknown } } }).response?.data
        ?.detail;
      toast.error(typeof detail === "string" ? detail : t("operationFailed"));
    } finally {
      if (active.current) setSaving(false);
    }
  };

  return (
    <>
      <Button size="sm" onClick={begin}>
        <Plus className="mr-2 h-4 w-4" />
        {t("manageKnowledgeBindings")}
      </Button>
      <Dialog
        open={open}
        onOpenChange={(value) => {
          if (!saving) setOpen(value);
        }}
      >
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{t("manageKnowledgeBindings")}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <label htmlFor={`knowledge-auto-${appId}`} className="flex items-center gap-2 text-sm">
              <Checkbox
                id={`knowledge-auto-${appId}`}
                checked={mode === null ? "indeterminate" : mode}
                disabled={saving}
                onCheckedChange={(value) => {
                  setMode(value === true);
                  setDirty(true);
                }}
              />
              {t("autoSelectDatasets")}
            </label>
            {mode === null && (
              <p className="text-sm text-muted-foreground">{t("knowledgeSelectionInherited")}</p>
            )}
            {loading ? (
              <Loader2 className="h-5 w-5 animate-spin" aria-label={tc("loading")} />
            ) : failed ? (
              <p className="text-sm text-destructive">{t("knowledgeCandidatesFailed")}</p>
            ) : (
              <div className="max-h-72 space-y-3 overflow-y-auto">
                {!datasets.length && (
                  <p className="text-sm text-muted-foreground">{t("noAvailableDatasets")}</p>
                )}
                {datasets.map((dataset) => (
                  <label
                    key={dataset.id}
                    title={dimensionBlocked(dataset) ? t("datasetDimensionWarning") : undefined}
                    htmlFor={`knowledge-${appId}-${dataset.id}`}
                    className="flex items-center gap-2 text-sm"
                  >
                    <Checkbox
                      id={`knowledge-${appId}-${dataset.id}`}
                      checked={selected.includes(dataset.id)}
                      disabled={mode === true || saving || dimensionBlocked(dataset)}
                      onCheckedChange={(value) => {
                        setMode(false);
                        setDirty(true);
                        setSelected((previous) =>
                          value === true
                            ? [...previous, dataset.id]
                            : previous.filter((id) => id !== dataset.id)
                        );
                      }}
                    />
                    {dataset.name}
                  </label>
                ))}
              </div>
            )}
            {!loading && !failed && missing.length > 0 && mode !== true && (
              <p className="text-sm text-destructive">{t("knowledgeBindingsNeedCleanup")}</p>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" disabled={saving} onClick={() => setOpen(false)}>
              {tc("cancel")}
            </Button>
            <Button
              onClick={save}
              disabled={
                !dirty ||
                mode === null ||
                loading ||
                failed ||
                saving ||
                (!mode && missing.length > 0)
              }
            >
              {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {tc("save")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
