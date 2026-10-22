"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import axios from "@/lib/axios";
import { Button } from "@/components/ui/button";

interface OfficeState {
  status: "pending" | "running" | "ready" | "failed";
  url?: string;
  expiresIn?: number;
  retryAfter?: number;
}

export function OfficeAsyncPreview({
  fileId,
  onCompatibility,
}: {
  fileId: string;
  onCompatibility: () => void;
}) {
  const t = useTranslations("common");
  const [state, setState] = useState<OfficeState>({ status: "pending" });
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    setState({ status: "pending" });
    async function request(method: "get" | "post", retry = false) {
      try {
        const result = await axios.request({
          url: `/api/file-preview/office?fileId=${encodeURIComponent(fileId)}`,
          method,
          data: method === "post" ? { retry } : undefined,
          signal: controller.signal,
        });
        if (!active) return;
        const next = result.data;
        if (next.status === "disabled" || next.status === "unsupported") {
          onCompatibility();
          return;
        }
        if (next.status === "ready" && typeof next.url === "string") {
          setState(next);
          timer = setTimeout(
            () => void request("get"),
            Math.max(1000, (Number(next.expiresIn || 300) - 30) * 1000)
          );
        } else if (next.status === "pending" || next.status === "running") {
          setState(next);
          timer = setTimeout(
            () => void request("get"),
            Math.max(1000, Math.min(10000, Number(next.retryAfter || 3) * 1000))
          );
        } else {
          setState({ status: "failed" });
        }
      } catch (error) {
        if (!active) return;
        const status = (error as { response?: { status?: number } }).response?.status;
        if (status === 404 || status === 422) onCompatibility();
        else setState({ status: "failed" });
      }
    }
    void request("post", attempt > 0);
    return () => {
      active = false;
      controller.abort();
      clearTimeout(timer);
    };
  }, [fileId, attempt, onCompatibility]);

  return (
    <div className="flex h-full flex-col gap-3">
      {state.status === "ready" && state.url ? (
        <iframe
          src={state.url}
          title={t("pdfPreview")}
          referrerPolicy="no-referrer"
          className="w-full min-h-0 flex-1 border bg-card"
        />
      ) : (
        <div className="flex flex-1 items-center justify-center text-muted-foreground">
          {t(state.status === "failed" ? "officePreviewFailed" : "officePreviewPreparing")}
        </div>
      )}
      <div className="flex justify-end gap-2">
        {state.status === "failed" && (
          <Button variant="outline" onClick={() => setAttempt((value) => value + 1)}>
            {t("officePreviewRetry")}
          </Button>
        )}
        <Button variant="outline" onClick={onCompatibility}>
          {t("previewCompatibilityMode")}
        </Button>
      </div>
    </div>
  );
}
