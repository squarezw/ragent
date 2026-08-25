"use client";
import { useTranslations } from "next-intl";
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
  const [toolStatus, setToolStatus] = useState<{ label: string; failed: boolean } | null>(null);

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
    setToolStatus(null);
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
    setToolStatus(null);
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
            setToolStatus({ label, failed: false });
          } else if (status.ok === false) {
            // Keep a lightweight failure hint until the model's follow-up
            // tokens explain it (cleared on complete/error/new send).
            setToolStatus({ label, failed: true });
          } else {
            setToolStatus(null);
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
          setToolStatus(null);
          setLoading(false);
          abortControllerRef.current = null;
        },
        onError: (error: any) => {
          console.error("Stream error:", error);
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
          setToolStatus(null);
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
      setToolStatus(null);
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
      setToolStatus(null);
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
              toolStatus={toolStatus}
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
