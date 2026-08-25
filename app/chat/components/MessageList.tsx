import React from "react";
import { useTranslations } from "next-intl";
import { Bot, FileSpreadsheet, FileText, FileType, User } from "lucide-react";
import { MarkdownRenderer } from "@/components/MarkdownRenderer";
import FeedbackUI from "@/app/chat/components/FeedbackUI";
import ReferencesDisplay from "@/app/chat/components/ReferencesDisplay";
import TaskProgressCard from "@/app/chat/components/TaskProgressCard";
import { stripWorkflowRunStartedPrefix } from "@/hooks/useChatSession";
import type { Attachment } from "@/app/chat/hooks/useFileAttachments";
import type { TaskState } from "@/types/workflow-run";
import type { TurnUsage } from "@/types/token-usage";

function getFileIcon(mimetype?: string) {
  if (mimetype?.includes("pdf") || mimetype?.includes("PDF")) {
    return <FileType className="w-4 h-4 text-destructive" />;
  }

  if (
    mimetype?.includes("csv") ||
    mimetype?.includes("excel") ||
    mimetype?.includes("spreadsheet") ||
    mimetype?.includes("Excel")
  ) {
    return <FileSpreadsheet className="w-4 h-4 text-success" />;
  }

  return <FileText className="w-4 h-4 text-info" />;
}

interface Message {
  role: "user" | "assistant";
  content: string;
  reference?:
    | string
    | { id?: number; originalname: string; path: string; mimetype?: string }
    | { id?: number; originalname: string; path: string; mimetype?: string }[];
  segment_ids?: number[];
  detail_id?: number;
  usage?: TurnUsage;
  attachments?: Attachment[];
}

interface MessageListProps {
  messages: Message[];
  streamingMessage: string;
  isStreaming: boolean;
  segments: { [key: number]: any[] };
  segmentsLoading: { [key: number]: boolean };
  onOpenReferences: (messageIndex: number, segmentIds: number[]) => void;
  onPreviewFile: (file: any) => void;
  onPreviewAttachment: (attachment: Attachment) => void;
  sendFeedback: (detailId: number, feedbackType: string, feedbackText?: string) => Promise<any>;
  messagesContainerRef: React.RefObject<HTMLDivElement | null>;
  messagesEndRef: React.RefObject<HTMLDivElement | null>;
  /** runId → TaskState; rendered as a TaskProgressCard list at the top of the
   *  message scroll area. Empty when there are no active long-tasks. */
  activeRuns?: Record<number, TaskState>;
  /** Cancel callback passed to running task cards. */
  onCancelRun?: (runId: number) => void;
  /** In-flight tool indicator from `event: tool_status` SSE frames.
   *  `label` is the skill name when present, else the tool name;
   *  `failed: true` renders a lightweight failure hint instead. */
  toolStatus?: { label: string; failed: boolean } | null;
}

