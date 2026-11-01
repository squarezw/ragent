"use client";
import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { useSWRConfig } from "swr";
import { isAxiosError } from "axios";
import axios from "@/lib/axios";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { useWorkspace } from "@/app/components/WorkspaceProvider";
import { canReplacePackage, type PackageReplacementPreview } from "@/lib/skillPackageReplacement";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/checkbox";

export default function SkillPackageReplacement({
  skillId,
  enabled,
  onRefresh,
}: {
  skillId: number;
  enabled: boolean;
  onRefresh: () => void;
}) {
  const { user, loading } = useCurrentUser();
  const workspace = useWorkspace();
  if (!enabled || loading || !user?.id || !workspace.ready) return null;
  return (
    <ReplacementDialog
      key={`${user.id}:${workspace.enabled ? workspace.tenant?.id : "legacy"}:${skillId}`}
      skillId={skillId}
      onRefresh={onRefresh}
    />
  );
}
function ReplacementDialog({ skillId, onRefresh }: { skillId: number; onRefresh: () => void }) {
  const t = useTranslations("skills");
  const { mutate } = useSWRConfig();
  const [open, setOpen] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<PackageReplacementPreview | null>(null);
  const [ack, setAck] = useState<string[]>([]);
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const [error, setError] = useState("");
  const [dragging, setDragging] = useState(false);
  const dragDepth = useRef(0);
  const fileInput = useRef<HTMLInputElement | null>(null);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const dirty = () => !!document.querySelector('[data-workspace-dirty="true"]');
  function openDialog() {
    if (dirty()) {
      setError(t("replacePackageUnsaved"));
      return;
    }
    dragDepth.current = 0;
    setDragging(false);
    setError("");
    setOpen(true);
  }
  function selectFiles(files: File[], invalidTransfer = false) {
    if (busy || uncertain) return;
    // Canceling the picker or dropping invalid input must preserve an existing valid selection.
    if (!invalidTransfer && files.length === 0) return;
    const selected = files[0];
    if (
      invalidTransfer ||
      files.length !== 1 ||
      !selected.name.toLowerCase().endsWith(".zip") ||
      selected.size > 25 * 1024 * 1024
    ) {
      setError(t("replacePackageSingleZip"));
      return;
    }
    setFile(selected);
    setPreview(null);
    setAck([]);
    setConfirmed(false);
    setError("");
  }
  async function validate() {
    if (!file || busy || uncertain) return;
    setBusy(true);
    setPreview(null);
    setAck([]);
    setConfirmed(false);
    setError("");
    const data = new FormData();
    data.append("file", file);
    try {
      const value: PackageReplacementPreview = (
        await axios.post(`/api/v1/skills/${skillId}/package-replacement/validate`, data)
      ).data;
      if (!mounted.current) return;
      if (
        value.skill_id !== skillId ||
        !Array.isArray(value.files) ||
        !Array.isArray(value.removed_paths) ||
        !Array.isArray(value.warnings) ||
        !value.counts ||
        typeof value.counts.removed !== "number"
      )
        throw Error("INVALID_REPLACEMENT_PREVIEW");
      setPreview(value);
      setAck(value.warnings.map((warning) => warning.code));
      setConfirmed(true);
    } catch {
      if (mounted.current) setError(t("replacePackageValidateFailed"));
    } finally {
      if (mounted.current) setBusy(false);
    }
  }
  async function apply() {
    if (!file || busy || uncertain || !canReplacePackage(preview, ack, confirmed)) return;
    if (dirty()) {
      setError(t("replacePackageUnsaved"));
      return;
    }
    const data = new FormData();
    data.append("file", file);
    data.append("expected_version", preview!.expected_version);
    data.append("validation_token", preview!.validation_token);
    data.append("confirmed_warning_codes", JSON.stringify(ack));
    setBusy(true);
    setError("");
    try {
      const result = (await axios.post(`/api/v1/skills/${skillId}/package-replacement`, data)).data;
      if (!mounted.current) return;
      if (result.skill?.id !== skillId || result.replacement?.published_unchanged !== true)
        throw Error("INVALID_REPLACEMENT_RESULT");
      await mutate(
        (key) =>
          typeof key === "string"
            ? key.includes(`/skills/${skillId}`)
            : Array.isArray(key) &&
              key.some((part) => typeof part === "string" && part.includes(`/skills/${skillId}`)),
        undefined,
        { revalidate: true }
      );
      if (!mounted.current) return;
      onRefresh();
      setOpen(false);
      setPreview(null);
      setFile(null);
    } catch (failure) {
      if (!mounted.current) return;
      const status = isAxiosError(failure) ? failure.response?.status : undefined;
      if (status && status >= 400 && status < 500) {
        setPreview(null);
        setAck([]);
        setConfirmed(false);
        setError(t("replacePackageConflict"));
      } else {
        setUncertain(true);
        setError(t("replacePackageUnknown"));
      }
    } finally {
      if (mounted.current) setBusy(false);
    }
  }
  return (
    <div className="space-y-2">
      <Button variant="outline" size="sm" onClick={openDialog}>
        {t("replacePackageTitle")}
      </Button>
      {!open && error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <Dialog
        open={open}
        onOpenChange={(next) => {
          if (!busy && !uncertain) {
            dragDepth.current = 0;
            setDragging(false);
            setOpen(next);
          }
        }}
      >
        <DialogContent
          className="max-h-[85vh] overflow-y-auto"
          onDragOver={(event) => {
            event.preventDefault();
            event.stopPropagation();
          }}
          onDrop={(event) => {
            event.preventDefault();
            event.stopPropagation();
          }}
        >
          <DialogHeader>
            <DialogTitle>{t("replacePackageTitle")}</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">{t("replacePackageHint")}</p>
          <div
            role="group"
            aria-label={t("replacePackageDropzone")}
            aria-disabled={busy || uncertain}
            className={`rounded-md border border-dashed p-6 text-center space-y-3 ${dragging ? "border-primary bg-primary/5" : ""}`}
            onDragEnter={(event) => {
              event.preventDefault();
              event.stopPropagation();
              if (busy || uncertain) return;
              dragDepth.current += 1;
              setDragging(true);
            }}
            onDragOver={(event) => {
              event.preventDefault();
              event.stopPropagation();
              event.dataTransfer.dropEffect = busy || uncertain ? "none" : "copy";
            }}
            onDragLeave={(event) => {
              event.preventDefault();
              event.stopPropagation();
              dragDepth.current = Math.max(0, dragDepth.current - 1);
              if (dragDepth.current === 0) setDragging(false);
            }}
            onDrop={(event) => {
              event.preventDefault();
              event.stopPropagation();
              dragDepth.current = 0;
              setDragging(false);
              if (busy || uncertain) return;
              const files = Array.from(event.dataTransfer.files || []);
              const items = Array.from(event.dataTransfer.items || []);
              let invalid = files.length !== 1;
              try {
                invalid ||= items.some(
                  (item) => item.kind !== "file" || item.webkitGetAsEntry?.()?.isDirectory === true
                );
              } catch {
                invalid = true;
              }
              selectFiles(files, invalid);
            }}
          >
            <p className="text-sm text-muted-foreground">{t("replacePackageDropzone")}</p>
            <Button
              type="button"
              variant="outline"
              disabled={busy || uncertain}
              onClick={() => {
                if (!busy && !uncertain) fileInput.current?.click();
              }}
            >
              {t("replacePackageSelect")}
            </Button>
            <p role="status" className="break-all text-sm">
              {file ? file.name : t("replacePackageNoFile")}
            </p>
            <input
              ref={fileInput}
              aria-label={t("replacePackageSelect")}
              type="file"
              accept=".zip"
              hidden
              disabled={busy || uncertain}
              onChange={(event) => {
                selectFiles(Array.from(event.target.files || []));
                event.target.value = "";
              }}
            />
          </div>
          <Button disabled={!file || busy || uncertain} onClick={validate}>
            {t("replacePackagePreview")}
          </Button>
          {preview && (
            <div className="space-y-3">
              <p>
                {t("replacePackageCounts", {
                  added: preview.counts.added,
                  modified: preview.counts.modified,
                  unchanged: preview.counts.unchanged,
                  removed: preview.counts.removed,
                })}
              </p>
              <div className="max-h-48 overflow-auto rounded border p-2 text-sm">
                {preview.files.map((item) => (
                  <p key={item.path} className="break-all">
                    {t(`replacePackageChange_${item.change}`)}: {item.path}
                  </p>
                ))}
                {preview.removed_paths.map((path) => (
                  <p key={`removed:${path}`} className="break-all text-destructive">
                    {t("replacePackageChange_removed")}: {path}
                  </p>
                ))}
              </div>
              {preview.warnings.map((warning) => (
                <label key={warning.code} className="flex items-start gap-2 text-sm">
                  <Checkbox
                    checked={ack.includes(warning.code)}
                    disabled={busy || uncertain}
                    onCheckedChange={(checked) =>
                      setAck((previous) =>
                        checked === true
                          ? [...previous, warning.code]
                          : previous.filter((code) => code !== warning.code)
                      )
                    }
                  />
                  <span>{warning.message}</span>
                </label>
              ))}
              <label className="flex items-start gap-2 text-sm">
                <Checkbox
                  checked={confirmed}
                  disabled={busy || uncertain}
                  onCheckedChange={(checked) => setConfirmed(checked === true)}
                />
                <span>{t("replacePackageConfirmDeletion")}</span>
              </label>
              <Button
                disabled={busy || uncertain || !canReplacePackage(preview, ack, confirmed)}
                onClick={apply}
              >
                {t("replacePackageApply")}
              </Button>
            </div>
          )}
          {error && (
            <p role="alert" className="text-destructive">
              {error}
            </p>
          )}
          {uncertain && (
            <Button onClick={() => window.location.reload()}>{t("replacePackageReadDraft")}</Button>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
