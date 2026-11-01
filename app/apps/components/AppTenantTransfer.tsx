"use client";
import { useState, useEffect, useRef } from "react";
import { useTranslations } from "next-intl";
import { useSWRConfig } from "swr";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { isAxiosError } from "axios";
import { useRouter } from "next/navigation";
import { useWorkspace } from "@/app/components/WorkspaceProvider";
import axios from "@/lib/axios";
import {
  canConfirmTransfer,
  transferPayload,
  type TransferPreview,
  type TransferResult,
} from "@/lib/appTenantTransfer";
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

/** Capabilities are returned by the service; role names never authorize transfer. */
type TransferApp = {
  id: number;
  owner_tenant_id?: number | null;
  can_transfer_tenant?: boolean;
  tenant_transfer?: { transfer_id: string; rollback_eligible: boolean } | null;
};
export default function AppTenantTransfer({
  app,
  onComplete,
}: {
  app: TransferApp;
  onComplete?: (result: TransferResult) => void;
}) {
  const { user, loading } = useCurrentUser();
  const workspace = useWorkspace();
  if (
    loading ||
    !user?.id ||
    app.can_transfer_tenant !== true ||
    !workspace.ready ||
    !workspace.enabled ||
    !workspace.tenant ||
    app.owner_tenant_id !== workspace.tenant?.id
  )
    return null;
  return (
    <ScopedTransfer
      key={`${user.id}:${workspace.tenant.id}:${app.id}`}
      app={app}
      actorId={user.id}
      onComplete={onComplete}
    />
  );
}
function ScopedTransfer({
  app,
  actorId,
  onComplete,
}: {
  app: TransferApp;
  actorId: number;
  onComplete?: (result: TransferResult) => void;
}) {
  const t = useTranslations("apps");
  const workspace = useWorkspace();
  const router = useRouter();
  const { mutate } = useSWRConfig();
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const recoveryKey = `app-transfer:${actorId}:${workspace.tenant?.id}:${app.id}`;
  const [rollback, setRollback] = useState(false);
  const basePath =
    rollback && app.tenant_transfer
      ? `/api/v1/apps/${app.id}/tenant-transfer/${app.tenant_transfer.transfer_id}`
      : `/api/v1/apps/${app.id}/tenant-transfer`;
  const previewPath = rollback ? `${basePath}/rollback-preflight` : `${basePath}/preflight`;
  const applyPath = rollback ? `${basePath}/rollback` : basePath;
  const [open, setOpen] = useState(false);
  const [target, setTarget] = useState("");
  const [preview, setPreview] = useState<TransferPreview | null>(null);
  const [ack, setAck] = useState<string[]>([]);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [pendingKey, setPendingKey] = useState<string | null>(() => {
    try {
      return sessionStorage.getItem(recoveryKey);
    } catch {
      return null;
    }
  });
  function savePending(key: string | null) {
    setPendingKey(key);
    try {
      if (key) sessionStorage.setItem(recoveryKey, key);
      else sessionStorage.removeItem(recoveryKey);
    } catch {
      /* in-memory status remains available */
    }
  }
  async function complete(value: TransferResult) {
    if (!mounted.current || value.app_id !== app.id) return;
    await mutate(
      (key) => typeof key === "string" && (key.includes("/apps") || key.includes("app-skill")),
      undefined,
      { revalidate: false }
    );
    if (!mounted.current) return;
    setResult(value);
    savePending(null);
    onComplete?.(value);
  }
  const [result, setResult] = useState<TransferResult | null>(null);
  if (app.can_transfer_tenant !== true || !workspace.ready || !workspace.enabled) return null;
  async function inspect() {
    setBusy(true);
    setError("");
    setPreview(null);
    setAck([]);
    try {
      const value: TransferPreview = (
        await axios.post(previewPath, rollback ? {} : { target_tenant_id: Number(target) })
      ).data;
      if (!mounted.current) return;
      if (
        value.app_id !== app.id ||
        value.source.tenant_id !== app.owner_tenant_id ||
        (!rollback && value.target.tenant_id !== Number(target))
      )
        throw new Error("TRANSFER_SCOPE_CHANGED");
      setPreview(value);
    } catch {
      setError(t("transferPreviewFailed"));
    } finally {
      setBusy(false);
    }
  }
  async function submit() {
    if (!preview || !canConfirmTransfer(preview, ack, reason) || busy || pendingKey) return;
    const key = crypto.randomUUID();
    savePending(key);
    setBusy(true);
    setError("");
    try {
      const payload = transferPayload(preview, ack, reason, key);
      const { target_tenant_id: _target, ...rollbackPayload } = payload;
      await complete((await axios.post(applyPath, rollback ? rollbackPayload : payload)).data);
    } catch (failure: unknown) {
      // A lost response is ambiguous: never automatically repeat the mutation.
      const status = isAxiosError(failure) ? failure.response?.status : undefined;
      if (status && status >= 400 && status < 500) {
        savePending(null);
        setPreview(null);
        setAck([]);
        setError(t("transferConflict"));
      } else setError(t("transferUnknown"));
    } finally {
      setBusy(false);
    }
  }
  async function recover() {
    if (!pendingKey) return;
    setBusy(true);
    try {
      await complete((await axios.get(`/api/v1/app-tenant-transfer-requests/${pendingKey}`)).data);
      if (mounted.current) setError("");
    } catch {
      setError(t("transferUnknown"));
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <Button
        variant="outline"
        onClick={() => {
          setRollback(false);
          if (!pendingKey) {
            setPreview(null);
            setAck([]);
          }
          setOpen(true);
        }}
      >
        {t("transferTitle")}
      </Button>
      {app.tenant_transfer && (
        <Button
          variant="outline"
          disabled={!!pendingKey}
          onClick={() => {
            setRollback(true);
            setPreview(null);
            setAck([]);
            setOpen(true);
          }}
        >
          {t("transferRollback")}
        </Button>
      )}
      <Dialog
        open={open}
        onOpenChange={(next) => {
          if (!busy && !pendingKey) setOpen(next);
        }}
      >
        <DialogContent className="max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{t(rollback ? "transferRollback" : "transferTitle")}</DialogTitle>
          </DialogHeader>
          {result ? (
            <div className="space-y-3">
              <p role="status">{t("transferSuccess", { tenant: result.to_tenant_id })}</p>
              <Button onClick={() => router.push("/apps")}>{t("back")}</Button>
            </div>
          ) : (
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">{t("transferNotice")}</p>
              <Select
                value={target}
                disabled={busy || !!pendingKey || rollback}
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
                  {workspace.tenants
                    .filter((tenant) => tenant.id !== workspace.tenant?.id)
                    .map((tenant) => (
                      <SelectItem key={tenant.id} value={String(tenant.id)}>
                        {tenant.name}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
              <Button disabled={(!target && !rollback) || busy || !!pendingKey} onClick={inspect}>
                {t("transferPreview")}
              </Button>
              {preview && (
                <div className="space-y-3">
                  <p>
                    {preview.source.tenant_name} → {preview.target.tenant_name}
                  </p>
                  <p className="text-sm">
                    {t(rollback ? "transferRollbackDefaults" : "transferDefaults")}
                  </p>
                  {preview.bindings.map((binding, index) => (
                    <p key={`${binding.kind}-${binding.id}-${index}`} className="text-sm">
                      {binding.kind}: {binding.name || binding.id} ·{" "}
                      {t(
                        binding.target_scope_available
                          ? "transferBindingAvailable"
                          : "transferBindingUnavailable"
                      )}
                    </p>
                  ))}
                  {preview.checks
                    .filter((check) => check.status !== "passed")
                    .map((check) => (
                      <p key={check.code} className="text-destructive">
                        {check.code}: {check.status}
                      </p>
                    ))}
                  {preview.blockers.length > 0 && (
                    <div role="alert">
                      <strong>{t("transferBlockers")}</strong>
                      {preview.blockers.map((item) => (
                        <p key={item.code}>
                          {item.message} ({item.code})
                        </p>
                      ))}
                    </div>
                  )}
                  {preview.warnings.map((item) => (
                    <label key={item.code} className="flex items-start gap-2 text-sm">
                      <Checkbox
                        checked={ack.includes(item.code)}
                        disabled={busy || !!pendingKey}
                        onCheckedChange={(checked) =>
                          setAck((previous) =>
                            checked === true
                              ? [...previous, item.code]
                              : previous.filter((code) => code !== item.code)
                          )
                        }
                      />
                      <span>
                        {item.message} ({item.code})
                      </span>
                    </label>
                  ))}
                  <Textarea
                    aria-label={t("transferReason")}
                    placeholder={t("transferReason")}
                    value={reason}
                    maxLength={1000}
                    disabled={busy || !!pendingKey}
                    onChange={(event) => setReason(event.target.value)}
                  />
                  <Button
                    disabled={busy || !!pendingKey || !canConfirmTransfer(preview, ack, reason)}
                    onClick={submit}
                  >
                    {t(rollback ? "transferRollbackConfirm" : "transferConfirm")}
                  </Button>
                </div>
              )}
              {error && (
                <p role="alert" className="text-destructive">
                  {error}
                </p>
              )}
              {pendingKey && (
                <Button disabled={busy} onClick={recover}>
                  {t("transferRecover")}
                </Button>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}

/** A committed transfer makes the old app URL inaccessible; status recovery must remain reachable. */
export function TransferRequestRecovery({ appId }: { appId: number }) {
  const { user, loading } = useCurrentUser();
  const workspace = useWorkspace();
  if (loading || !user?.id || !workspace.ready || !workspace.tenant) return null;
  return (
    <ScopedRecovery
      key={`${user.id}:${workspace.tenant.id}:${appId}`}
      scope={`app-transfer:${user.id}:${workspace.tenant.id}:${appId}`}
      appId={appId}
    />
  );
}
function ScopedRecovery({ scope, appId }: { scope: string; appId: number }) {
  const t = useTranslations("apps");
  const [pending, setPending] = useState<string | null>(() => {
    try {
      return sessionStorage.getItem(scope);
    } catch {
      return null;
    }
  });
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  if (!pending) return message ? <p role="status">{message}</p> : null;
  async function recover() {
    setBusy(true);
    try {
      const value: TransferResult = (
        await axios.get(`/api/v1/app-tenant-transfer-requests/${pending}`)
      ).data;
      if (!mounted.current || value.app_id !== appId) return;
      setMessage(t("transferSuccess", { tenant: value.to_tenant_id }));
      try {
        sessionStorage.removeItem(scope);
      } catch {
        /* no credentials stored */
      }
      setPending(null);
    } catch {
      if (mounted.current) setMessage(t("transferUnknown"));
    } finally {
      if (mounted.current) setBusy(false);
    }
  }
  return (
    <div className="space-y-2">
      <Button disabled={busy} onClick={recover}>
        {t("transferRecover")}
      </Button>
      {message && <p role="status">{message}</p>}
    </div>
  );
}
