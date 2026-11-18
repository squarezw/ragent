export type PreviewResource =
  | { kind: "image"; url: string; alt?: string }
  | { kind: "url" | "dxf"; url: string }
  | { kind: "audio" | "video"; url: string; filename?: string };

/** Only WAV and MP4 opt into native playback; other file behavior is unchanged. */
export function chatMediaKind(name: string, mimetype = ""): "audio" | "video" | null {
  const mime = mimetype.split(";")[0].trim().toLowerCase();
  try {
    const filename = decodeURIComponent(name.split(/[?#]/)[0]);
    if (/\.wav$/i.test(filename)) return "audio";
    if (/\.mp4$/i.test(filename)) return "video";
  } catch { return null; }
  if (["audio/wav", "audio/x-wav", "audio/wave", "audio/vnd.wave"].includes(mime)) return "audio";
  return mime === "video/mp4" ? "video" : null;
}

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

    const mediaKind = kind === "url"
      ? chatMediaKind(url.searchParams.get("filename") || url.searchParams.get("file") || url.pathname) || chatMediaKind(alt || "")
      : null;
    if (mediaKind) return {kind: mediaKind, url: local ? url.pathname + url.search : url.href, ...(alt ? {filename: alt} : {})};

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
export function attachmentPreviewResource(file: { filename: string; url?: string; objectKey?: string; object_key?: string; type?: string; contentType?: string; content_type?: string }): PreviewResource | null {
  const media = chatMediaKind(file.filename, file.contentType || file.content_type || file.type);
  if (media) {
    const key = file.objectKey || file.object_key;
    const target = toPreviewResource(media, key ? `/api/oss/${key}` : file.url);
    return target ? {...target, filename: file.filename} as PreviewResource : null;
  }
  if (!/\.(dxf|html?|png|jpe?g|gif|webp|bmp|svg)$/i.test(file.filename)) return null;
  const kind = /\.dxf$/i.test(file.filename) ? "dxf" : /\.html?$/i.test(file.filename) ? "url" : "image";
  return toPreviewResource(kind, file.url, file.filename);
}

/** All files outside the supported preview list use normal downloads in Chat. */
export function isChatDownloadOnly(name: string, _mimetype = ""): boolean {
  if (chatMediaKind(name, _mimetype)) return false;
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
