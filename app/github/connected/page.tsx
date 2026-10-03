"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import axios from "@/lib/axios";
import { getApiErrorMessage } from "@/lib/apiError";
import { Loader2 } from "lucide-react";

const RETURN_KEY = "github_oauth_return";

export default function GithubConnectedPage() {
  const router = useRouter();
  const t = useTranslations("skills");
  const [message, setMessage] = useState("");

  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    const params = new URLSearchParams(window.location.search);
    const code = params.get("code");
    const state = params.get("state");
    const error = params.get("error_description") || params.get("error");
    const back = sessionStorage.getItem(RETURN_KEY) || "/skills";

    if (!code || !state) {
      const text = error || t("gitConnectMissing");
      setMessage(text);
      toast.error(text);
      return;
    }

    setMessage(t("gitConnecting"));
    axios
      .post("/api/v1/github/oauth/exchange", { code, state }, { suppressErrorToast: true } as never)
      .then((res) => {
        const login = res.data?.login || "";
        toast.success(t("gitConnectOk", { login }));
        sessionStorage.removeItem(RETURN_KEY);
        router.replace(back);
      })
      .catch((err) => {
        const detail = getApiErrorMessage(err, t("gitConnectFailed"));
        setMessage(detail);
        toast.error(detail);
      });
  }, [router, t]);

  return (
    <div className="container mx-auto p-6">
      <div className="flex items-center gap-2 text-muted-foreground">
        {(!message || message === t("gitConnecting")) && <Loader2 className="h-4 w-4 animate-spin" />}
        <span>{message || t("gitConnecting")}</span>
      </div>
    </div>
  );
}
