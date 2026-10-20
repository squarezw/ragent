/** Server-only, bounded best-effort cache. Call only after live file authorization. */
interface ProxyLink {
  url: string;
  expiresIn: number;
}
interface SignRequest {
  objectKey: string;
  expiresIn: number;
  responseContentDisposition: string;
  responseContentType: string;
}
type Signer = (request: SignRequest, options: { signal: AbortSignal }) => Promise<{ url: string }>;
interface FileMetadata {
  objectKey?: string;
  mimetype: string;
  filename: string | null;
}

const previewTypes = new Map([
  ["application/pdf", "document.pdf"],
  ["image/png", "image.png"],
  ["image/jpeg", "image.jpg"],
  ["image/webp", "image.webp"],
  ["image/gif", "image.gif"],
]);

export function previewDisposition(filename: string | null, mimetype = "application/pdf"): string {
  const fallback = previewTypes.get(mimetype) || "file";
  const name = Array.from(filename || fallback)
    .slice(0, 80)
    .map((char) =>
      char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127 || char === "/" || char === "\\"
        ? "_"
        : char
    )
    .join("");
  const encoded = encodeURIComponent(name).replace(
    /[!'()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`
  );
  return `inline; filename="${fallback}"; filename*=UTF-8''${encoded}`;
}

export const pdfDisposition = (filename: string | null) => previewDisposition(filename);

export async function inspectDirectPreviewResponse(
  url: string,
  signal: AbortSignal,
  mimetype: string,
  request: typeof fetch = fetch
): Promise<boolean> {
  if (!previewTypes.has(mimetype)) return false;
  const response = await request(url, {
    headers: { Range: "bytes=0-0" },
    signal,
    redirect: "error",
  });
  try {
    return (
      (response.status === 200 || response.status === 206) &&
      response.headers.get("content-type")?.split(";")[0].trim().toLowerCase() === mimetype &&
      /^inline(?:;|$)/i.test(response.headers.get("content-disposition")?.trim() || "") &&
      response.headers.get("x-cos-force-download")?.toLowerCase() !== "true"
    );
  } finally {
    await response.body?.cancel();
  }
}

export const inspectDirectPdfResponse = (
  url: string,
  signal: AbortSignal,
  request: typeof fetch = fetch
) => inspectDirectPreviewResponse(url, signal, "application/pdf", request);

export function createDirectPreviewResolver(
  capacity = 200,
  inspect: (
    url: string,
    signal: AbortSignal,
    mimetype: string
  ) => Promise<boolean> = inspectDirectPreviewResponse
) {
  const cache = new Map<string, { url: string; expiresAt: number }>();
  return async (
    proxy: ProxyLink,
    file: FileMetadata,
    sign: Signer,
    now = Date.now()
  ): Promise<ProxyLink & { fallbackUrl?: string }> => {
    if (!file.objectKey || !previewTypes.has(file.mimetype)) return proxy;
    const cached = cache.get(proxy.url);
    if (cached && cached.expiresAt - now > 120_000) {
      return {
        url: cached.url,
        fallbackUrl: proxy.url,
        expiresIn: Math.min(proxy.expiresIn, Math.floor((cached.expiresAt - now) / 1000)),
      };
    }
    cache.delete(proxy.url);
    try {
      const disposition = previewDisposition(file.filename, file.mimetype);
      const signal = AbortSignal.timeout(3000);
      const { url } = await sign(
        {
          objectKey: file.objectKey,
          expiresIn: proxy.expiresIn,
          responseContentDisposition: disposition,
          responseContentType: file.mimetype,
        },
        { signal }
      );
      const parsed = new URL(url);
      // An older gateway can silently ignore new request fields. Keep proxy delivery in that case.
      if (
        parsed.protocol !== "https:" ||
        parsed.username ||
        parsed.password ||
        !parsed.searchParams.get("X-Amz-Signature") ||
        parsed.searchParams.get("response-content-disposition") !== disposition ||
        parsed.searchParams.get("response-content-type") !== file.mimetype
      )
        return proxy;
      const signedAt = parsed.searchParams.get("X-Amz-Date") || "";
      if (!/^\d{8}T\d{6}Z$/.test(signedAt)) return proxy;
      const date = `${signedAt.slice(0, 4)}-${signedAt.slice(4, 6)}-${signedAt.slice(6, 8)}T${signedAt.slice(9, 11)}:${signedAt.slice(11, 13)}:${signedAt.slice(13, 15)}Z`;
      const ttl = Number(parsed.searchParams.get("X-Amz-Expires"));
      if (!Number.isFinite(ttl) || ttl <= 0 || ttl > 1800) return proxy;
      const expiresAt = Math.min(now + proxy.expiresIn * 1000, Date.parse(date) + ttl * 1000);
      if (!Number.isFinite(expiresAt)) return proxy;
      const expiresIn = Math.floor((expiresAt - Date.now()) / 1000);
      if (expiresIn <= 120 || !(await inspect(url, signal, file.mimetype))) return proxy;
      for (const [key, entry] of cache) if (entry.expiresAt <= now) cache.delete(key);
      cache.set(proxy.url, { url, expiresAt });
      while (cache.size > capacity) {
        const oldest = cache.keys().next().value;
        if (oldest === undefined) break;
        cache.delete(oldest);
      }
      return { url, fallbackUrl: proxy.url, expiresIn };
    } catch {
      // Signing or encoding failure must not break existing preview delivery.
      return proxy;
    }
  };
}
export const resolveDirectPreviewLink = createDirectPreviewResolver();
