"use client";

import useSWR from "swr";
import { useState } from "react";
import { useTranslations } from "next-intl";
import { isAxiosError } from "axios";
import axios from "@/lib/axios";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";

export function ClearLoginStateButton({ skillId }: { skillId: number }) {
  const t = useTranslations("skills");
  const [busy, setBusy] = useState(false);
  const clear = async () => {
    if (!window.confirm(t("execLoginClearConfirm"))) return;
    setBusy(true);
    try {
      await axios.delete(`/api/v1/skills/${skillId}/login-state`);
      toast.success(t("execLoginCleared"));
    } catch (error: unknown) {
      const detail = isAxiosError(error) ? error.response?.data?.detail : null;
      toast.error(typeof detail === "string" ? detail : t("execLoginClearFailed"));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Button type="button" variant="outline" size="sm" disabled={busy} onClick={clear}>
      {t("execLoginClear")}
    </Button>
  );
}

export default function SkillLoginStatePanel({ skillId }: { skillId: number }) {
  const t = useTranslations("skills");
  const { data } = useSWR(
    `/api/v1/skills/${skillId}/login-state`,
    async (url) => (await axios.get<{ enabled: boolean; has_state?: boolean }>(url)).data
  );
  if (!data?.enabled && !data?.has_state) return null;
  return (
    <div className="rounded-md border p-4 flex items-center justify-between gap-4">
      <div>
        <p className="text-sm font-medium">{t("execLoginState")}</p>
        <p className="text-xs text-muted-foreground">{t("execLoginPersonalHint")}</p>
      </div>
      <ClearLoginStateButton skillId={skillId} />
    </div>
  );
}
