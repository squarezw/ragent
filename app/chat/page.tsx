"use client";
import { useTranslations } from "next-intl";
import type { ToolStep } from "./components/ToolActivity";
import WelcomeView from "@/app/chat/components/WelcomeView";
import ChatInputComposite from "@/app/chat/components/ChatInputComposite";
import ChatHeader from "@/app/chat/components/ChatHeader";
import MessageList from "@/app/chat/components/MessageList";
import HistoryDialog from "@/app/chat/components/HistoryDialog";
import ReferencesDialog from "@/app/chat/components/ReferencesDialog";
import { FilePreviewDialog } from "@/components/FilePreviewDialog";
import { useSidebar } from "@/components/ui/sidebar";
import { useChatHistory } from "@/hooks/useChatHistory";
import { useChatSegments } from "@/hooks/useChatSegments";
import { useChatSession } from "@/hooks/useChatSession";
import { useDatasets } from "@/hooks/useDatasets";
import { useTaskAttach } from "@/hooks/useTaskAttach";
import { useOrganization } from "@/hooks/useOrganization";
import { useVoiceRecorder } from "@/hooks/useVoiceRecorder";
import { useSpeechToText } from "@/hooks/useSpeechToText";
import axios from "@/lib/axios";
import { useFileAttachments } from "@/app/chat/hooks/useFileAttachments";
import { useAppDatasets } from "@/app/chat/hooks/useAppDatasets";
import { useMessageScroll } from "@/app/chat/hooks/useMessageScroll";
import { useCallback, useEffect, useRef, useState } from "react";
import type { Attachment } from "./hooks/useFileAttachments";
import type { TurnUsage } from "@/types/token-usage";

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

