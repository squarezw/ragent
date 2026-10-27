"use client";
import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { checkSuperAdmin, checkTenantAdmin } from "@/lib/clientPermissions";
import axios from "@/lib/axios";
import { modelPayload, type ModelDraft, type TenantModel } from "@/lib/tenantModels";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";

const emptyDraft = (): ModelDraft => ({
  display_name: "",
  api_model: "",
  base_url: "",
  auth_mode: "none",
  api_key: "",
  clear_api_key: false,
  supports_tools: true,
  supports_images: false,
  enabled: true,
});

export function TenantModelsManager() {
  const { user } = useCurrentUser();
  const t = useTranslations("settings");
  const superAdmin = checkSuperAdmin(user);
  const allowed = superAdmin || checkTenantAdmin(user);
  const [tenantId, setTenantId] = useState("");
  const [tenants, setTenants] = useState<{ id: number; name: string }[]>([]);
  const [models, setModels] = useState<TenantModel[]>([]);
  const [editing, setEditing] = useState<TenantModel | null>(null);
  const [draft, setDraft] = useState<ModelDraft | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    setTenantId(user?.tenant_id ? String(user.tenant_id) : "");
    setDraft(null);
    setModels([]);
    if (!user?.id || !allowed || !superAdmin) return;
    let active = true;
    axios
      .get("/api/organization/tenants")
      .then((response) => {
        if (active) setTenants(response.data?.tenants || []);
      })
      .catch(() => {
        if (active) setTenants([]);
      });
    return () => {
      active = false;
    };
  }, [user?.id, user?.tenant_id, allowed, superAdmin]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: revision intentionally reloads after a successful mutation.
  useEffect(() => {
    setModels([]);
    setDraft(null);
    setEditing(null);
    setError("");
    if (!allowed || !tenantId) return;
    let active = true;
    axios
      .get(`/api/v1/llm-models/custom?owner_tenant_id=${Number(tenantId)}`)
      .then((response) => {
        if (active) setModels(response.data?.items || []);
      })
      .catch(() => {
        if (active) setError(t("tenantModelsLoadFailed"));
      });
    return () => {
      active = false;
    };
  }, [allowed, tenantId, revision, t]);
  if (!allowed) return null;
  const beginEdit = (model: TenantModel) => {
    setEditing(model);
    setDraft({
      display_name: model.display_name,
      api_model: model.api_model,
      base_url: model.base_url,
      auth_mode: model.auth_mode,
      supports_tools: model.supports_tools,
      supports_images: model.supports_images,
      enabled: model.enabled,
      api_key: "",
      clear_api_key: false,
    });
    setError("");
  };
  const failure = (reason: unknown) => {
    const detail = (reason as { response?: { data?: { detail?: unknown } } }).response?.data
      ?.detail;
    setError(typeof detail === "string" ? detail : t("tenantModelsSaveFailed"));
  };
  const save = async () => {
    if (!draft || !tenantId) return;
    if (draft.auth_mode === "bearer" && !draft.api_key.trim() && !editing?.has_api_key) {
      setError(t("tenantModelsKeyRequired"));
      return;
    }
    setBusy(true);
    setError("");
    try {
      const payload = modelPayload(draft, !!editing, Number(tenantId));
      if (editing)
        await axios.patch(`/api/v1/llm-models/custom/${encodeURIComponent(editing.code)}`, payload);
      else await axios.post("/api/v1/llm-models/custom", payload);
      setDraft(null);
      setRevision((value) => value + 1);
      window.dispatchEvent(new Event("ragent:models-updated"));
    } catch (reason) {
      failure(reason);
    } finally {
      setBusy(false);
    }
  };
  const toggle = async (model: TenantModel) => {
    setBusy(true);
    setError("");
    try {
      await axios.patch(`/api/v1/llm-models/custom/${encodeURIComponent(model.code)}`, {
        enabled: !model.enabled,
      });
      setRevision((value) => value + 1);
      window.dispatchEvent(new Event("ragent:models-updated"));
    } catch (reason) {
      failure(reason);
    } finally {
      setBusy(false);
    }
  };
  const remove = async (model: TenantModel) => {
    if (!window.confirm(t("tenantModelsDeleteConfirm"))) return;
    setBusy(true);
    setError("");
    try {
      await axios.delete(`/api/v1/llm-models/custom/${encodeURIComponent(model.code)}`);
      setRevision((value) => value + 1);
      window.dispatchEvent(new Event("ragent:models-updated"));
    } catch (reason) {
      failure(reason);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("tenantModelsTitle")}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">{t("tenantModelsDescription")}</p>
        {superAdmin && (
          <label className="block space-y-1">
            <span>{t("tenantModelsTenant")}</span>
            <select
              className="w-full rounded border bg-background p-2"
              value={tenantId}
              disabled={busy}
              onChange={(event) => setTenantId(event.target.value)}
            >
              <option value="">{t("tenantModelsChooseTenant")}</option>
              {tenants.map((tenant) => (
                <option key={tenant.id} value={tenant.id}>
                  {tenant.name}
                </option>
              ))}
            </select>
          </label>
        )}
        {error && (
          <p role="alert" className="text-destructive">
            {error}
          </p>
        )}
        {!tenantId ? (
          <p>{t("tenantModelsChooseTenant")}</p>
        ) : (
          <>
            {models.map((model) => (
              <div
                key={model.code}
                className="flex flex-wrap items-center justify-between gap-2 rounded border p-3"
              >
                <div>
                  <p>
                    {model.display_name} ·{" "}
                    {model.enabled ? t("tenantModelsEnabled") : t("tenantModelsDisabled")}
                  </p>
                  <p className="text-sm text-muted-foreground">
                    {model.api_model} ·{" "}
                    {model.has_api_key ? t("tenantModelsKeyStored") : t("tenantModelsNoKey")}
                  </p>
                </div>
                <div className="flex gap-2">
                  <Button variant="outline" disabled={busy} onClick={() => beginEdit(model)}>
                    {t("tenantModelsEdit")}
                  </Button>
                  <Button variant="outline" disabled={busy} onClick={() => toggle(model)}>
                    {model.enabled ? t("tenantModelsDisable") : t("tenantModelsEnable")}
                  </Button>
                  <Button variant="outline" disabled={busy} onClick={() => remove(model)}>
                    {t("tenantModelsDelete")}
                  </Button>
                </div>
              </div>
            ))}
            {!draft && (
              <Button
                disabled={busy}
                onClick={() => {
                  setEditing(null);
                  setDraft(emptyDraft());
                }}
              >
                {t("tenantModelsAdd")}
              </Button>
            )}
          </>
        )}
        {draft && (
          <form
            className="space-y-3 rounded border p-4"
            onSubmit={(event) => {
              event.preventDefault();
              void save();
            }}
          >
            <p className="text-sm text-muted-foreground">{t("tenantModelsCompatible")}</p>
            <label htmlFor="tenant-model-name" className="block space-y-1">
              <span>{t("tenantModelsName")}</span>
              <Input
                id="tenant-model-name"
                required
                value={draft.display_name}
                onChange={(event) => setDraft({ ...draft, display_name: event.target.value })}
              />
            </label>
            <label htmlFor="tenant-model-base" className="block space-y-1">
              <span>{t("tenantModelsBaseUrl")}</span>
              <Input
                id="tenant-model-base"
                required
                type="url"
                placeholder="http://your-server:8086/v1"
                value={draft.base_url}
                onChange={(event) => setDraft({ ...draft, base_url: event.target.value })}
              />
            </label>
            <label htmlFor="tenant-model-id" className="block space-y-1">
              <span>{t("tenantModelsModelId")}</span>
              <Input
                id="tenant-model-id"
                required
                placeholder="Qwen3.8-Flash-Next"
                value={draft.api_model}
                onChange={(event) => setDraft({ ...draft, api_model: event.target.value })}
              />
            </label>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={draft.auth_mode === "bearer"}
                onChange={(event) =>
                  setDraft({
                    ...draft,
                    auth_mode: event.target.checked ? "bearer" : "none",
                    clear_api_key: false,
                  })
                }
              />
              {t("tenantModelsUseKey")}
            </label>
            {draft.auth_mode === "bearer" && (
              <label htmlFor="tenant-model-key" className="block space-y-1">
                <span>
                  {editing?.has_api_key ? t("tenantModelsReplaceKey") : t("tenantModelsKey")}
                </span>
                <Input
                  id="tenant-model-key"
                  type="password"
                  autoComplete="new-password"
                  value={draft.api_key}
                  onChange={(event) => setDraft({ ...draft, api_key: event.target.value })}
                />
              </label>
            )}
            {editing?.has_api_key && (
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={draft.clear_api_key}
                  onChange={(event) =>
                    setDraft({
                      ...draft,
                      clear_api_key: event.target.checked,
                      auth_mode: event.target.checked ? "none" : draft.auth_mode,
                      api_key: "",
                    })
                  }
                />
                {t("tenantModelsClearKey")}
              </label>
            )}
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={draft.supports_tools}
                onChange={(event) => setDraft({ ...draft, supports_tools: event.target.checked })}
              />
              {t("tenantModelsTools")}
            </label>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={draft.supports_images}
                onChange={(event) => setDraft({ ...draft, supports_images: event.target.checked })}
              />
              {t("tenantModelsImages")}
            </label>
            <div className="flex gap-2">
              <Button type="submit" disabled={busy}>
                {t("tenantModelsSave")}
              </Button>
              <Button
                type="button"
                variant="outline"
                disabled={busy}
                onClick={() => setDraft(null)}
              >
                {t("tenantModelsCancel")}
              </Button>
            </div>
          </form>
        )}
      </CardContent>
    </Card>
  );
}
