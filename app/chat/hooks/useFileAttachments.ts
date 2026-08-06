import { useRef, useState } from "react";
import { useTranslations } from "next-intl";
import axios from "@/lib/axios";
import { uploadFile, getFileUrl } from "@/lib/ossUpload";
import { isAllowedAttachment } from "@/lib/chatAttachments";

export interface Attachment {
  filename: string;
  type: string;
  content: string;
  url?: string;
  /**
   * 对象存储的 key。除了拼下载 URL，它还要作为结构化字段随聊天请求发给后端——
   * skill 沙箱要的是**原始文件**（扫描件、Excel、图纸），而 `content` 只是抽取出的
   * 文本。后端凭它取回字节、写进容器的 inputs/ 下。
   *
   * 原先只保留了派生的 `url`，objectKey 在上传后就被丢掉了。
   */
  objectKey?: string;
  /** 字节数，随请求发给后端用于超限预判（避免白下载一遍大文件） */
  size?: number;
}

export function useFileAttachments() {
  const t = useTranslations("chat");
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [uploading, setUploading] = useState(false);
  const uploadingCountRef = useRef(0);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [previewFile, setPreviewFile] = useState<any>(null);

  const handleFileUpload = async (file: File) => {
    uploadingCountRef.current += 1;
    setUploading(true);
    try {
      const token = localStorage.getItem("ragent_token");
      const loginStatus = localStorage.getItem("ragent_logged_in");

      if (!token || loginStatus !== "true") {
        throw new Error(t("pleaseLoginFirst"));
      }

      const objectKey = await uploadFile({
        file,
        category: "attachments",
      });

      const response = await axios.post("/api/chat/upload-confirm", {
        objectKey,
        originalFilename: file.name,
        contentType: file.type || "application/octet-stream",
      });

      const result = response.data;
      const newAttachment: Attachment = {
        filename: result.filename,
        type: result.type,
        content: result.content,
        url: getFileUrl(result.objectKey),
        objectKey: result.objectKey,
        size: file.size,
      };

      setAttachments((prev) => [...prev, newAttachment]);
    } catch (error: any) {
      console.error("File upload failed:", error);
      alert(
        `${t("fileUploadFailed", { name: file.name })}: ${error.response?.data?.error || error.message}`
      );
    } finally {
      uploadingCountRef.current -= 1;
      if (uploadingCountRef.current === 0) {
        setUploading(false);
      }
    }
  };

  const validateAndUploadFiles = async (files: File[]) => {
    const invalidFiles: string[] = [];

    for (const file of files) {
      // 白名单在 lib/chatAttachments.ts —— 与 accept 属性同源
      if (!isAllowedAttachment(file.name, file.type)) {
        invalidFiles.push(file.name);
      }
    }

    if (invalidFiles.length > 0) {
      alert(t("unsupportedFileFormat", { files: invalidFiles.join(", ") }));
      return;
    }

    const uploadPromises = files.map((file) => handleFileUpload(file));
    await Promise.allSettled(uploadPromises);
  };

  const handleFileSelect = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files;
    if (!files || files.length === 0) return;

    await validateAndUploadFiles(Array.from(files));

    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  const handleFileDrop = async (files: File[]) => {
    if (files.length === 0) return;
    await validateAndUploadFiles(files);
  };

  const removeAttachment = (index: number) => {
    setAttachments((prev) => prev.filter((_, i) => i !== index));
  };

  const handlePreviewAttachment = (attachment: Attachment) => {
    const getMimetypeFromType = (type: string): string => {
      if (type.includes("PDF") || type === t("pdfDocument")) {
        return "application/pdf";
      }
      if (type.includes("Word") || type === t("wordDocument")) {
        return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
      }
      if (type.includes("Excel") || type === t("excelSpreadsheet")) {
        return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
      }
      if (type.includes("文本") || type === t("textFile")) {
        return "text/plain";
      }
      const lowerFilename = attachment.filename.toLowerCase();
      if (lowerFilename.endsWith(".pdf")) return "application/pdf";
      if (lowerFilename.endsWith(".docx"))
        return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
      if (lowerFilename.endsWith(".doc")) return "application/msword";
      if (lowerFilename.endsWith(".xlsx"))
        return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
      if (lowerFilename.endsWith(".xls")) return "application/vnd.ms-excel";
      if (lowerFilename.endsWith(".txt")) return "text/plain";
      if (lowerFilename.endsWith(".ai")) return "application/postscript";
      // 图片也要走扩展名兜底：部分浏览器/系统对图片给不出 MIME，
      // 落到 octet-stream 就会被判成不支持而传不上来。
      if (lowerFilename.endsWith(".png")) return "image/png";
      if (lowerFilename.endsWith(".jpg") || lowerFilename.endsWith(".jpeg")) return "image/jpeg";
      if (lowerFilename.endsWith(".gif")) return "image/gif";
      if (lowerFilename.endsWith(".bmp")) return "image/bmp";
      if (lowerFilename.endsWith(".tif") || lowerFilename.endsWith(".tiff")) return "image/tiff";
      if (lowerFilename.endsWith(".webp")) return "image/webp";
      return "application/octet-stream";
    };

    let serverFilename = attachment.filename;

    if (attachment.url) {
      let urlPath = attachment.url;
      urlPath = urlPath.replace(/^\/+(api\/)?uploads\/+/, "");
      if (urlPath) {
        serverFilename = urlPath.split("/").pop() || attachment.filename;
      }
    }

    const fileForPreview = {
      filename: serverFilename,
      originalname: attachment.filename,
      mimetype: getMimetypeFromType(attachment.type),
      path: attachment.url || undefined,
      sourceUrl: attachment.url || undefined,
    };

    setPreviewFile(fileForPreview);
  };

  return {
    attachments,
    setAttachments,
    uploading,
    fileInputRef,
    previewFile,
    setPreviewFile,
    handleFileSelect,
    handleFileDrop,
    removeAttachment,
    handlePreviewAttachment,
  };
}
