"use client";

import React, { useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { Button } from "@/components/ui/button";
import { ThumbsUp, ThumbsDown, Download, Copy, Check } from "lucide-react";
import axios from "@/lib/axios";
import { copyText } from "@/lib/clipboard";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import type { TurnUsage } from "@/types/token-usage";

interface FeedbackUIProps {
  detailId?: number;
  usage?: TurnUsage;
  sendFeedback: (
    detailId: number,
    voteGood: boolean,
    voteBad: boolean,
    feedback: string
  ) => Promise<void>;
  content?: string;
}

const FeedbackUI: React.FC<FeedbackUIProps> = ({ detailId, sendFeedback, content, usage }) => {
  const t = useTranslations("chat");
  const tc = useTranslations("common");
  const [open, setOpen] = useState(false);
  const [liked, setLiked] = useState(false);
  const [disliked, setDisliked] = useState(false);
  const [feedback, setFeedback] = useState("");
  const [isExporting, setIsExporting] = useState(false);
  const [copied, setCopied] = useState(false);

  // 复制成功后图标短暂变成对勾。用 ref 记 timer 是为了在组件卸载时清掉——
  // 聊天里换会话会卸载消息，定时器打到已卸载组件上会报 setState 警告。
  const copiedTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  React.useEffect(() => {
    return () => {
      if (copiedTimer.current) clearTimeout(copiedTimer.current);
    };
  }, []);

  const handleCopy = async () => {
    if (!content) return;
    const ok = await copyText(content);
    if (!ok) {
      // 必须报出来。客户内网是 http，复制可能真的做不到，
      // 静默失败会让人以为复制成功、粘贴出来才发现是旧内容。
      toast.error(tc("copyFailed"));
      return;
    }
    toast.success(tc("copied"));
    setCopied(true);
    if (copiedTimer.current) clearTimeout(copiedTimer.current);
    copiedTimer.current = setTimeout(() => setCopied(false), 2000);
  };

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

  // 「共消耗」只在**有记录**时出现。
  // usage 缺席 ≠ 消耗为 0：存量对话、provider 没回 usage 都会缺席，
  // 渲染成「共消耗 0」会被读成「这轮免费」。
  const totalTokens = usage?.totalTokens;
  const hasUsage = typeof totalTokens === "number";

  return (
    <div className="flex items-center gap-2 mt-2">
      {content && (
        <Button
          size="icon"
          variant="ghost"
          title={t("copyAnswer")}
          aria-label={t("copyAnswer")}
          onClick={handleCopy}
        >
          {copied ? (
            <Check className="w-5 h-5 text-success" />
          ) : (
            <Copy className="w-5 h-5 text-muted-foreground" />
          )}
        </Button>
      )}
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
      {hasUsage && (
        <span
          className="ml-1 text-xs text-muted-foreground whitespace-nowrap"
          title={tokenUsageDetail(t, usage!)}
        >
          {t("tokenTotal", { count: formatTokenCount(totalTokens!) })}
          {usage?.partial ? t("tokenPartialMark") : ""}
        </span>
      )}
    </div>
  );
};

/** 大数字读起来费劲：12,345 比 12345 快得多；上万折成 k 更快 */
function formatTokenCount(n: number): string {
  if (n >= 10000) return `${(n / 1000).toFixed(1)}k`;
  return n.toLocaleString();
}

/**
 * hover 出来的明细。
 *
 * 带上「调了几次模型」是有用的：一轮对话不等于一次调用，agent 每个工具轮次都重发
 * 完整上下文，输入量因此逐轮累积。看到一个很大的输入量时，这个数字能立刻区分
 * 「上下文长」还是「工具轮次多」——这两者的处置完全不同。
 */
type ChatTranslator = ReturnType<typeof useTranslations<"chat">>;

function tokenUsageDetail(t: ChatTranslator, usage: TurnUsage): string {
  const parts = [
    t("tokenInput", { count: (usage.promptTokens ?? 0).toLocaleString() }),
    t("tokenOutput", { count: (usage.completionTokens ?? 0).toLocaleString() }),
  ];
  if (usage.llmCalls) parts.push(t("tokenCalls", { count: usage.llmCalls }));
  // 命中缓存的输入按约 1/10 计价 —— 同样的 token 数，成本可能差十倍。
  // 只看总量会对成本产生完全错误的直觉。
  if (usage.cacheReadTokens) {
    parts.push(t("tokenCached", { count: usage.cacheReadTokens.toLocaleString() }));
  }
  if (usage.modelName) parts.push(usage.modelName);
  if (usage.partial) parts.push(t("tokenPartialHint"));
  return parts.join(" · ");
}

export default FeedbackUI;
