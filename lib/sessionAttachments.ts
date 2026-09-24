/**
 * 会话轮次里记下的用户上传附件。
 *
 * 库里是 snake_case JSON（后端 normalize_turn_attachments 的形状）。
 * 详情接口和聊天历史共用这一层，避免一边读 object_key、一边读 objectKey。
 */

export interface SessionAttachment {
  filename: string;
  objectKey: string;
  contentType?: string;
  size?: number;
}

const MIME_BY_EXT: Record<string, string> = {
  ".pdf": "application/pdf",
  ".doc": "application/msword",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".xls": "application/vnd.ms-excel",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ".csv": "text/csv",
  ".txt": "text/plain",
  ".md": "text/markdown",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".bmp": "image/bmp",
  ".tif": "image/tiff",
  ".tiff": "image/tiff",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".dxf": "application/dxf",
  ".dwg": "application/dwg",
  ".ai": "application/postscript",
};

export function normalizeSessionAttachments(raw: unknown): SessionAttachment[] {
  if (!Array.isArray(raw)) return [];
  const out: SessionAttachment[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    const objectKey = String(row.object_key ?? row.objectKey ?? "").trim();
    const filename = String(row.filename ?? "").trim();
    if (!objectKey || !filename) continue;
    const contentType = String(row.content_type ?? row.contentType ?? "").trim();
    const size = row.size;
    out.push({
      filename,
      objectKey,
      ...(contentType ? { contentType } : {}),
      ...(typeof size === "number" ? { size } : {}),
    });
  }
  return out;
}

/** content_type 有时是给气泡看的标签（"PDF"），不是 MIME。 */
function isMimeType(value: string): boolean {
  return /^[\w.+-]+\/[\w.+-]+$/.test(value);
}

/**
 * 对象存储的签名响应带 Content-Disposition: attachment。
 * iframe 直接跟着 302 走会下载，预览要改走同域 inline 流。
 */
export function attachmentPreviewUrl(url: string): string {
  if (!url.startsWith("/api/oss/")) return url;
  return `${url}${url.includes("?") ? "&" : "?"}inline=1`;
}

/** 预览对话框要 MIME；标签、空串、octet-stream 都按扩展名补。 */
export function sessionAttachmentMime(attachment: SessionAttachment): string {
  const stored = (attachment.contentType || "").split(";")[0].trim();
  if (stored && stored !== "application/octet-stream" && isMimeType(stored)) {
    return stored;
  }
  const name = attachment.filename.toLowerCase();
  const ext = Object.keys(MIME_BY_EXT).find((suffix) => name.endsWith(suffix));
  return (ext && MIME_BY_EXT[ext]) || stored || "application/octet-stream";
}