export default function MessageList({
  messages,
  streamingMessage,
  isStreaming,
  segments,
  segmentsLoading,
  onOpenReferences,
  onPreviewFile,
  onPreviewAttachment,
  sendFeedback,
  messagesContainerRef,
  messagesEndRef,
  activeRuns,
  onCancelRun,
  toolStatus,
}: MessageListProps) {
  const t = useTranslations("chat");

  const toolStatusText = toolStatus
    ? t(toolStatus.failed ? "toolFailed" : "toolRunning", { name: toolStatus.label })
    : null;

  const toolStatusIndicator = toolStatusText ? (
    <span
      data-testid="tool-status-indicator"
      className={`text-xs ${
        toolStatus?.failed ? "text-destructive" : "text-muted-foreground animate-pulse"
      }`}
    >
      {toolStatusText}
    </span>
  ) : null;
  // Long-task cards rendered at the top so users always see in-flight progress
  // when scrolled to the latest message (which auto-anchors to bottom).
  // Sort: running/queued first (most relevant), terminal last; within each
  // bucket sort by runId DESC (newest first).
  const taskCards = React.useMemo(() => {
    if (!activeRuns) return [] as TaskState[];
    const entries = Object.values(activeRuns);
    const ranking: Record<TaskState["status"], number> = {
      running: 0,
      queued: 1,
      failed: 2,
      succeeded: 3,
      cancelled: 4,
    };
    return entries.sort((a, b) => {
      const r = ranking[a.status] - ranking[b.status];
      if (r !== 0) return r;
      return b.runId - a.runId;
    });
  }, [activeRuns]);

  return (
    <div
      ref={messagesContainerRef}
      className="flex-1 flex flex-col gap-4 overflow-y-auto pb-4 pr-2"
      style={{ overflowAnchor: "none" }}
    >
      {taskCards.length > 0 && (
        <div className="flex flex-col gap-3" data-testid="active-task-list">
          {taskCards.map((state) => (
            <TaskProgressCard key={state.runId} taskState={state} onCancel={onCancelRun} />
          ))}
        </div>
      )}

      {messages.map((msg, i) =>
        msg.role === "user" ? (
          <div key={i} className="flex justify-end">
            <div className="flex items-start gap-2 sm:gap-3 max-w-[95%] sm:max-w-[85%]">
              <div className="bg-primary text-primary-foreground rounded-2xl rounded-tr-sm px-4 py-3">
                <div className="whitespace-pre-line break-words">
                  <MarkdownRenderer content={msg.content} />
                  {msg.attachments && msg.attachments.length > 0 && (
                    <div className="mt-2 space-y-1">
                      {msg.attachments.map((attachment, index) => (
                        <button
                          type="button"
                          key={index}
                          onClick={() => onPreviewAttachment(attachment)}
                          className="flex items-center gap-2 text-xs bg-primary-foreground/10 px-2 py-1 rounded hover:bg-primary-foreground/20 transition-colors w-full text-left"
                        >
                          {getFileIcon(attachment.type)}
                          <span className="flex-1 truncate">{attachment.filename}</span>
                          <span className="opacity-70">({attachment.type})</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>
              <div className="w-8 h-8 rounded-full bg-primary/10 hidden sm:flex items-center justify-center flex-shrink-0">
                <User className="w-4 h-4 text-primary" />
              </div>
            </div>
          </div>
        ) : (
          <div key={i} className="flex justify-start">
            <div className="flex items-start gap-2 sm:gap-3 max-w-[95%] sm:max-w-[95%] w-full">
              <div className="w-8 h-8 rounded-full bg-muted hidden sm:flex items-center justify-center flex-shrink-0">
                <Bot className="w-4 h-4 text-success" />
              </div>
              <div className="bg-muted rounded-2xl rounded-tl-sm px-3 sm:px-4 py-3 min-w-0 flex-1">
                <div className="break-words">
                  <MarkdownRenderer content={stripWorkflowRunStartedPrefix(msg.content)} />
                </div>
                <ReferencesDisplay
                  messageIndex={i}
                  reference={msg.reference}
                  segmentIds={msg.segment_ids}
                  segmentsLoading={segmentsLoading}
                  onOpenReferencesDialog={onOpenReferences}
                  onPreviewFile={onPreviewFile}
                />
                <FeedbackUI
                  detailId={msg.detail_id}
                  usage={msg.usage}
                  sendFeedback={sendFeedback}
                  content={msg.content}
                />
              </div>
            </div>
          </div>
        )
      )}

      {/* Thinking state - streaming started but no content yet */}
      {isStreaming && !streamingMessage && (
        <div className="flex justify-start">
          <div className="flex items-start gap-2 sm:gap-3 max-w-[95%] sm:max-w-[95%] w-full">
            <div className="w-8 h-8 rounded-full bg-muted hidden sm:flex items-center justify-center flex-shrink-0 animate-pulse">
              <Bot className="w-4 h-4 text-success" />
            </div>
            <div className="bg-muted rounded-2xl rounded-tl-sm px-4 py-3">
              <div className="flex items-center gap-2">
                <span className="flex items-center gap-1">
                  <span className="thinking-dot" />
                  <span className="thinking-dot" />
                  <span className="thinking-dot" />
                </span>
                {toolStatusIndicator}
              </div>
              <style jsx>{`
                .thinking-dot {
                  width: 5px;
                  height: 5px;
                  background-color: #999;
                  border-radius: 50%;
                  animation: thinking 1.4s infinite ease-in-out both;
                }
                .thinking-dot:nth-child(1) {
                  animation-delay: 0s;
                }
                .thinking-dot:nth-child(2) {
                  animation-delay: 0.16s;
                }
                .thinking-dot:nth-child(3) {
                  animation-delay: 0.32s;
                }
                @keyframes thinking {
                  0%, 80%, 100% {
                    transform: scale(0.6);
                    opacity: 0.5;
                  }
                  40% {
                    transform: scale(1);
                    opacity: 1;
                  }
                }
              `}</style>
            </div>
          </div>
        </div>
      )}

      {/* Streaming message - has content */}
      {isStreaming && streamingMessage && (
        <div className="flex justify-start">
          <div className="flex items-start gap-2 sm:gap-3 max-w-[95%] sm:max-w-[95%] w-full">
            <div className="w-8 h-8 rounded-full bg-muted hidden sm:flex items-center justify-center flex-shrink-0">
              <Bot className="w-4 h-4 text-success" />
            </div>
            <div className="bg-muted rounded-2xl rounded-tl-sm px-3 sm:px-4 py-3 min-w-0 flex-1">
              <div className="break-words">
                <MarkdownRenderer content={stripWorkflowRunStartedPrefix(streamingMessage)} />
                <span className="inline-flex items-center gap-1 ml-1 align-middle">
                  <span className="streaming-dot" />
                  <span className="streaming-dot" />
                  <span className="streaming-dot" />
                </span>
                {toolStatusIndicator && <div className="mt-1">{toolStatusIndicator}</div>}
                <style jsx>{`
                  .streaming-dot {
                    display: inline-block;
                    width: 4px;
                    height: 4px;
                    background-color: #999;
                    border-radius: 50%;
                    animation: streaming 1.4s infinite ease-in-out both;
                  }
                  .streaming-dot:nth-child(1) {
                    animation-delay: 0s;
                  }
                  .streaming-dot:nth-child(2) {
                    animation-delay: 0.16s;
                  }
                  .streaming-dot:nth-child(3) {
                    animation-delay: 0.32s;
                  }
                  @keyframes streaming {
                    0%, 80%, 100% {
                      transform: scale(0.6);
                      opacity: 0.4;
                    }
                    40% {
                      transform: scale(1);
                      opacity: 1;
                    }
                  }
                `}</style>
              </div>
            </div>
          </div>
        </div>
      )}

      <div ref={messagesEndRef} />
    </div>
  );
}
