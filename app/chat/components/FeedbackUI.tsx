"use client";

import React, { useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { Button } from "@/components/ui/button";
import { ThumbsUp, ThumbsDown, Download } from "lucide-react";
import axios from "@/lib/axios";
import { useTranslations } from "next-intl";
import { toast } from "sonner";

interface FeedbackUIProps {
  detailId?: number;
  sendFeedback: (
    detailId: number,
    voteGood: boolean,
    voteBad: boolean,
    feedback: string
  ) => Promise<void>;
  content?: string;
}

const FeedbackUI: React.FC<FeedbackUIProps> = ({ detailId, sendFeedback, content }) => {
  const t = useTranslations("chat");
  const tc = useTranslations("common");
  const [open, setOpen] = useState(false);
  const [liked, setLiked] = useState(false);
  const [disliked, setDisliked] = useState(false);
  const [feedback, setFeedback] = useState("");
  const [isExporting, setIsExporting] = useState(false);

  const handleExportPDF = async () => {
    if (!content) return;

    setIsExporting(true);
    try {
      const fileName = `${t("aiAnswerPrefix")}${new Date().toISOString().slice(0, 10)}.pdf`;

      // 调用服务端 API 生成 PDF
      const response = await axios.post(
        "/api/pdf/markdown-to-pdf",
        {
          markdown: content,
          filename: fileName,
        },
        {
          responseType: "blob",
          // 确保正确处理二进制响应
          transformResponse: [(data) => data],
        }
      );

      // 验证响应是否为有效的 PDF
      if (!(response.data instanceof Blob)) {
        throw new Error(t("invalidPdfResponse"));
      }

      // 检查是否是错误响应（JSON 错误会被解析为文本）
      if (response.data.type === "application/json" || response.data.size < 100) {
        const text = await response.data.text();
        try {
          const errorData = JSON.parse(text);
          throw new Error(errorData.error || errorData.details || t("pdfGenerateFailed"));
        } catch {
          throw new Error(t("pdfGenerateFailed"));
        }
      }

      // 创建下载链接
      const url = window.URL.createObjectURL(response.data);
      const link = document.createElement("a");
      link.href = url;
      link.setAttribute("download", fileName);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(url);
    } catch (error: any) {
      console.error("Export PDF failed:", error);
      const errorMessage = error?.response?.data?.error || error?.message || t("exportPdfFailed");
      alert(errorMessage);
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <div className="flex items-center gap-2 mt-2">
      {content && (
        <Button
          size="icon"
          variant="ghost"
          title={t("exportPDF")}
          onClick={handleExportPDF}
          disabled={isExporting}
        >
          {isExporting ? (
            <div className="w-5 h-5 border-2 border-border border-t-primary rounded-full animate-spin" />
          ) : (
            <Download className="w-5 h-5 text-primary" />
          )}
        </Button>
      )}
      <Button
        size="icon"
        variant="ghost"
        title={t("like")}
        onClick={async () => {
          if (!detailId) return;
          try {
            await sendFeedback(detailId, true, false, feedback);
            setLiked(true);
            setDisliked(false);
            toast.success(t("feedbackSubmitSuccess"));
          } catch (e: any) {
            if (e?.response?.status === 409) {
              toast.info(t("feedbackAlreadySubmitted"));
              setLiked(true);
              setDisliked(false);
            } else {
              toast.error(t("feedbackSubmitFailed"));
            }
          }
        }}
      >
        {liked ? (
          <ThumbsUp className="w-5 h-5 text-success fill-success" fill="currentColor" />
        ) : (
          <ThumbsUp className="w-5 h-5 text-success" />
        )}
      </Button>
      <Dialog.Root open={open} onOpenChange={setOpen}>
        <Dialog.Trigger asChild>
          <Button
            size="icon"
            variant="ghost"
            title={t("dislike")}
            onClick={() => {
              setOpen(true);
              setDisliked(true);
              setLiked(false);
            }}
          >
            {disliked ? (
              <ThumbsDown
                className="w-5 h-5 text-destructive fill-destructive"
                fill="currentColor"
              />
            ) : (
              <ThumbsDown className="w-5 h-5 text-destructive" />
            )}
          </Button>
        </Dialog.Trigger>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 bg-black/30 z-50" />
          <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-80 -translate-x-1/2 -translate-y-1/2 rounded bg-card p-6 shadow-lg">
            <Dialog.Title>{t("feedbackOpinion")}</Dialog.Title>
            <textarea
              className="mt-4 w-full border rounded px-2 py-1 min-h-[80px]"
              placeholder={t("feedbackPlaceholder")}
              value={feedback}
              onChange={(e) => setFeedback(e.target.value)}
            />
            <div className="flex justify-end gap-2 mt-6">
              <Button variant="outline" onClick={() => setOpen(false)}>
                {tc("close")}
              </Button>
              <Button
                onClick={async () => {
                  if (!detailId) return;
                  setOpen(false);
                  try {
                    await sendFeedback(detailId, false, true, feedback);
                    setFeedback("");
                    toast.success(t("feedbackSubmitSuccess"));
                  } catch (e: any) {
                    if (e?.response?.status === 409) {
                      toast.info(t("feedbackAlreadySubmitted"));
                      setDisliked(true);
                      setLiked(false);
                    } else {
                      toast.error(t("feedbackSubmitFailed"));
                    }
                  }
                }}
              >
                {t("submitFeedback")}
              </Button>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </div>
  );
};

export default FeedbackUI;
