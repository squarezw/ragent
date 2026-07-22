/**
 * MIME 类型工具库
 * 统一管理文件扩展名到 MIME 类型的映射
 */

/**
 * 文件扩展名到 MIME 类型的映射
 */
export const MIME_TYPE_MAP: Record<string, string> = {
  ".pdf": "application/pdf",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
  ".bmp": "image/bmp",
  ".tiff": "image/tiff",
  ".txt": "text/plain",
  ".csv": "text/csv",
  ".md": "text/markdown",
  ".doc": "application/msword",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".ppt": "application/vnd.ms-powerpoint",
  ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  ".xls": "application/vnd.ms-excel",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
};

/**
 * 预览文件扩展名分类
 */
export const PREVIEW_EXTENSIONS = {
  pdf: [".pdf"],
  image: [".png", ".jpg", ".jpeg", ".gif", ".svg", ".webp", ".bmp", ".tiff"],
  text: [".txt", ".csv", ".md"],
} as const;

/**
 * 根据文件扩展名获取 MIME 类型
 * @param extension 文件扩展名（如 ".pdf"）
 * @param defaultMimeType 默认 MIME 类型，如果找不到匹配的扩展名
 * @returns MIME 类型字符串
 */
export function getMimeTypeFromExtension(
  extension: string,
  defaultMimeType: string = "application/octet-stream"
): string {
  const normalizedExt = extension.toLowerCase();
  return MIME_TYPE_MAP[normalizedExt] || defaultMimeType;
}

/**
 * 根据文件名获取 MIME 类型
 * @param filename 文件名（如 "test.pdf"）
 * @param defaultMimeType 默认 MIME 类型
 * @returns MIME 类型字符串
 */
export function getMimeTypeFromFilename(
  filename: string,
  defaultMimeType: string = "application/octet-stream"
): string {
  const ext = filename.substring(filename.lastIndexOf("."));
  return getMimeTypeFromExtension(ext, defaultMimeType);
}

/**
 * 判断文件是否为 PDF
 * @param extension 文件扩展名
 * @param filename 文件名（可选，用于额外检查）
 * @returns 是否为 PDF
 */
export function isPdfFile(extension: string, filename?: string): boolean {
  const normalizedExt = extension.toLowerCase();
  if (normalizedExt === ".pdf") return true;
  if (filename) {
    return filename.toLowerCase().endsWith(".pdf");
  }
  return false;
}

/**
 * 判断文件是否为图片
 * @param extension 文件扩展名
 * @param filename 文件名（可选，用于额外检查）
 * @returns 是否为图片
 */
export function isImageFile(extension: string, filename?: string): boolean {
  const normalizedExt = extension.toLowerCase();
  if (PREVIEW_EXTENSIONS.image.includes(normalizedExt as any)) {
    return true;
  }
  if (filename) {
    return /\.(png|jpg|jpeg|gif|svg|webp|bmp|tiff)$/i.test(filename);
  }
  return false;
}

/**
 * 判断文件是否为文本文件
 * @param extension 文件扩展名
 * @param filename 文件名（可选，用于额外检查）
 * @returns 是否为文本文件
 */
export function isTextFile(extension: string, filename?: string): boolean {
  const normalizedExt = extension.toLowerCase();
  if (PREVIEW_EXTENSIONS.text.includes(normalizedExt as any)) {
    return true;
  }
  if (filename) {
    return /\.(txt|csv|md)$/i.test(filename);
  }
  return false;
}

/**
 * 剥离 .doc / .docx 扩展名（大小写不敏感）。
 * 用于 docx 转 pdf 后构造 pdf 文件名，避免产出 "xx.docx.pdf" 双扩展。
 */
export function stripDocxExtension(filename: string): string {
  return filename.replace(/\.(docx?|DOCX?)$/, "");
}

/**
 * 判断文件是否应该内联显示（而不是下载）
 * @param extension 文件扩展名
 * @param filename 文件名（可选）
 * @param mimeType MIME 类型（可选）
 * @returns 是否应该内联显示
 */
export function shouldInlineDisplay(
  extension: string,
  filename?: string,
  mimeType?: string
): boolean {
  // 检查扩展名
  if (isPdfFile(extension, filename)) return true;
  if (isImageFile(extension, filename)) return true;
  if (isTextFile(extension, filename)) return true;

  // 检查 MIME 类型
  if (mimeType) {
    if (mimeType === "application/pdf") return true;
    if (mimeType.startsWith("image/")) return true;
    if (mimeType.startsWith("text/")) return true;
  }

  return false;
}