export default function ChatPage() {
  const t = useTranslations("chat");
  const { askStream, sendFeedback, setChatId, chatId } = useChatSession();
  const { activeRuns, attachRun, cancelRun } = useTaskAttach(chatId);

  const { datasets } = useDatasets();
  const { organizedDatasets, loading: orgLoading } = useOrganization();
  const [historyOpen, setHistoryOpen] = useState(false);
  const { history: historySummaries, loading: historyLoading } = useChatHistory(historyOpen, 50);
  const { segments, segmentsLoading, fetchSegments } = useChatSegments();

  // Local state
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const abortControllerRef = useRef<(() => void) | null>(null);

  const [enableWebSearch] = useState(false);
  const [streamingMessage, setStreamingMessage] = useState<string>("");
  const [isStreaming, setIsStreaming] = useState(false);
  // In-flight tool indicator driven by `event: tool_status` SSE frames.
  // `label` prefers the skill name over the raw tool name.
  // 本轮的工具调用列表。此前每来一帧就整个替换 —— 一轮调了五个工具只看得到
  // 第五个，前四个不留痕迹。帧一直都在，是界面把它们丢了。
  const [toolSteps, setToolSteps] = useState<ToolStep[]>([]);

  const [referencesDialogOpen, setReferencesDialogOpen] = useState(false);
  const [currentMessageIndex, setCurrentMessageIndex] = useState<number>(-1);
  const [loadingHistorySession, setLoadingHistorySession] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const { setOpen: setSidebarOpen } = useSidebar();

  // Custom hooks
  const {
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
  } = useFileAttachments();

  const {
    apps,
    appsLoading,
    selectedAppId,
    selectedDatasetIds,
    appDatasets,
    appDatasetIds,
    optionalDatasetSelections,
    handleAppSelect,
    handleDatasetToggle,
  } = useAppDatasets();

  const { messagesContainerRef, messagesEndRef, scrollToBottom } = useMessageScroll(
    messages,
    isStreaming,
    streamingMessage
  );

  // Voice input
  const voiceMaxSeconds = 15;

  const { status: sttStatus, transcribe } = useSpeechToText({
    onResult: (text) => {
      setInput((prev) => (prev ? prev + " " + text : text));
    },
    onError: (error) => {
      alert(t("voiceRecognitionFailed"));
      console.error("[STT] Error:", error);
    },
  });

  const {
    status: voiceStatus,
    secondsElapsed: voiceSecondsElapsed,
    startRecording,
    stopRecording,
    cancelRecording,
  } = useVoiceRecorder({
    maxSeconds: voiceMaxSeconds,
    onRecordingComplete: (blob) => {
      transcribe(blob);
    },
    onError: (error) => {
      if (error.message === "NotAllowedError") {
        alert(t("micPermissionDenied"));
      } else if (error.message === "NotFoundError") {
        alert(t("micNotFound"));
      } else {
        alert(t("voiceRecordingFailed"));
      }
      console.error("[Voice] Error:", error);
    },
  });

  // Initialize default dataset selection
  const hasInitializedDatasets = useRef(false);
  useEffect(() => {
    if (datasets.length > 0 && !hasInitializedDatasets.current) {
      hasInitializedDatasets.current = true;

      const savedDatasetIds = localStorage.getItem("selectedDatasetIds");
      if (savedDatasetIds) {
        try {
          const ids = JSON.parse(savedDatasetIds);
          if (Array.isArray(ids) && ids.length > 0) {
            const validIds = ids.filter((id) => datasets.find((d) => d.id === id));
            if (validIds.length > 0) {
              return;
            }
          }
        } catch (e) {
          console.error("Failed to parse saved dataset IDs:", e);
        }
      }
    }
  }, [datasets]);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Toggle fullscreen mode
  const toggleFullscreen = () => {
    const newFullscreenState = !isFullscreen;
    setIsFullscreen(newFullscreenState);
    setSidebarOpen(!newFullscreenState);
  };

  // Start new conversation
  const startNewConversation = useCallback(() => {
    setMessages([]);
    setInput("");
    setAttachments([]);
    setStreamingMessage("");
    setIsStreaming(false);
    setToolSteps([]);
    setChatId(0);
  }, [setChatId, setAttachments]);

  const handleSend = async () => {
    if (!input.trim() && attachments.length === 0) return;

    const userDisplayContent = input.trim();

    const userMsg: Message = {
      role: "user",
      content: userDisplayContent,
      attachments: [...attachments],
    };

    setMessages((msgs) => [...msgs, userMsg]);
    setInput("");
    const attachmentsToSend = [...attachments];
    setAttachments([]);
    setLoading(true);
    setStreamingMessage("");
    setIsStreaming(true);
    setToolSteps([]);
    abortControllerRef.current = null;

    try {
      const params: any = {
        enableWebSearch,
        attachments: attachmentsToSend.length > 0 ? attachmentsToSend : undefined,
      };

      let datasetIdsForSession: string[] = [];

      if (selectedAppId) {
        params.app_id = Number(selectedAppId);
        datasetIdsForSession = appDatasetIds.length > 0 ? appDatasetIds : [];

        const optionalIds = Array.from(optionalDatasetSelections);
        if (optionalIds.length > 0) {
          params.datasetId = optionalIds;
        } else {
          params.datasetId = undefined;
        }
      } else {
        datasetIdsForSession = selectedDatasetIds;
        if (selectedDatasetIds.length > 0) {
          params.datasetId = selectedDatasetIds;
        }
      }

      const result = await askStream(userDisplayContent, datasetIdsForSession, params, {
        onChunk: (chunk: string) => {
          setStreamingMessage((prev) => prev + chunk);
        },
        onWorkflowRunStarted: (runId, kind) => {
          attachRun(runId, kind);
        },
        onToolStatus: (status) => {
          const label = status.display_name || status.skill || status.name;
          if (status.phase === "started") {
            setToolSteps((prev) => [
              ...prev,
              {
                id: prev.length,
                label,
                purpose: status.purpose,
                detail: status.detail,
                startedAt: Date.now(),
              },
            ]);
          } else {
            // finished：结掉**最后一个同名且未结束**的步骤。
            //
            // 这些帧没有携带 tool_call_id，所以只能按名字回填。从后往前找是因为
            // 同一个工具可能被连调多次（模型轮询就是这样）—— 从前往后会把新的
            // finished 记到早已结束的那一条上，表现是「有的步骤永远转圈」。
            setToolSteps((prev) => {
              const i = prev.map((x) => x.label).lastIndexOf(label);
              if (i < 0 || prev[i].ok !== undefined) return prev;
              const next = [...prev];
              next[i] = { ...next[i], ok: status.ok !== false, endedAt: Date.now() };
              return next;
            });
          }
        },
        onComplete: (result: any) => {
          const { answer, detail_id, reference, segment_ids, usage } = result;
          setMessages((msgs) => [
            ...msgs,
            {
              role: "assistant",
              content: answer,
              reference,
              segment_ids,
              detail_id,
              usage,
            },
          ]);
          setIsStreaming(false);
          setStreamingMessage("");
          setToolSteps([]);
          setLoading(false);
          abortControllerRef.current = null;
        },
        onError: (error: any) => {
          // 余额不足不是故障，是一个用户自己能解决的状态。套上「抱歉，发生了错误」
          // 会把「去充值」读成「系统坏了」—— 用户会去找运维，而不是找管理员充值。
          const insufficient = error?.code === "insufficient_balance";
          // 余额不足是正常的业务状态，不是故障。用 console.error 打出来会带一条
          // 红色堆栈（Error 记的是构造点，指向 streamPromise），看起来像崩溃 ——
          // 用户和排查的人都会被它误导。
          if (insufficient) console.info("[Chat] insufficient balance");
          else console.error("Stream error:", error);
          setMessages((msgs) => [
            ...msgs,
            {
              role: "assistant",
              // 余额不足这条**不插值后端文案**：后端不知道用户选的哪种语言，
              // 拼进来就会在中文界面里出现英文（或反过来）。界面自己完整表达。
              content: insufficient
                ? t("insufficientBalance")
                : t("errorOccurred", { message: error.message }),
              segment_ids: [],
              detail_id: undefined,
            },
          ]);
          setIsStreaming(false);
          setStreamingMessage("");
          setToolSteps([]);
          setLoading(false);
          abortControllerRef.current = null;
        },
      });

      if (result?.abort) {
        abortControllerRef.current = result.abort;
      }
    } catch (error: any) {
      console.error("Send error:", error);
      setMessages((msgs) => [
        ...msgs,
        {
          role: "assistant",
          content: t("errorOccurred", { message: error.message }),
          segment_ids: [],
          detail_id: undefined,
        },
      ]);
      setIsStreaming(false);
      setStreamingMessage("");
      setToolSteps([]);
      setLoading(false);
      abortControllerRef.current = null;
    }

    inputRef.current?.focus();
  };

  // Handle stop streaming
  const handleStop = () => {
    if (abortControllerRef.current) {
      try {
        abortControllerRef.current();
      } catch (error) {
        if (error instanceof Error && error.name !== "AbortError") {
          console.warn("[Chat] Stop error (non-critical):", error);
        }
      }
      abortControllerRef.current = null;

      if (streamingMessage.trim()) {
        setMessages((msgs) => [
          ...msgs,
          {
            role: "assistant",
            content: streamingMessage,
            segment_ids: [],
            detail_id: undefined,
          },
        ]);
      }

      setIsStreaming(false);
      setStreamingMessage("");
      setToolSteps([]);
      setLoading(false);
    }
  };

  // Open references dialog
  const openReferencesDialog = async (messageIndex: number, segmentIds: number[]) => {
    setCurrentMessageIndex(messageIndex);
    setReferencesDialogOpen(true);

    if (!segments[messageIndex]) {
      await fetchSegments(segmentIds, messageIndex);
    }
  };

  // Load history session
  const loadHistorySession = async (sessionId: number) => {
    setLoadingHistorySession(true);
    try {
      const response = await axios.get(`/api/chat/sessions/${sessionId}/details`);
      const sessionData = response.data;

      const historyMessages: Message[] = [];

      if (sessionData.details && sessionData.details.length > 0) {
        for (const detail of sessionData.details) {
          historyMessages.push({
            role: "user",
            content: detail.question || "",
          });

          let formattedReference: any;
          if (detail.references && detail.references.length > 0) {
            const refObjects = detail.references.map((ref: any) => ({
              id: ref.id,
              originalname: ref.originalname || ref.filename || "",
              path: ref.path || "",
              mimetype: ref.mimetype,
            }));
            formattedReference = refObjects.length === 1 ? refObjects[0] : refObjects;
          }

          historyMessages.push({
            role: "assistant",
            content: detail.answer || "",
            reference: formattedReference,
            segment_ids: detail.segmentsIds || [],
            detail_id: detail.id,
            usage: detail.usage,
          });
        }
      }

      setMessages(historyMessages);
      setHistoryOpen(false);
      setChatId(sessionId);

      setTimeout(() => {
        scrollToBottom(true);
      }, 100);
    } catch (error: any) {
      console.error("Load history session failed:", error);
      alert(`${t("loadHistoryFailed")}: ${error.response?.data?.error || error.message}`);
    } finally {
      setLoadingHistorySession(false);
    }
  };

  // Shared input props for WelcomeView and ChatInputComposite
  const inputProps = {
    input,
    onInputChange: setInput,
    onSend: handleSend,
    onStop: handleStop,
    loading,
    isStreaming,
    attachments,
    uploading,
    onFileSelect: handleFileSelect,
    onFileDrop: handleFileDrop,
    onRemoveAttachment: removeAttachment,
    fileInputRef,
    onHistoryOpen: () => setHistoryOpen(true),
    apps,
    appsLoading,
    selectedAppId,
    appDatasets,
    optionalDatasetSelections,
    selectedDatasetIds,
    onAppSelect: handleAppSelect,
    onDatasetToggle: handleDatasetToggle,
    organizedDatasets,
    orgLoading,
    voiceStatus,
    voiceSecondsElapsed,
    voiceMaxSeconds,
    sttStatus,
    onMicClick: startRecording,
    onVoiceStop: stopRecording,
    onVoiceCancel: cancelRecording,
  };

  const showWelcomeView = messages.length === 0;

  return (
    <>
      <div className="w-full h-[calc(100vh-112px)] relative">
        {showWelcomeView ? (
          <WelcomeView {...inputProps} />
        ) : (
          <div
            className={`flex flex-col h-full mx-auto px-1 sm:px-4 transition-all duration-300 ${
              isFullscreen ? "max-w-6xl" : "max-w-4xl"
            }`}
          >
            <ChatHeader
              isFullscreen={isFullscreen}
              onToggleFullscreen={toggleFullscreen}
              onNewConversation={startNewConversation}
            />

            <MessageList
              messages={messages}
              streamingMessage={streamingMessage}
              isStreaming={isStreaming}
              toolSteps={toolSteps}
              toolsRunning={isStreaming}
              segments={segments}
              segmentsLoading={segmentsLoading}
              onOpenReferences={openReferencesDialog}
              onPreviewFile={setPreviewFile}
              onPreviewAttachment={handlePreviewAttachment}
              sendFeedback={sendFeedback}
              messagesContainerRef={messagesContainerRef}
              messagesEndRef={messagesEndRef}
              activeRuns={activeRuns}
              onCancelRun={cancelRun}
            />

            {/* Bottom input area */}
            <div className="flex-shrink-0 pb-4">
              <ChatInputComposite {...inputProps} placeholder={t("placeholderReply")} />
              <p className="text-xs text-muted-foreground mt-2 text-center">{t("aiDisclaimer")}</p>
            </div>
          </div>
        )}
      </div>

      <FilePreviewDialog
        file={previewFile}
        open={!!previewFile}
        onOpenChange={(v) => !v && setPreviewFile(null)}
      />

      <HistoryDialog
        open={historyOpen}
        onOpenChange={setHistoryOpen}
        historySummaries={historySummaries}
        historyLoading={historyLoading}
        loadingHistorySession={loadingHistorySession}
        onLoadSession={loadHistorySession}
      />

      <ReferencesDialog
        open={referencesDialogOpen}
        onOpenChange={setReferencesDialogOpen}
        segments={segments}
        segmentsLoading={segmentsLoading}
        currentMessageIndex={currentMessageIndex}
      />
    </>
  );
}
