"use client";
import { useState } from "react";
import { useTranslations } from "next-intl";
import { isAxiosError } from "axios";
import axios from "@/lib/axios";
import { useWorkspace } from "@/app/components/WorkspaceProvider";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";

type Issue = { code: string; message: string; count?: number; items?: { id: number; name: string }[] };
type Preview = {
  dataset: { id: string; name: string };
  source: { tenant_id: number; name: string };
  target: { tenant_id: number; name: string };
  changes: {
    visibility: string;
    creator_reassigned: boolean;
    tags: string[];
    categories: string[];
    file_count: number;
  };
  warnings: Issue[];
  blockers: Issue[];
  can_apply: boolean;
  expected_version: string;
};

function errorMessage(error: unknown, fallback: string) {
  if (isAxiosError(error)) {
    const detail = error.response?.data?.detail;
    if (detail && typeof detail === "object" && detail.message) return String(detail.message);
    if (typeof detail === "string") return detail;
  }
  return fallback;
}

/** Super-admin only; the service re-checks the role and every precondition. */
export default function DatasetTenantTransfer({
  dataset,
  disabled,
  onTransferred,
}: {
  dataset: { id: string; owner_tenant_id?: number | null };
  disabled?: boolean;
  onTransferred: () => void;
}) {
  const t = useTranslations("datasets");
  const workspace = useWorkspace();
  const [open, setOpen] = useState(false);
  const [target, setTarget] = useState("");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [ack, setAck] = useState<string[]>([]);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [requestKey, setRequestKey] = useState("");

  const targets = workspace.tenants.filter((tenant) => tenant.id !== dataset.owner_tenant_id);
  if (!workspace.ready || !workspace.tenant || dataset.owner_tenant_id !== workspace.tenant.id) {
    return null;
  }

  function reset() {
    setTarget("");
    setPreview(null);
    setAck([]);
    setReason("");
    setError("");
    setRequestKey("");
  }

  async function inspect() {
    setBusy(true);
    setError("");
    setPreview(null);
    setAck([]);
    try {
      const { data } = await axios.post(`/api/v1/datasets/${dataset.id}/tenant-transfer/preflight`, {
        target_tenant_id: Number(target),
      });
      setPreview(data);
      setRequestKey(crypto.randomUUID());
    } catch (e) {
      setError(errorMessage(e, t("transferFailed")));
    } finally {
      setBusy(false);
    }
  }

  async function submit() {
    if (!preview) return;
    setBusy(true);
    setError("");
    try {
      await axios.post(`/api/v1/datasets/${dataset.id}/tenant-transfer`, {
        target_tenant_id: preview.target.tenant_id,
        expected_version: preview.expected_version,
        confirmed_warning_codes: ack,
        reason: reason.trim(),
        idempotency_key: requestKey,
      });
      setOpen(false);
      reset();
      onTransferred();
    } catch (e) {
      setError(errorMessage(e, t("transferFailed")));
    } finally {
      setBusy(false);
    }
  }

  const allConfirmed = !!preview && preview.warnings.every((w) => ack.includes(w.code));
  const canSubmit = !!preview && preview.can_apply && allConfirmed && reason.trim() !== "" && !busy;

  return (
    <>
      <button
        type="button"
        disabled={disabled}
        onClick={() => {
          reset();
          setOpen(true);
        }}
        className="whitespace-nowrap text-xs text-primary hover:underline disabled:opacity-50"
      >
        {t("transferAction")}
      </button>
      <Dialog
        open={open}
        onOpenChange={(next) => {
          if (!busy) setOpen(next);
        }}
      >
        <DialogContent className="max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{t("transferTitle")}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 text-sm">
            <p className="text-muted-foreground">{t("transferNotice")}</p>
            <Select
              value={target}
              disabled={busy}
              onValueChange={(value) => {
                setTarget(value);
                setPreview(null);
                setAck([]);
              }}
            >
              <SelectTrigger aria-label={t("transferTarget")}>
                <SelectValue placeholder={t("transferTarget")} />
              </SelectTrigger>
              <SelectContent>
                {targets.map((tenant) => (
                  <SelectItem key={tenant.id} value={String(tenant.id)}>
                    {tenant.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button disabled={!target || busy} onClick={inspect}>
              {t("transferPreview")}
            </Button>

            {preview && (
              <div className="space-y-3">
                <p className="font-medium">
                  {preview.source.name} → {preview.target.name}
                </p>
                <ul className="list-disc space-y-1 pl-5 text-muted-foreground">
                  <li>{t("transferFiles", { count: preview.changes.file_count })}</li>
                  <li>{t("transferDeptCleared")}</li>
                  {preview.changes.visibility === "private" && <li>{t("transferVisibilityPrivate")}</li>}
                  {preview.changes.creator_reassigned && <li>{t("transferCreatorReassigned")}</li>}
                  {preview.changes.tags.length > 0 && (
                    <li>{t("transferTags", { names: preview.changes.tags.join("、") })}</li>
                  )}
                  {preview.changes.categories.length > 0 && (
                    <li>{t("transferCategories", { names: preview.changes.categories.join("、") })}</li>
                  )}
                </ul>

                {preview.blockers.length > 0 && (
                  <div role="alert" className="text-destructive">
                    <strong>{t("transferBlocked")}</strong>
                    {preview.blockers.map((item) => (
                      <p key={item.code}>{item.message}</p>
                    ))}
                  </div>
                )}

                {preview.warnings.map((item) => (
                  <label key={item.code} className="flex items-start gap-2">
                    <Checkbox
                      checked={ack.includes(item.code)}
                      disabled={busy}
                      onCheckedChange={(checked) =>
                        setAck((prev) =>
                          checked === true ? [...prev, item.code] : prev.filter((c) => c !== item.code)
                        )
                      }
                    />
                    <span>
                      {item.message}
                      {item.items?.length ? `：${item.items.map((i) => i.name).join("、")}` : ""}
                      {item.count && !item.items ? `（${item.count}）` : ""}
                    </span>
                  </label>
                ))}

                {preview.can_apply && (
                  <>
                    <Textarea
                      aria-label={t("transferReason")}
                      placeholder={t("transferReason")}
                      value={reason}
                      maxLength={500}
                      disabled={busy}
                      onChange={(event) => setReason(event.target.value)}
                    />
                    <Button disabled={!canSubmit} onClick={submit}>
                      {t("transferConfirm")}
                    </Button>
                  </>
                )}
              </div>
            )}
            {error && (
              <p role="alert" className="text-destructive">
                {error}
              </p>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
