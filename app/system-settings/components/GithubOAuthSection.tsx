"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import useSWR from "swr";
import { toast } from "sonner";
import { Github } from "lucide-react";
import axios from "@/lib/axios";
import { getApiErrorMessage } from "@/lib/apiError";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface OAuthConfig {
  configured: boolean;
  client_id: string;
  redirect_uri: string;
  has_secret: boolean;
}

async function loadConfig(url: string): Promise<OAuthConfig> {
  const res = await axios.get(url, { suppressErrorToast: true } as never);
  return res.data as OAuthConfig;
}

export default function GithubOAuthSection() {
  const t = useTranslations("systemSettings");
  const config = useSWR("/api/v1/github/oauth/config", loadConfig, { revalidateOnFocus: false });
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [redirectUri, setRedirectUri] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const row = config.data;
    if (!row) return;
    setClientId(row.client_id || "");
    setRedirectUri(row.redirect_uri || "");
    setClientSecret("");
  }, [config.data]);

  const save = async () => {
    setSaving(true);
    try {
      const res = await axios.put(
        "/api/v1/github/oauth/config",
        { client_id: clientId, client_secret: clientSecret, redirect_uri: redirectUri },
        { suppressErrorToast: true } as never
      );
      await config.mutate(res.data, { revalidate: false });
      setClientSecret("");
      toast.success(t("githubOAuthSaved"));
    } catch (error) {
      toast.error(getApiErrorMessage(error, t("githubOAuthSaveFailed")));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card className="break-inside-avoid">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Github className="h-4 w-4" />
          {t("githubOAuthTitle")}
        </CardTitle>
        <CardDescription className="text-xs text-muted-foreground">
          {t("githubOAuthDesc")}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="space-y-2">
          <Label htmlFor="github_client_id" className="text-xs">
            {t("githubClientId")}
          </Label>
          <Input
            id="github_client_id"
            value={clientId}
            onChange={(event) => setClientId(event.target.value)}
            placeholder="Ov23..."
            autoComplete="off"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="github_client_secret" className="text-xs">
            {t("githubClientSecret")}
          </Label>
          <Input
            id="github_client_secret"
            type="password"
            value={clientSecret}
            onChange={(event) => setClientSecret(event.target.value)}
            placeholder={config.data?.has_secret ? t("githubSecretKept") : t("githubSecretPlaceholder")}
            autoComplete="new-password"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="github_redirect_uri" className="text-xs">
            {t("githubRedirectUri")}
          </Label>
          <Input
            id="github_redirect_uri"
            value={redirectUri}
            onChange={(event) => setRedirectUri(event.target.value)}
            placeholder="http://localhost:3000/github/connected"
          />
          <p className="text-xs text-muted-foreground">{t("githubRedirectHelp")}</p>
        </div>
        <Button onClick={save} disabled={saving || !clientId.trim()} size="sm">
          {saving ? t("saving") : t("saveSettings")}
        </Button>
      </CardContent>
    </Card>
  );
}
