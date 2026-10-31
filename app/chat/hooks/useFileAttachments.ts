import { downloadChatLink } from "@/lib/chatResourcePreview";
import { useRef, useState } from "react";
import { useTranslations } from "next-intl";
import axios from "@/lib/axios";
import { isCookieAuthMode } from "@/lib/browserAuthMode";
import { uploadFile, getFileUrl } from "@/lib/ossUpload";
import { sessionAttachmentMime } from "@/lib/sessionAttachments";
import { beginWorkspaceRequest, getWorkspaceSnapshot, workspaceUrl } from "@/lib/workspaceBrowser";
import { chatAttachmentPreview } from "@/lib/chatAttachmentPreview";
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
  contentType?: string;
  uploadReceipt?: string;
}

export interface PendingAttachment {
  id: number;
  filename: string;
  type: string;
}

export function useFileAttachments() {
  const t = useTranslations("chat");
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [uploading, setUploading] = useState(false);
  const uploadingCountRef = useRef(0);
  const uploadIdRef = useRef(0);
  const [pendingAttachments, setPendingAttachments] = useState<PendingAttachment[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [previewFile, setPreviewFile] = useState<any>(null);

  const handleFileUpload = async (file: File) => {
    const workspaceUpload = getWorkspaceSnapshot().enabled ? beginWorkspaceRequest(true) : null;
    const id = ++uploadIdRef.current;
    setPendingAttachments((prev) => [...prev, { id, filename: file.name, type: file.type }]);
    uploadingCountRef.current += 1;
    setUploading(true);
    try {
      const token = localStorage.getItem("ragent_token");
      const loginStatus = localStorage.getItem("ragent_logged_in");

      if (!isCookieAuthMode() && (!token || loginStatus !== "true")) {
        throw new Error(t("pleaseLoginFirst"));
      }

      let uploadReceipt: string | undefined;
      const contentType = sessionAttachmentMime({
        filename: file.name,
        objectKey: "",
        contentType: file.type,
      });
      const objectKey = await uploadFile({
        file,
        category: "attachments",
        onPresigned: (metadata) => {
          uploadReceipt = metadata.uploadReceipt;
        },
      });

      const response = await axios.post("/api/chat/upload-confirm", {
        objectKey,
        originalFilename: file.name,
        uploadReceipt,
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
        contentType,
        uploadReceipt,
      };

      setAttachments((prev) => [...prev, newAttachment]);
    } catch (error: any) {
      console.error("File upload failed:", error);
      alert(
        `${t("fileUploadFailed", { name: file.name })}: ${error.response?.data?.error || error.message}`
      );
    } finally {
      workspaceUpload?.finish();
      setPendingAttachments((prev) => prev.filter((attachment) => attachment.id !== id));
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
    const target = chatAttachmentPreview(attachment);
    if (!target) return;
    if (target.kind === "download") {
      downloadChatLink(workspaceUrl(target.url), target.filename);
    } else {
      setPreviewFile({ ...target.file, sourceUrl: workspaceUrl(target.file.sourceUrl) });
    }
  };

  return {
    attachments,
    pendingAttachments,
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
