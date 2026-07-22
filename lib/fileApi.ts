import axios from "@/lib/axios";

/**
 * 文件操作工具库
 * 统一封装所有 /api/uploads/ 相关的 API 调用
 */

export interface FileInfo {
  id: string;
  filename: string;
  originalname?: string;
  mimetype?: string;
}

/**
 * 生成文件下载 URL
 * @param fileId 文件 ID（可选）
 * @param filename 文件名
 * @returns 下载 URL
 */
export function getFileDownloadUrl(fileId: string | undefined, filename: string): string {
  if (!fileId || fileId === "undefined") {
    throw new Error("file_id is required for file download");
  }
  return `/api/uploads/${filename}?file_id=${fileId}`;
}

/**
 * 下载文件
 * @param fileId 文件 ID
 * @param filename 文件名
 * @param originalname 原始文件名（用于下载时的文件名）
 * @returns Promise<void>
 */
export async function downloadFile(
  fileId: string,
  filename: string,
  originalname?: string
): Promise<void> {
  const url = getFileDownloadUrl(fileId, filename);

  const response = await axios.get(url, {
    responseType: "blob",
  });

  // 当使用 responseType: 'blob' 时，response.data 已经是 Blob 对象
  const blob =
    response.data instanceof Blob
      ? response.data
      : new Blob([response.data], {
          type: response.headers["content-type"] || "application/octet-stream",
        });

  const blobUrl = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = blobUrl;
  link.download = originalname || filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);

  // 清理 blob URL
  setTimeout(() => {
    URL.revokeObjectURL(blobUrl);
  }, 100);
}

/**
 * 获取文件 Blob（用于预览等场景）
 * @param fileId 文件 ID（可选，用于知识库文件）
 * @param filename 文件名（必需）
 * @returns Promise<Blob>
 */
export async function getFileBlob(fileId: string | undefined, filename: string): Promise<Blob> {
  const url = getFileDownloadUrl(fileId, filename);
  const response = await axios.get(url, {
    responseType: "blob",
  });
  // 当使用 responseType: 'blob' 时，response.data 已经是 Blob 对象
  // 但为了确保类型正确，我们需要检查并处理
  if (response.data instanceof Blob) {
    return response.data;
  }
  // 如果不是 Blob，创建一个新的 Blob（兼容处理）
  return new Blob([response.data], {
    type: response.headers["content-type"] || "application/octet-stream",
  });
}

/**
 * 转换 DOCX 文件为 HTML
 * @param fileId 文件 ID（可选）
 * @param filename 文件名（可选，当 fileId 无效时使用）
 * @returns Promise<string> HTML 内容
 */
export async function convertDocx(fileId?: string, filename?: string): Promise<string> {
  const params = new URLSearchParams();
  if (fileId && fileId !== "undefined") {
    params.append("file_id", fileId);
  }
  if (filename) {
    params.append("filename", filename);
  }
  const response = await axios.get(`/api/uploads/convert-docx?${params.toString()}`);
  return response.data;
}

/**
 * 转换 DOC 文件为文本
 * @param fileId 文件 ID（可选）
 * @param filename 文件名（可选，当 fileId 无效时使用）
 * @returns Promise<string> 文本内容
 */
export async function convertDoc(fileId?: string, filename?: string): Promise<string> {
  const params = new URLSearchParams();
  if (fileId && fileId !== "undefined") {
    params.append("file_id", fileId);
  }
  if (filename) {
    params.append("filename", filename);
  }
  const response = await axios.get(`/api/uploads/convert-doc?${params.toString()}`);
  return response.data;
}

/**
 * 转换 Excel 文件为 HTML
 * @param fileId 文件 ID（可选）
 * @param filename 文件名（可选，当 fileId 无效时使用）
 * @returns Promise<{ sheets: Array<{ name: string; html: string; data: any[] }> }>
 */
export async function convertExcel(
  fileId?: string,
  filename?: string
): Promise<{
  sheets: Array<{ name: string; html: string; data: any[] }>;
}> {
  const params = new URLSearchParams();
  if (fileId && fileId !== "undefined") {
    params.append("file_id", fileId);
  }
  if (filename) {
    params.append("filename", filename);
  }
  const response = await axios.get(`/api/uploads/convert-excel?${params.toString()}`);
  return response.data;
}

/**
 * 从文件对象生成下载 URL（便捷方法）
 * @param file 文件信息对象
 * @returns 下载 URL
 */
export function getFileDownloadUrlFromFile(file: FileInfo): string {
  return getFileDownloadUrl(file.id, file.filename);
}

/**
 * 从文件对象下载文件（便捷方法）
 * @param file 文件信息对象
 * @returns Promise<void>
 */
export async function downloadFileFromFile(file: FileInfo): Promise<void> {
  return downloadFile(file.id, file.filename, file.originalname);
}

/**
 * 从文件对象获取文件 Blob（便捷方法）
 * @param file 文件信息对象
 * @returns Promise<Blob>
 */
export async function getFileBlobFromFile(file: FileInfo): Promise<Blob> {
  return getFileBlob(file.id, file.filename);
}

/**
 * 获取文件预览 URL（OSS 签名 URL 或 token 代理 URL）
 * @param fileId 文件 ID
 * @returns Promise<{ url: string; expiresIn: number }>
 */
export async function getPreviewUrl(fileId: string): Promise<{ url: string; expiresIn: number }> {
  const response = await axios.post("/api/file-preview/stream-url", { fileId });
  return response.data;
}

/**
 * 检查文件是否为 Office 文档 (Word, Excel, PPT)
 * @param file 文件信息对象 (包含 mimetype 和 filename)
 * @returns boolean
 */
export function isOfficeDocument(file: { mimetype?: string; filename?: string }): boolean {
  if (!file) return false;

  const { mimetype, filename } = file;

  // 检查 MIME 类型
  if (
    mimetype?.includes("msword") ||
    mimetype?.includes("office") ||
    mimetype?.includes("excel") ||
    mimetype?.includes("powerpoint") ||
    mimetype?.includes("vnd.ms-")
  ) {
    return true;
  }

  // 检查文件扩展名
  if (
    filename?.endsWith(".doc") ||
    filename?.endsWith(".docx") ||
    filename?.endsWith(".xls") ||
    filename?.endsWith(".xlsx") ||
    filename?.endsWith(".ppt") ||
    filename?.endsWith(".pptx")
  ) {
    return true;
  }

  return false;
}
