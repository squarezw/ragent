/**
 * 聊天附件的类型白名单 —— 前端**唯一真源**。
 *
 * 以前这件事写在两个地方：`ChatInputComposite` 的 `accept` 属性（决定文件选择器
 * 里哪些文件可选）和 `useFileAttachments` 的 MIME 列表（决定选中后放不放行）。
 * 两份清单各自演进，结果是 `.csv` 两边都漏了 —— 后端 `file_processing_service`
 * 明明支持它。清单合并到这里，两处都从这份取，就不会再分叉。
 *
 * ## 为什么以扩展名为主、MIME 为辅
 *
 * `file.type` 由浏览器查操作系统的类型注册表得来，同一个文件在不同机器上结果不同：
 * `.csv` 在 macOS 是 `text/csv`，在装了 Excel 的 Windows 上是
 * `application/vnd.ms-excel`，某些环境干脆是空串。只按 MIME 判会得到「我这能传、
 * 同事那不能传」这种查不出原因的故障。`.ai` 当初就是因此单独开了扩展名特判 ——
 * 这里把那个特判推广成通则，不再逐个类型补丁。
 *
 * MIME 保留作兜底：文件没有扩展名时（拖拽粘贴来的截图常见）仍能通过。
 *
 * ## 清单的依据
 *
 * 与后端 `app/services/file_processing_service.py` 的 `supported_extensions` 对齐 ——
 * 能传上来的，`extract_document_text` 都读得动。多列一个在这里，用户就能传上来一个
 * 后端读不出内容的文件。
 */

/** 允许的扩展名（判定以此为准）。全小写、带点。 */
export const ATTACHMENT_EXTENSIONS = [
  ".pdf",
  ".doc",
  ".docx",
  ".xls",
  ".xlsx",
  ".csv",
  ".txt",
  ".ai",
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".bmp",
  ".tif",
  ".tiff",
  ".webp",
] as const;

/**
 * 允许的 MIME（仅在扩展名认不出时兜底）。
 *
 * 图片长期传不上来不是因为不该支持，而是上传曾要求抽取必须成功 —— upload-confirm 的
 * default 分支对未知类型直接抛 "Unsupported file format"。上传与抽取解耦
 * （文字经 extract_document_text 按需取）之后这个限制就没有理由了。
 */
export const ATTACHMENT_MIME_TYPES = [
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "text/csv",
  "text/plain",
  "application/postscript",
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/bmp",
  "image/tiff",
  "image/webp",
] as const;

/** `<input type="file" accept>` 的值。与校验同源，不会再出现「选得中但传不上」。 */
export const ATTACHMENT_ACCEPT = ATTACHMENT_EXTENSIONS.join(",");

/** 这个文件能不能作为聊天附件上传。扩展名优先，MIME 兜底。 */
export function isAllowedAttachment(filename: string, mimeType?: string): boolean {
  const name = (filename || "").toLowerCase();
  if (ATTACHMENT_EXTENSIONS.some((ext) => name.endsWith(ext))) return true;
  return (ATTACHMENT_MIME_TYPES as readonly string[]).includes((mimeType || "").toLowerCase());
}
