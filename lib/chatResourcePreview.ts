export type PreviewResource =
  | { kind: "image"; url: string; alt?: string }
  | { kind: "url" | "dxf"; url: string };

export function toPreviewResource(
  kind: PreviewResource["kind"],
  rawUrl: string | undefined,
  alt?: string
): PreviewResource | null {
  if (!rawUrl) return null;

  try {
    const local = rawUrl.startsWith("/api/oss/");
    const url = new URL(rawUrl, local ? "https://local.invalid" : undefined);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;

    // Only explicit supported file types enter the chat preview.
    if (kind === "url") {
      const name = alt || url.searchParams.get("filename") || url.searchParams.get("file") || decodeURIComponent(url.pathname);
      if (isChatDownloadOnly(name)) return null;
    }
    const href = local ? url.pathname + url.search : url.href;
    if (kind === "url" && /\.dxf$/i.test(url.pathname)) return { kind: "dxf", url: href };
    if (kind === "url" && /\.(png|jpe?g|gif|webp|bmp|svg)$/i.test(url.pathname)) return { kind: "image", url: href };
    return kind === "image"
      ? { kind, url: href, ...(alt ? { alt } : {}) }
      : { kind, url: href };
  } catch {
    return null;
  }
}

/** Only these attachments opt into the chat side panel. */
export function attachmentPreviewResource(file: { filename: string; url?: string }): PreviewResource | null {
  if (!/\.(dxf|html?|png|jpe?g|gif|webp|bmp|svg)$/i.test(file.filename)) return null;
  const kind = /\.dxf$/i.test(file.filename) ? "dxf" : /\.html?$/i.test(file.filename) ? "url" : "image";
  return toPreviewResource(kind, file.url, file.filename);
}

/** All files outside the supported preview list use normal downloads in Chat. */
export function isChatDownloadOnly(name: string, _mimetype = ""): boolean {
  try {
    return !/\.(html?|dxf|png|jpe?g|gif|webp|bmp|svg)$/i.test(decodeURIComponent(name.split(/[?#]/)[0]));
  } catch { return true; }
}

export function downloadChatLink(url: string, filename = ""): void {
  const parsed = new URL(url, window.location.origin);
  if (!["http:", "https:"].includes(parsed.protocol)) return;
  const link = document.createElement("a");
  link.href = parsed.href;
  link.download = filename;
  link.target = "_blank";
  link.rel = "noopener noreferrer";
  document.body.appendChild(link);
  link.click();
  link.remove();
}
