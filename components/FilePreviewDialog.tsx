"use client";

import { Button } from "@/components/ui/button";
import axios from "@/lib/axios";
import * as Dialog from "@radix-ui/react-dialog";
import { useEffect, useState, useRef } from "react";
import { useTranslations } from "next-intl";
import ReactMarkdown from "react-markdown";
import { Download, Link } from "lucide-react";
import { toast } from "sonner";
import {
  convertDocx,
  convertDoc,
  convertExcel,
  downloadFile,
  getFileDownloadUrl,
  getPreviewUrl,
  isOfficeDocument,
} from "@/lib/fileApi";

export interface FilePreviewDialogProps {
  file: {
    id?: string; // 文件 ID（必需，用于获取文件信息）
    filename?: string; // 文件名（可选，如果有则直接使用）
    originalname?: string; // 原始文件名（可选）
    mimetype?: string; // MIME 类型（可选）
    [key: string]: any; // 允许其他字段
  } | null;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  datasetId?: string; // 数据集 ID，用于生成分享链接
}

export function FilePreviewDialog({ file, open, onOpenChange, datasetId }: FilePreviewDialogProps) {
  const t = useTranslations("common");
  const [textContent, setTextContent] = useState<string | undefined>(undefined);
  const [docxHtml, setDocxHtml] = useState<string | undefined>(undefined);
  const [docText, setDocText] = useState<string | undefined>(undefined);
  const [excelData, setExcelData] = useState<any>(undefined);
  const [kkPreviewUrl, setKkPreviewUrl] = useState<string | undefined>(undefined);
  const [kkLoading, setKkLoading] = useState(false);
  const [kkIframeLoading, setKkIframeLoading] = useState(false);
  const [kkError, setKkError] = useState<string | undefined>(undefined);
  const [fileInfo, setFileInfo] = useState<any>(file);
  const [pdfUrl, setPdfUrl] = useState<string | undefined>(undefined);
  const [pdfError, setPdfError] = useState<string | undefined>(undefined);
  const [imageUrl, setImageUrl] = useState<string | undefined>(undefined);
  const [imageError, setImageError] = useState<string | undefined>(undefined);
  const [downloading, setDownloading] = useState(false);
  // 使用 ref 存储之前的 URL，用于清理
  const prevPdfUrlRef = useRef<string | undefined>(undefined);
  const prevImageUrlRef = useRef<string | undefined>(undefined);
  const refreshTimerRef = useRef<NodeJS.Timeout | undefined>(undefined);

  // 获取预览 URL 并设置自动刷新
  async function fetchPreviewUrl(fileId: string, setter: (url: string) => void) {
    const { url, expiresIn } = await getPreviewUrl(fileId);
    setter(url);
    // 过期前 2 分钟刷新（最少 30 秒）
    const refreshAfter = Math.max((expiresIn - 120) * 1000, 30000);
    clearTimeout(refreshTimerRef.current);
    refreshTimerRef.current = setTimeout(() => {
      fetchPreviewUrl(fileId, setter).catch(console.error);
    }, refreshAfter);
  }

  // 如果文件信息已完整（有 mimetype 和 originalname），直接使用
  // 如果只有 file_id，通过 API 获取完整信息
  useEffect(() => {
    if (open && file) {
      // 如果文件信息已完整（有 mimetype 和 originalname），直接使用，不查数据库
      if (file.mimetype && file.originalname && file.filename) {
        setFileInfo(file);
      }
      // 如果只有 file_id，通过 API 获取完整信息
      else if (file.id) {
        axios
          .get(`/api/knowledge/file-status?id=${file.id}`)
          .then((res) => {
            if (res.data?.success && res.data?.file) {
              setFileInfo({
                ...file,
                ...res.data.file,
                id: file.id, // 确保使用原始的 file.id（string 类型）
                filename: file.filename || res.data.file.filename, // 优先使用传入的 filename
              });
            } else {
              // API 失败，使用 fallback
              setFileInfo(file);
            }
          })
          .catch(() => {
            // API 失败，使用 fallback
            setFileInfo(file);
          });
      } else if (file.filename) {
        // 没有 id 但有 filename，通过 filename 查找文件信息（获取 id 等）
        axios
          .get(`/api/knowledge/file-status?filename=${encodeURIComponent(file.filename)}`)
          .then((res) => {
            if (res.data?.success && res.data?.file) {
              setFileInfo({
                ...file,
                ...res.data.file,
                id: String(res.data.file.id),
                filename: file.filename || res.data.file.filename,
              });
            } else {
              setFileInfo(file);
            }
          })
          .catch(() => {
            setFileInfo(file);
          });
      } else {
        // 没有 id 也没有 filename，直接使用传入的文件对象
        setFileInfo(file);
      }
    } else if (!open) {
      setFileInfo(null);
    }
  }, [open, file]);

  useEffect(() => {
    if (open && fileInfo) {
      // 重置状态
      setTextContent(undefined);
      setDocxHtml(undefined);
      setDocText(undefined);
      setExcelData(undefined);
      setPdfUrl(undefined);
      setPdfError(undefined);
      setImageUrl(undefined);
      setImageError(undefined);
      setKkPreviewUrl(undefined);
      setKkError(undefined);

      // 确定文件 URL：优先使用 sourceUrl，否则对于本地上传的文件自动生成
      let fileUrl: string | undefined = fileInfo.sourceUrl;
      if (!fileUrl && fileInfo.filename && fileInfo.id) {
        // 对于本地上传的文件，生成完整的文件访问 URL
        const baseUrl = typeof window !== "undefined" ? window.location.origin : "";
        fileUrl = `${baseUrl}${getFileDownloadUrl(fileInfo.id, fileInfo.filename)}`;
      }

      // 只有 Office 文档才走 kkFileView
      // 避免 PDF 和图片也走 kkFileView 导致变慢
      const isOffice = isOfficeDocument(fileInfo);

      // 如果有文件 URL 且是 Office 文档，优先使用 kkFileView 预览
      if (fileUrl && isOffice) {
        setKkLoading(true);

        // 从文件名提取扩展名作为 hint，用于 URL 无扩展名的场景（如 process document file endpoint）
        const filenameExt =
          fileInfo.filename?.match(/\.[^.]+$/)?.[0] ||
          fileInfo.originalname?.match(/\.[^.]+$/)?.[0];

        axios
          .post("/api/file-preview/create-link", {
            fileUrl,
            fileId: fileInfo.id,
            extension: filenameExt || undefined,
          })
          .then((res) => {
            const previewUrl = res.data?.previewUrl;
            setKkPreviewUrl(previewUrl);
            setKkIframeLoading(true);
          })
          .catch(() => {
            setKkError(t("generatePreviewLinkFailed"));
          })
          .finally(() => {
            setKkLoading(false);
          });
        return;
      }

      if (typeof fileInfo.mimetype === "string") {
        // 确保 filename 存在（如果只有 id，filename 应该从 API 获取或使用占位符）
        if (!fileInfo.filename) {
          console.warn("[FilePreviewDialog] filename is missing, cannot preview file");
          return;
        }

        // 处理 PDF 文件 - 使用流式预览 URL（OSS 签名或 token 代理）
        if (fileInfo.mimetype === "application/pdf") {
          if (fileInfo.sourceUrl) {
            // 外部 sourceUrl 直接使用
            setPdfUrl(fileInfo.sourceUrl);
          } else if (fileInfo.id) {
            // 通过 stream-url API 获取预览 URL
            fetchPreviewUrl(fileInfo.id, setPdfUrl).catch((error: any) => {
              setPdfUrl(undefined);
              setPdfError(error.response?.data?.error || error.message || t("fileNotFound"));
            });
          }
        }
        // 处理图片文件 - 使用流式预览 URL（OSS 签名或 token 代理）
        else if (fileInfo.mimetype.startsWith("image/")) {
          if (fileInfo.sourceUrl) {
            // 外部 sourceUrl 直接使用
            setImageUrl(fileInfo.sourceUrl);
          } else if (fileInfo.id) {
            // 通过 stream-url API 获取预览 URL
            fetchPreviewUrl(fileInfo.id, setImageUrl).catch((error: any) => {
              setImageUrl(undefined);
              setImageError(error.response?.data?.error || error.message || t("fileNotFound"));
            });
          }
        }

        // 处理 docx 文件
        if (
          fileInfo.mimetype ===
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
          (fileInfo.filename && fileInfo.filename.toLowerCase().endsWith(".docx"))
        ) {
          convertDocx(fileInfo.id, fileInfo.filename)
            .then((html) => setDocxHtml(html))
            .catch(() => setDocxHtml(`<p>${t("documentConversionFailed")}</p>`));
        }
        // 处理 doc 文件
        else if (
          fileInfo.mimetype === "application/msword" ||
          (fileInfo.filename && fileInfo.filename.toLowerCase().endsWith(".doc"))
        ) {
          convertDoc(fileInfo.id, fileInfo.filename)
            .then((text) => setDocText(text))
            .catch(() => setDocText(t("documentConversionFailed")));
        }
        // 处理 Excel 文件
        else if (
          fileInfo.mimetype === "application/vnd.ms-excel" ||
          fileInfo.mimetype ===
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" ||
          (fileInfo.filename &&
            (fileInfo.filename.toLowerCase().endsWith(".xls") ||
              fileInfo.filename.toLowerCase().endsWith(".xlsx")))
        ) {
          convertExcel(fileInfo.id, fileInfo.filename)
            .then((data) => setExcelData(data))
            .catch(() => setExcelData({ error: t("excelConversionFailed") }));
        }
        // 处理文本文件（包括 markdown）
        else if (
          fileInfo.mimetype.startsWith("text/") ||
          fileInfo.mimetype === "text/markdown" ||
          fileInfo.mimetype === "text/csv" ||
          (fileInfo.filename && fileInfo.filename.toLowerCase().endsWith(".md"))
        ) {
          const textUrl = fileInfo.sourceUrl || getFileDownloadUrl(fileInfo.id, fileInfo.filename);
          axios
            .get(textUrl)
            .then((res) => setTextContent(res.data || res))
            .catch(() => setTextContent(t("loadFailed")));
        }
      }
    }

    // 清理 URL 和定时器（组件卸载或文件切换时）
    return () => {
      clearTimeout(refreshTimerRef.current);
      if (prevPdfUrlRef.current?.startsWith("blob:")) {
        URL.revokeObjectURL(prevPdfUrlRef.current);
      }
      prevPdfUrlRef.current = undefined;
      if (prevImageUrlRef.current?.startsWith("blob:")) {
        URL.revokeObjectURL(prevImageUrlRef.current);
      }
      prevImageUrlRef.current = undefined;
    };
  }, [fileInfo, open]);

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/30 z-50" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-[1200px] max-w-[95vw] h-[90vh] -translate-x-1/2 -translate-y-1/2 rounded bg-card p-6 shadow-lg flex flex-col">
          <div className="flex items-center justify-between">
            <Dialog.Title>
              {t("filePreviewTitle")}: {fileInfo?.originalname || fileInfo?.filename}
            </Dialog.Title>
            <div className="flex items-center gap-2">
              {datasetId && fileInfo?.id && (
                <Button
                  variant="outline"
                  size="icon"
                  title={t("copyShareLink")}
                  onClick={() => {
                    const url = new URL(window.location.href);
                    url.pathname = "/knowledge";
                    url.searchParams.set("dataset", datasetId);
                    url.searchParams.set("file", fileInfo.id);
                    navigator.clipboard.writeText(url.toString());
                    toast.success(t("linkCopied"));
                  }}
                >
                  <Link className="h-4 w-4" />
                </Button>
              )}
              {fileInfo?.filename && (
                <Button
                  variant="outline"
                  size="icon"
                  onClick={async () => {
                    setDownloading(true);
                    try {
                      if (fileInfo.sourceUrl && !fileInfo.id) {
                        // 直接通过 sourceUrl 下载
                        const response = await axios.get(fileInfo.sourceUrl, {
                          responseType: "blob",
                        });
                        const blob =
                          response.data instanceof Blob ? response.data : new Blob([response.data]);
                        const blobUrl = URL.createObjectURL(blob);
                        const link = document.createElement("a");
                        link.href = blobUrl;
                        link.download = fileInfo.originalname || fileInfo.filename;
                        document.body.appendChild(link);
                        link.click();
                        document.body.removeChild(link);
                        setTimeout(() => URL.revokeObjectURL(blobUrl), 100);
                      } else {
                        await downloadFile(
                          fileInfo.id,
                          fileInfo.filename,
                          fileInfo.originalname || fileInfo.filename
                        );
                      }
                    } catch (error: any) {
                      console.error("[Download] error:", error);
                      const errorMessage =
                        error.response?.data?.error || error.message || t("downloadFailed");
                      toast.error(`${t("downloadFailed")}: ${errorMessage}`);
                    } finally {
                      setDownloading(false);
                    }
                  }}
                  disabled={downloading}
                >
                  {downloading ? (
                    <div className="w-4 h-4 border border-border border-t-primary rounded-full animate-spin" />
                  ) : (
                    <Download className="h-4 w-4" />
                  )}
                </Button>
              )}
            </div>
          </div>
          <div className="mt-4 flex-1 min-h-0 overflow-auto bg-secondary p-2 rounded text-xs">
            {fileInfo ? (
              <div key={fileInfo.id || "preview-content"} className="w-full h-full">
                {(fileInfo.sourceUrl || fileInfo.filename) &&
                (kkPreviewUrl || kkLoading || kkError) &&
                isOfficeDocument(fileInfo) ? (
                  kkLoading ? (
                    <div className="flex h-full items-center justify-center text-muted-foreground">
                      {t("openingPreview")}
                    </div>
                  ) : kkError ? (
                    <div className="flex h-full items-center justify-center text-red-600">
                      {kkError}
                    </div>
                  ) : kkPreviewUrl ? (
                    <div className="relative w-full h-full">
                      {kkIframeLoading && (
                        <div className="absolute inset-0 flex flex-col items-center justify-center bg-secondary z-10">
                          <div className="w-8 h-8 border-4 border-border border-t-primary rounded-full animate-spin mb-4" />
                          <div className="text-muted-foreground text-sm font-medium">
                            {t("loadingPreviewContent")}
                          </div>
                        </div>
                      )}
                      <iframe
                        src={kkPreviewUrl}
                        className="w-full h-full border bg-card"
                        title={t("kkFileViewPreview")}
                        onLoad={() => setKkIframeLoading(false)}
                      />
                    </div>
                  ) : null
                ) : fileInfo.mimetype === "application/pdf" ? (
                  pdfUrl ? (
                    <iframe
                      src={pdfUrl}
                      className="w-full h-full border bg-card"
                      title={t("pdfPreview")}
                    />
                  ) : pdfError ? (
                    <div className="text-center p-4 text-red-600">
                      <p>
                        {t("loadFailedColon")}
                        {pdfError}
                      </p>
                    </div>
                  ) : (
                    <div className="text-center p-4">{t("loadingPDF")}</div>
                  )
                ) : typeof fileInfo.mimetype === "string" &&
                  fileInfo.mimetype.startsWith("image/") ? (
                  imageUrl ? (
                    <img
                      src={imageUrl}
                      alt={fileInfo.originalname || fileInfo.filename}
                      className="max-w-full max-h-full mx-auto"
                    />
                  ) : imageError ? (
                    <div className="text-center p-4 text-red-600">
                      <p>
                        {t("loadFailedColon")}
                        {imageError}
                      </p>
                    </div>
                  ) : (
                    <div className="text-center p-4">{t("loadingImage")}</div>
                  )
                ) : fileInfo.mimetype === "text/markdown" ||
                  (fileInfo.filename && fileInfo.filename.toLowerCase().endsWith(".md")) ? (
                  <div className="prose max-w-none">
                    <ReactMarkdown>{textContent ?? t("loading")}</ReactMarkdown>
                  </div>
                ) : fileInfo.mimetype === "text/csv" ? (
                  <pre>{textContent ?? t("loading")}</pre>
                ) : typeof fileInfo.mimetype === "string" &&
                  fileInfo.mimetype.startsWith("text/") ? (
                  <pre>{textContent ?? t("loading")}</pre>
                ) : fileInfo.mimetype ===
                    "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
                  (fileInfo.filename && fileInfo.filename.toLowerCase().endsWith(".docx")) ? (
                  <div className="prose max-w-none bg-card p-4 rounded border">
                    {docxHtml ? (
                      <div dangerouslySetInnerHTML={{ __html: docxHtml }} />
                    ) : (
                      <div>{t("convertingDocument")}</div>
                    )}
                  </div>
                ) : fileInfo.mimetype === "application/msword" ||
                  fileInfo.mimetype === "application/vnd.ms-word" ||
                  (fileInfo.filename && fileInfo.filename.toLowerCase().endsWith(".doc")) ? (
                  <div className="bg-card p-4 rounded border">
                    {docText ? (
                      <pre className="whitespace-pre-wrap text-sm">{docText}</pre>
                    ) : (
                      <div className="text-center">
                        <p className="text-muted-foreground mb-4">{t("extractingDocContent")}</p>
                      </div>
                    )}
                  </div>
                ) : fileInfo.mimetype === "application/vnd.ms-excel" ||
                  fileInfo.mimetype ===
                    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" ||
                  (fileInfo.filename &&
                    (fileInfo.filename.toLowerCase().endsWith(".xls") ||
                      fileInfo.filename.toLowerCase().endsWith(".xlsx"))) ? (
                  <div className="bg-card p-4 rounded border">
                    {excelData ? (
                      excelData.error ? (
                        <div className="text-center text-red-600">{excelData.error}</div>
                      ) : (
                        <div>
                          {excelData.sheets.map((sheet: any, index: number) => (
                            <div key={index} className="mb-6">
                              <h3 className="text-lg font-semibold mb-2 text-foreground">
                                {t("worksheet")}: {sheet.name}
                              </h3>
                              <div className="overflow-auto max-h-96 border rounded bg-card">
                                {sheet.html ? (
                                  <div dangerouslySetInnerHTML={{ __html: sheet.html }} />
                                ) : (
                                  <div className="p-4 text-muted-foreground text-center">
                                    {t("worksheetEmpty")}
                                  </div>
                                )}
                              </div>
                            </div>
                          ))}
                        </div>
                      )
                    ) : (
                      <div className="text-center">
                        <p className="text-muted-foreground mb-4">{t("parsingExcel")}</p>
                      </div>
                    )}
                  </div>
                ) : (
                  <div>{t("previewNotSupported")}</div>
                )}
              </div>
            ) : null}
          </div>
          <div className="flex justify-end gap-2 mt-6">
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              {t("close")}
            </Button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
