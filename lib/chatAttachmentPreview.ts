import { attachmentPreviewUrl, sessionAttachmentMime } from "./sessionAttachments";
import { isChatDownloadOnly } from "./chatResourcePreview";

interface ChatAttachmentSource {
  filename: string;
  url?: string;
  objectKey?: string;
  object_key?: string;
  type?: string;
  contentType?: string;
  content_type?: string;
}

/** Message uploads use the same authenticated inline stream as session previews. */
export function chatAttachmentPreview(attachment: ChatAttachmentSource) {
  const objectKey = attachment.objectKey || attachment.object_key || "";
  const url = objectKey ? `/api/oss/${objectKey}` : attachment.url;
  if (!url) return null;
  // FilePreviewDialog must never receive an executable or protocol-relative URL.
  if (!url.startsWith("/api/oss/") && !/^https?:\/\//i.test(url)) return null;
  const mimetype = sessionAttachmentMime({
    filename: attachment.filename,
    objectKey,
    contentType: attachment.contentType || attachment.content_type || attachment.type,
  });
  const document =
    mimetype === "application/pdf" ||
    mimetype.startsWith("text/") ||
    /^(application\/(msword|vnd\.ms-(word|excel|powerpoint)|vnd\.openxmlformats-officedocument\.))/.test(
      mimetype
    );
  if (!document && isChatDownloadOnly(attachment.filename, mimetype)) {
    return { kind: "download" as const, url, filename: attachment.filename };
  }
  return {
    kind: "preview" as const,
    file: {
      filename: attachment.filename,
      originalname: attachment.filename,
      mimetype,
      path: url,
      sourceUrl: attachmentPreviewUrl(url),
    },
  };
}
