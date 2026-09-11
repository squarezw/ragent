"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import type { DxfViewer } from "dxf-viewer";
import { Button } from "@/components/ui/button";

export default function DxfPreview({ url }: { url: string }) {
  const t = useTranslations("chat");
  const host = useRef<HTMLDivElement>(null);
  const viewer = useRef<DxfViewer | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [status, setStatus] = useState<"loading" | "ready" | "error" | "empty">("loading");
  const [layers, setLayers] = useState<{ name: string; visible: boolean }[]>([]);
  const [omitted, setOmitted] = useState(false);
  const [progress, setProgress] = useState<string>("");

  useEffect(() => {
    let disposed = false;
    const container = host.current;
    let instance: DxfViewer | null = null;
    setStatus("loading");
    setOmitted(false);
    setLayers([]);
    setProgress("");
    const timeout = window.setTimeout(() => {
      if (!disposed) { setStatus("error"); disposed = true; instance?.Destroy(); }
    }, 60000);
    void (async () => {
      try {
        const { DxfViewer } = await import("dxf-viewer");
        if (disposed || !host.current) return;
        instance = new DxfViewer(host.current, { autoResize: true });
        viewer.current = instance;
        await instance.Load({
          url: `/api/chat/preview-dxf?url=${encodeURIComponent(url)}`,
          fonts: ["/fonts/dxf/NotoSansSC.ttf"],
          workerFactory: () => {
            const worker = new Worker(new URL("./dxf.worker.js", import.meta.url));
            worker.addEventListener("message", event => {
              if (!disposed && event.data?.type === "dxf-preview-omitted-hatch") setOmitted(true);
            });
            return worker;
          },
          progressCbk: (phase, loaded, total) => {
            if (!disposed) setProgress(phase === "fetch" ? `${t("dxfDownload")}${total > 0 ? ` ${Math.round(loaded / total * 100)}%` : "…"}` : t("dxfParse"));
          },
        });
        if (disposed) return;
        setLayers(instance.GetLayers().map(layer => ({ name: layer.name, visible: true })));
        setStatus(instance.GetBounds() ? "ready" : "empty");
      } catch {
        if (!disposed) setStatus("error");
      } finally { window.clearTimeout(timeout); }
    })();
    return () => { disposed = true; window.clearTimeout(timeout); if (viewer.current === instance) viewer.current = null; instance?.Destroy(); container?.replaceChildren(); };
  }, [url, attempt, t]);

  const fit = () => {
    const v = viewer.current;
    const b = v?.GetBounds();
    if (!v || !b) return;
    const o = v.GetOrigin();
    v.FitView(b.minX - o.x, b.maxX - o.x, b.minY - o.y, b.maxY - o.y);
    v.Render();
  };
  return <div className="flex h-full min-h-0 flex-col">
    <div className="flex flex-wrap gap-2 border-b p-2">
      <Button variant="outline" size="sm" disabled={status !== "ready"} onClick={fit}>{t("dxfFit")}</Button>
      <Button variant="outline" size="sm" onClick={() => setAttempt(n => n + 1)}>{t("previewRetry")}</Button>
      {layers.length > 0 && <details className="relative">
        <summary className="cursor-pointer p-2 text-sm">{t("dxfLayers")}</summary>
        <div className="absolute left-0 top-full z-20 max-h-64 min-w-40 overflow-auto rounded border bg-background p-2 shadow">
          {layers.map(layer => <label key={layer.name} className="flex gap-2 p-1 text-sm">
            <input type="checkbox" checked={layer.visible} onChange={event => {
              const visible = event.target.checked;
              viewer.current?.ShowLayer(layer.name, visible);
              setLayers(current => current.map(item => item.name === layer.name ? { ...item, visible } : item));
            }} />{layer.name}
          </label>)}
        </div>
      </details>}
    </div>
    <div className="relative min-h-0 flex-1">
      <div ref={host} style={{ width: "100%", height: "100%" }} />
      {status !== "ready" && <div role="status" className="absolute inset-0 flex items-center justify-center bg-background/90 p-4 text-sm">
        {status === "error" ? t("dxfFailed") : status === "empty" ? t("dxfEmpty") : progress || t("dxfLoading")}
      </div>}
    </div>
    <p className="border-t p-2 text-xs text-muted-foreground">{omitted ? t("dxfOmitted") + " " : ""}{t("dxfNote")}</p>
  </div>;
}
