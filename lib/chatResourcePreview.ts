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

/** Only these attachments opt into the chat side panel; Office keeps its existing flow. */
export function attachmentPreviewResource(file: { filename: string; url?: string }): PreviewResource | null {
  if (!/\.(dxf|html?|png|jpe?g|gif|webp|bmp|svg)$/i.test(file.filename)) return null;
  const kind = /\.dxf$/i.test(file.filename) ? "dxf" : /\.html?$/i.test(file.filename) ? "url" : "image";
  return toPreviewResource(kind, file.url, file.filename);
}
