"use client";

import { ExternalLink, LoaderCircle, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import styles from "./ResourcePreviewPanel.module.css";
import type { PreviewResource } from "@/lib/chatResourcePreview";
import { Button } from "@/components/ui/button";

interface ResourcePreviewPanelProps {
  resource: PreviewResource;
  onClose: () => void;
}

function getEmbedUrl(resource: PreviewResource): string {
  if (resource.kind !== "url") return resource.url;
  try {
    const url = new URL(resource.url);
    if (url.protocol === "https:" && url.hostname.endsWith(".cos.ap-shanghai.myqcloud.com") && url.pathname.startsWith("/skill-artifacts/") && url.pathname.toLowerCase().endsWith(".html") && url.searchParams.has("X-Amz-Signature")) {
      return `/api/chat/preview-artifact?url=${encodeURIComponent(resource.url)}`;
    }
  } catch {
    // Keep the original URL as the fallback.
  }
  return resource.url;
}

export default function ResourcePreviewPanel({ resource, onClose }: ResourcePreviewPanelProps) {
  const t = useTranslations("chat");
  const [loading, setLoading] = useState(resource.kind === "url");
  const [embedWarning, setEmbedWarning] = useState(false);
  const [imageError, setImageError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [panelWidth, setPanelWidth] = useState<number | null>(null);
  const [resizing, setResizing] = useState(false);
  const dragOrigin = useRef({ x: 0, width: 0 });
  const panelRef = useRef<HTMLDivElement>(null);
  const clampWidth = (width: number) => Math.min(Math.max(width, 360), window.innerWidth < 600 ? window.innerWidth : window.innerWidth - 240);

  useEffect(() => {
    const handleResize = () => setPanelWidth(width => width === null ? null : clampWidth(width));
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  useEffect(() => {
    setLoading(resource.kind === "url");
    setEmbedWarning(false);
    setImageError(false);
  }, [resource, attempt]);

  useEffect(() => {
    if (resource.kind !== "url" || !loading) return;

    const timeoutId = window.setTimeout(() => {
      setLoading(false);
      setEmbedWarning(true);
    }, 35000);
    return () => window.clearTimeout(timeoutId);
  }, [loading, resource.kind, resource.url, attempt]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  const title = resource.kind === "image" ? t("imagePreview") : t("webPreview");
  const embedUrl = getEmbedUrl(resource);

  return (
    <Dialog.Root open onOpenChange={(open) => { if (!open) onClose(); }}>
    <Dialog.Portal>
    <Dialog.Overlay className={styles.overlay} />
    <Dialog.Content ref={panelRef} aria-describedby={undefined} className={styles.panel} style={panelWidth === null ? undefined : { width: panelWidth }}>
      <div
        role="separator"
        tabIndex={0}
        aria-label={t("resizePreview")}
        aria-orientation="vertical"
        aria-valuemin={360}
        aria-valuemax={typeof window === "undefined" ? 1200 : Math.max(360, window.innerWidth - 240)}
        aria-valuenow={Math.round(panelWidth ?? (typeof window === "undefined" ? 456 : Math.max(420, window.innerWidth * 0.38)))}
        className={styles.resizeHandle}
        onPointerDown={event => {
          if (event.button !== 0) return;
          event.preventDefault();
          event.currentTarget.focus();
          dragOrigin.current = { x: event.clientX, width: panelRef.current?.getBoundingClientRect().width ?? 456 };
          event.currentTarget.setPointerCapture(event.pointerId);
          setResizing(true);
        }}
        onPointerMove={event => {
          if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
          setPanelWidth(clampWidth(dragOrigin.current.width + dragOrigin.current.x - event.clientX));
        }}
        onPointerUp={event => {
          if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
          setResizing(false);
        }}
        onPointerCancel={() => setResizing(false)}
        onLostPointerCapture={() => setResizing(false)}
        onKeyDown={event => {
          if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
          event.preventDefault();
          setPanelWidth(clampWidth((panelRef.current?.getBoundingClientRect().width ?? 456) + (event.key === "ArrowLeft" ? 32 : -32)));
        }}
      />
      <div className="flex items-center justify-between gap-3 border-b px-4 py-3">
        <div className="min-w-0">
          <Dialog.Title className="font-semibold">{title}</Dialog.Title>
          <p className="truncate text-xs text-muted-foreground">{new URL(resource.url).hostname}</p>
        </div>
        <Button
          aria-label={t("closePreview")}
          className="shrink-0"
          onClick={onClose}
          size="icon"
          type="button"
          variant="ghost"
        >
          <X />
        </Button>
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-3 p-4">
        <div className="relative min-h-0 flex-1 overflow-hidden rounded-md border bg-muted">
          {resource.kind === "image" ? (
            imageError ? (
              <p className="p-4 text-sm text-muted-foreground">{t("imageLoadFailed")}</p>
            ) : (
              // Resource URLs are supplied by Markdown and may use arbitrary hosts.
              // biome-ignore lint/performance/noImgElement: Next image optimization cannot be configured per chat URL
              <img
                alt={resource.alt || t("imagePreview")}
                className="h-full w-full object-contain"
                onError={() => setImageError(true)}
                src={embedUrl}
              />
            )
          ) : (
            <>
              {loading && (
                <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 bg-background/80 text-sm text-muted-foreground">
                  <div className="absolute inset-x-0 top-0 h-1 overflow-hidden bg-muted">
                    <div className="h-full w-1/3 animate-pulse bg-primary" />
                  </div>
                  <div className="flex items-center gap-2">
                    <LoaderCircle className="size-4 animate-spin" />
                    {t("previewLoading")}
                  </div>
                </div>
              )}
              <iframe
                style={resizing ? { pointerEvents: "none" } : undefined}
                key={`${resource.url}:${attempt}`}
                className="h-full w-full bg-background"
                onError={() => {
                  setLoading(false);
                  setEmbedWarning(true);
                }}
                onLoad={() => { setLoading(false); setEmbedWarning(false); }}
                referrerPolicy="no-referrer"
                sandbox="allow-forms allow-popups allow-scripts"
                src={embedUrl}
                title={t("webPreview")}
              />
            </>
          )}
        </div>

        {resource.kind === "url" && embedWarning && (
          <p aria-live="polite" className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
            {t("previewMayNotEmbed")}
          </p>
        )}
        {resource.kind === "url" && <Button onClick={() => setAttempt(value => value + 1)} variant="outline">{t("previewRetry")}</Button>}

        <Button asChild className="w-full" variant="outline">
          <a href={resource.url} rel="noopener noreferrer" target="_blank">
            <ExternalLink />
            {t("openInNewTab")}
          </a>
        </Button>
      </div>
    </Dialog.Content>
    </Dialog.Portal>
    </Dialog.Root>
  );
}
