export type PreviewResource =
  | { kind: "image"; url: string; alt?: string }
  | { kind: "url"; url: string };

export function toPreviewResource(
  kind: PreviewResource["kind"],
  rawUrl: string | undefined,
  alt?: string
): PreviewResource | null {
  if (!rawUrl) return null;

  try {
    const url = new URL(rawUrl);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;

    return kind === "image"
      ? { kind, url: url.href, ...(alt ? { alt } : {}) }
      : { kind, url: url.href };
  } catch {
    return null;
  }
}
