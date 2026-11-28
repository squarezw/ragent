"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import type { AxiosError } from "axios";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import axios from "@/lib/axios";
import type { SharedEnv } from "@/hooks/useSkillUserEnv";

interface SharedDraft {
  keys: string[];
  values: Record<string, string>;
  revision: number;
}

interface Props {
  url: string;
  config: SharedEnv;
  update: (config?: SharedEnv) => Promise<unknown>;
}

export default function SkillSharedEnvPanel({ url, config, update }: Props) {
  const t = useTranslations("skills");
  const tc = useTranslations("common");
  const [draft, setDraft] = useState<SharedDraft | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  if (!config.configured_keys.length && !(config.can_manage && config.shareable_keys.length)) return null;

  function edit() {
    setDraft({ keys: [...config.configured_keys], values: {}, revision: config.revision });
    setError("");
  }

  async function save(endpoint: string, payload: unknown) {
    setBusy(true);
    setError("");
    try {
      const response = await axios.put<SharedEnv>(endpoint, payload, { suppressErrorToast: true } as never);
      await update(response.data);
      setDraft(null);
      toast.success(t("envSaved"));
    } catch (cause) {
      const status = (cause as AxiosError).response?.status;
      if (status === 409) {
        setDraft(null);
        await update();
      }
      const errors: Record<number, "sharedConflict" | "sharedInvalid" | "sharedUnavailable"> = {
        409: "sharedConflict", 422: "sharedInvalid", 503: "sharedUnavailable",
      };
      setError(t(errors[status ?? 0] ?? "envSaveFailed"));
    } finally {
      setBusy(false);
    }
  }

  const hasValidValues = draft?.keys.every((key) => {
    const value = draft.values[key];
    return config.shareable_keys.includes(key) &&
      (value ? Boolean(value.trim()) : config.configured_keys.includes(key));
  });
  return (
    <section className="rounded-lg bg-muted/40 px-4 py-3" aria-label={t("sharedTitle")}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        {config.configured_keys.length > 0 ? (
          <div className="flex items-center gap-3">
            <Switch id="use-organization-env" checked={config.use_organization} disabled={busy || Boolean(draft)}
              onCheckedChange={(checked) => save(url + "/preferences", {
                revision: config.revision, use_organization: checked,
              })} />
            <div>
              <label htmlFor="use-organization-env" className="cursor-pointer text-sm font-medium">{t("sharedUseOrg")}</label>
              <p className="text-xs text-muted-foreground">{t("sharedApplies", { count: config.configured_keys.length })}</p>
            </div>
          </div>
        ) : <p className="text-sm text-muted-foreground">{t("sharedEmpty")}</p>}
        {config.can_manage && !draft && (
          <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={edit}>
            {t("sharedManage")}
          </Button>
        )}
      </div>
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      {draft && config.can_manage && (
        <fieldset disabled={busy} className="mt-3 min-w-0 space-y-3 border-t pt-3">
          <p className="text-sm text-muted-foreground">{t("sharedAccessNotice")}</p>
          {[...new Set([...config.shareable_keys, ...draft.keys])].map((key) => (
            <div key={key} className="grid gap-1 sm:grid-cols-2 sm:items-center">
              <label className="flex min-w-0 items-center gap-2 text-xs">
                <input type="checkbox" checked={draft.keys.includes(key)} onChange={(e) => {
                  const values = { ...draft.values };
                  if (!e.target.checked) delete values[key];
                  setDraft({
                    ...draft, values,
                    keys: e.target.checked ? [...draft.keys, key] : draft.keys.filter((item) => item !== key),
                  });
                }} />
                <span className="break-all font-mono">{key}</span>
              </label>
              {draft.keys.includes(key) && (
                <Input type="text" spellCheck={false} autoComplete="off" aria-label={t("sharedValue", { key })}
                  placeholder={config.configured_keys.includes(key) ? t("sharedKeepValue") : t("envValuePlaceholder")}
                  value={draft.values[key] ?? ""} onChange={(e) => setDraft({
                    ...draft, values: { ...draft.values, [key]: e.target.value },
                  })} />
              )}
            </div>
          ))}
          <div className="flex flex-wrap justify-end gap-2">
            {config.configured_keys.length > 0 && (
              <Button type="button" variant="ghost" size="sm" className="mr-auto text-destructive"
                onClick={() => {
                  if (window.confirm(t("sharedClearConfirm"))) {
                    return save(url, { revision: draft.revision, keys: [], values: {} });
                  }
                }}>{t("sharedClear")}</Button>
            )}
            <Button type="button" variant="ghost" size="sm" onClick={() => setDraft(null)}>{tc("cancel")}</Button>
            <Button type="button" size="sm" disabled={busy || !hasValidValues}
              onClick={() => save(url, {
                ...draft, values: Object.fromEntries(Object.entries(draft.values).filter(([, value]) => value !== "")),
              })}>{t("sharedSave")}</Button>
          </div>
        </fieldset>
      )}
    </section>
  );
}
