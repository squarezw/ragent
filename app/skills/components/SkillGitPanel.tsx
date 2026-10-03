"use client";

import { useEffect, useId, useState } from "react";
import { useTranslations } from "next-intl";
import useSWR from "swr";
import { toast } from "sonner";
import axios from "@/lib/axios";
import { getApiErrorMessage } from "@/lib/apiError";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { ChevronDown, Github, Loader2 } from "lucide-react";

const RETURN_KEY = "github_oauth_return";

interface GitSource {
  configured: boolean;
  repo: string;
  ref: string;
  subpath: string;
  last_synced_sha: string | null;
}

interface GitConnection {
  connected: boolean;
  login: string | null;
}

async function jsonFetcher<T>(url: string): Promise<T> {
  const res = await axios.get(url, { suppressErrorToast: true } as never);
  return res.data as T;
}

export default function SkillGitPanel({
  skillId,
  canEdit,
  onSynced,
}: {
  skillId: number;
  canEdit: boolean;
  onSynced: () => void;
}) {
  const t = useTranslations("skills");
  const [open, setOpen] = useState(false);
  // 第一次展开才去拉来源和连接状态，收起后再打开保留已填的仓库信息。
  const [activated, setActivated] = useState(false);
  const contentId = useId();
  const source = useSWR(
    canEdit && activated ? `/api/v1/skills/${skillId}/git-source` : null,
    jsonFetcher<GitSource>,
    { revalidateOnFocus: false }
  );
  const connection = useSWR(
    canEdit && activated ? "/api/v1/github/connection" : null,
    jsonFetcher<GitConnection>,
    { revalidateOnFocus: false }
  );

  const [repo, setRepo] = useState("");
  const [refName, setRefName] = useState("");
  const [subpath, setSubpath] = useState("");
  const [busy, setBusy] = useState<"save" | "sync" | "connect" | "disconnect" | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);

  useEffect(() => {
    const row = source.data;
    if (!row) return;
    setRepo(row.repo || "");
    setRefName(row.ref || "");
    setSubpath(row.subpath || "");
  }, [source.data]);

  if (!canEdit) return null;

  const connect = async () => {
    setBusy("connect");
    try {
      sessionStorage.setItem(RETURN_KEY, window.location.pathname);
      const res = await axios.get("/api/v1/github/oauth/start", {
        suppressErrorToast: true,
      } as never);
      const url = res.data?.authorize_url;
      if (!url) throw new Error(t("gitConnectFailed"));
      window.location.href = url;
    } catch (error) {
      toast.error(getApiErrorMessage(error, t("gitConnectFailed")));
      setBusy(null);
    }
  };

  const disconnect = async () => {
    setBusy("disconnect");
    try {
      await axios.delete("/api/v1/github/connection", { suppressErrorToast: true } as never);
      await connection.mutate({ connected: false, login: null }, { revalidate: false });
      toast.success(t("gitDisconnected"));
    } catch (error) {
      toast.error(getApiErrorMessage(error));
    } finally {
      setBusy(null);
    }
  };

  const saveSource = async () => {
    setBusy("save");
    try {
      const res = await axios.put(
        `/api/v1/skills/${skillId}/git-source`,
        { repo, ref: refName, subpath },
        { suppressErrorToast: true } as never
      );
      await source.mutate(res.data, { revalidate: false });
      toast.success(t("gitSaved"));
      return true;
    } catch (error) {
      toast.error(getApiErrorMessage(error));
      return false;
    } finally {
      setBusy(null);
    }
  };

  const sync = async (confirm: boolean) => {
    setConfirmOpen(false);
    setBusy("sync");
    try {
      const saved = await axios.put(
        `/api/v1/skills/${skillId}/git-source`,
        { repo, ref: refName, subpath },
        { suppressErrorToast: true } as never
      );
      await source.mutate(saved.data, { revalidate: false });
      const res = await axios.post(`/api/v1/skills/${skillId}/git-sync`, { confirm }, {
        suppressErrorToast: true,
      } as never);
      const warnings: string[] = Array.isArray(res.data?.warnings) ? res.data.warnings : [];
      toast.success(t("gitSynced"));
      for (const warning of warnings) toast.message(warning);
      await source.mutate();
      onSynced();
    } catch (error) {
      const status = (error as { response?: { status?: number } })?.response?.status;
      if (status === 409) {
        setConfirmOpen(true);
      } else {
        toast.error(getApiErrorMessage(error));
      }
    } finally {
      setBusy(null);
    }
  };

  const login = connection.data?.login;
  const sha = source.data?.last_synced_sha;

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <button
            type="button"
            className="flex w-full items-center gap-2 rounded-sm text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            aria-expanded={open}
            aria-controls={contentId}
            onClick={() => {
              setActivated(true);
              setOpen((current) => !current);
            }}
          >
            <Github className="h-4 w-4 shrink-0" aria-hidden="true" />
            <span className="flex-1">{t("gitTitle")}</span>
            <ChevronDown
              className={`h-4 w-4 shrink-0 transition-transform ${open ? "rotate-180" : ""}`}
              aria-hidden="true"
            />
          </button>
        </CardTitle>
      </CardHeader>
      <div id={contentId} hidden={!open}>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">{t("gitHelp")}</p>

          <div className="flex flex-wrap items-center gap-2">
            {connection.isLoading ? (
              <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
            ) : login ? (
              <>
                <span className="text-sm">{t("gitConnected", { login })}</span>
                <Button variant="outline" size="sm" onClick={disconnect} disabled={busy !== null}>
                  {busy === "disconnect" && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                  {t("gitDisconnect")}
                </Button>
              </>
            ) : (
              <>
                <span className="text-sm text-muted-foreground">{t("gitNotConnected")}</span>
                <Button size="sm" onClick={connect} disabled={busy !== null}>
                  {busy === "connect" && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                  {t("gitConnect")}
                </Button>
              </>
            )}
          </div>

          <div className="grid gap-3 md:grid-cols-3">
            <div className="space-y-1.5">
              <Label htmlFor="git-repo">{t("gitRepo")}</Label>
              <Input
                id="git-repo"
                value={repo}
                placeholder={t("gitRepoPlaceholder")}
                onChange={(event) => setRepo(event.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="git-ref">{t("gitRef")}</Label>
              <Input
                id="git-ref"
                value={refName}
                placeholder={t("gitRefPlaceholder")}
                onChange={(event) => setRefName(event.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="git-subpath">{t("gitSubpath")}</Label>
              <Input
                id="git-subpath"
                value={subpath}
                placeholder={t("gitSubpathPlaceholder")}
                onChange={(event) => setSubpath(event.target.value)}
              />
            </div>
          </div>

          {sha ? (
            <p className="text-xs text-muted-foreground">
              {t("gitLastSync", { sha: sha.slice(0, 7) })}
            </p>
          ) : null}

          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              onClick={saveSource}
              disabled={busy !== null || !repo.trim() || !refName.trim()}
            >
              {busy === "save" && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              {t("gitSave")}
            </Button>
            <Button
              onClick={() => sync(false)}
              disabled={busy !== null || !login || !repo.trim() || !refName.trim()}
            >
              {busy === "sync" && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              {busy === "sync" ? t("gitSyncing") : t("gitSync")}
            </Button>
          </div>

          <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>{t("gitOverwriteTitle")}</AlertDialogTitle>
                <AlertDialogDescription>{t("gitOverwriteBody")}</AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>{t("gitCancel")}</AlertDialogCancel>
                <AlertDialogAction onClick={() => sync(true)}>
                  {t("gitOverwrite")}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </CardContent>
      </div>
    </Card>
  );
}
