"use client";
import { workspaceUrl } from "@/lib/workspaceBrowser";
import { toast } from "sonner";
import { useTranslations } from "next-intl";
import { parseWorkspaceBindingWarning } from "@/lib/chatSse";
import type { ToolStep } from "./components/ToolActivity";
import KnowledgeWriteCard from "./components/KnowledgeWriteCard";
import type { KnowledgeWriteConfirmation } from "@/lib/knowledgeWrite";
import WelcomeView from "@/app/chat/components/WelcomeView";
import ChatInputComposite from "@/app/chat/components/ChatInputComposite";
import MessageList from "@/app/chat/components/MessageList";
import HistoryDialog from "@/app/chat/components/HistoryDialog";
import ReferencesDialog from "@/app/chat/components/ReferencesDialog";
import ResourcePreviewPanel from "@/app/chat/components/ResourcePreviewPanel";
import { FilePreviewDialog } from "@/components/FilePreviewDialog";
import { useChatHistory } from "@/hooks/useChatHistory";
import { useChatSegments } from "@/hooks/useChatSegments";
import { useChatRun, chatRunStorageKey } from "@/hooks/useChatRun";
import { useStreamingText } from "@/hooks/useStreamingText";
import { terminalRun, chatRunErrorMessageKey } from "@/lib/chatRun";
import type { ChatRunSnapshot } from "@/types/chat-run";
import { parseKnowledgeWriteConfirmation } from "@/lib/knowledgeWrite";
import { normalizeTurnUsage } from "@/types/token-usage";
import { useWorkspace } from "@/app/components/WorkspaceProvider";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { useChatSession } from "@/hooks/useChatSession";
import { useDatasets } from "@/hooks/useDatasets";
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
import { getFileDownloadUrl } from "@/lib/fileApi";
import { getFileUrl } from "@/lib/ossUpload";
import type { SessionAttachment } from "@/lib/sessionAttachments";
import {
  downloadChatLink,
  attachmentPreviewResource,
  type PreviewResource,
} from "@/lib/chatResourcePreview";

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

function toHistoryAttachments(raw: SessionAttachment[] | undefined): Attachment[] | undefined {
  if (!raw || raw.length === 0) return undefined;
  return raw.map((attachment) => ({
    filename: attachment.filename,
    type: attachment.contentType || "File",
    content: "",
    url: getFileUrl(attachment.objectKey),
    objectKey: attachment.objectKey,
    size: attachment.size,
  }));
}

export default function ChatPage() {
  const t = useTranslations("chat");
  const { sendFeedback } = useChatSession();
  const { start, subscribe, detach, stop, active, snapshot, setChatId, connection } = useChatRun();
  const workspace = useWorkspace();
  const { user } = useCurrentUser();
  const runRef = useRef<ChatRunSnapshot | null>(null);
  const [runStatus, setRunStatus] = useState<ChatRunSnapshot["status"] | null>(null);
  const [stopPending, setStopPending] = useState(false);
  const [stopFailed, setStopFailed] = useState(false);
  const restoreEntry = useRef("");
  const pendingRestoredApp = useRef<string | null>(null);

  const { datasets } = useDatasets();
  const { organizedDatasets, loading: orgLoading } = useOrganization();
  const [historyOpen, setHistoryOpen] = useState(false);
  const { history: historySummaries, loading: historyLoading } = useChatHistory(historyOpen, 50);
  const { segments, segmentsLoading, fetchSegments } = useChatSegments();

  // Local state
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const chatContainerRef = useRef<HTMLDivElement>(null);
  const conversationVersion = useRef(0);
  const focusInput = useCallback(() => {
    chatContainerRef.current?.querySelector<HTMLTextAreaElement>("textarea")?.focus();
  }, []);

  const [enableWebSearch] = useState(false);
  const [streamingMessage, setStreamingMessage] = useState<string>("");
  const [isStreaming, setIsStreaming] = useState(false);
  // In-flight tool indicator driven by `event: tool_status` SSE frames.
  // `label` prefers the skill name over the raw tool name.
  // 本轮的工具调用列表。此前每来一帧就整个替换 —— 一轮调了五个工具只看得到
  // 第五个，前四个不留痕迹。帧一直都在，是界面把它们丢了。
  const [toolSteps, setToolSteps] = useState<ToolStep[]>([]);
  const [knowledgeWrites, setKnowledgeWrites] = useState<KnowledgeWriteConfirmation[]>([]);

  const [referencesDialogOpen, setReferencesDialogOpen] = useState(false);
  const [currentMessageIndex, setCurrentMessageIndex] = useState<number>(-1);
  const [loadingHistorySession, setLoadingHistorySession] = useState(false);
  const [previewResource, setPreviewResource] = useState<PreviewResource | null>(null);

  // Custom hooks
  const {
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
    handleClearDatasets,
    operationTenantId,
  } = useAppDatasets();

  // biome-ignore lint/correctness/useExhaustiveDependencies: actor/workspace identity is the isolation boundary.
  useEffect(() => {
    conversationVersion.current += 1;
    detach();
    pendingRestoredApp.current = null;
    runRef.current = null;
    setRunStatus(null);
    setStopPending(false);
    setStopFailed(false);
    setMessages([]);
    setStreamingMessage("");
    setToolSteps([]);
    setChatId(null);
    setAttachments([]);
    setInput("");
    setKnowledgeWrites([]);
    setLoading(false);
    setIsStreaming(false);
    // Identity changes intentionally clear the entire view even if setters are stable.
  }, [operationTenantId, user?.id, detach, setChatId, setAttachments]);

  const visibleStreamingMessage = useStreamingText(
    streamingMessage,
    isStreaming,
    runRef.current?.run_id ?? null
  );
  const { messagesContainerRef, messagesEndRef, scrollToBottom } = useMessageScroll(
    messages,
    isStreaming,
    visibleStreamingMessage
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
    focusInput();
    return () => {
      conversationVersion.current += 1;
      detach();
    };
  }, [focusInput, detach]);

  // Start new conversation
  const startNewConversation = useCallback(() => {
    setKnowledgeWrites([]);
    conversationVersion.current += 1;
    detach();
    setLoading(false);
    setLoadingHistorySession(false);
    setHistoryOpen(false);
    setReferencesDialogOpen(false);
    setCurrentMessageIndex(-1);
    setPreviewFile(null);
    cancelRecording();
    setMessages([]);
    setInput("");
    setAttachments([]);
    setStreamingMessage("");
    setIsStreaming(false);
    setToolSteps([]);
    setPreviewResource(null);
    pendingRestoredApp.current = null;
    runRef.current = null;
    setRunStatus(null);
    setStopFailed(false);
    setChatId(null);
    try {
      sessionStorage.removeItem(chatRunStorageKey());
      localStorage.removeItem(chatRunStorageKey());
      sessionStorage.removeItem(`${chatRunStorageKey()}:pending`);
    } catch {}
    requestAnimationFrame(focusInput);
  }, [setChatId, setAttachments, setPreviewFile, cancelRecording, focusInput, detach]);

  useEffect(() => {
    window.addEventListener("ragent:new-conversation", startNewConversation);
    return () => window.removeEventListener("ragent:new-conversation", startNewConversation);
  }, [startNewConversation]);

  const attachRun = (run: ChatRunSnapshot, version: number) => {
    const isCurrent = () => version === conversationVersion.current;
    subscribe(
      run,
      (next) => {
        if (!isCurrent()) return;
        runRef.current = next;
        setRunStatus(next.status);
        setChatId(next.session_id);
        const done = terminalRun(next.status);
        setLoading(!done);
        setIsStreaming(!done);
        setStreamingMessage(done ? "" : next.answer);
        setKnowledgeWrites(
          next.pending_confirmations.flatMap((raw) => {
            const value = parseKnowledgeWriteConfirmation(raw);
            return value ? [value] : [];
          })
        );
        setToolSteps(
          next.tool_steps.map((step, index) => ({
            id: typeof step.tool_call_id === "string" ? step.tool_call_id : index,
            toolCallId: typeof step.tool_call_id === "string" ? step.tool_call_id : undefined,
            label: String(step.display_name || step.skill || step.name || ""),
            purpose: typeof step.purpose === "string" ? step.purpose : undefined,
            detail: typeof step.detail === "string" ? step.detail : undefined,
            startedAt: Date.parse(String(step.started_at || next.updated_at)) || 0,
            endedAt: step.ended_at ? Date.parse(String(step.ended_at)) : undefined,
            ok: step.phase === "finished" ? step.ok !== false : undefined,
          }))
        );
        setMessages((previous) => {
          const messages = previous.filter(
            (message) => !(message.role === "assistant" && message.detail_id === next.detail_id)
          );
          const last = messages[messages.length - 1];
          if (last?.role === "user" && last.detail_id == null)
            messages[messages.length - 1] = { ...last, detail_id: next.detail_id };
          if (!done) return messages;
          const result = next.result ?? {};
          let content = next.answer;
          if (next.status !== "completed") {
            const notice =
              next.status === "cancelled"
                ? t("runCancelled")
                : next.status === "interrupted"
                  ? t("runInterrupted")
                  : t(chatRunErrorMessageKey(next.error?.code));
            content = content ? `${content}\n\n${notice}` : notice;
          }
          messages.push({
            role: "assistant",
            content,
            detail_id: next.detail_id,
            reference: (result.references ?? result.reference) as Message["reference"],
            segment_ids: Array.isArray(result.segment_ids) ? (result.segment_ids as number[]) : [],
            usage: normalizeTurnUsage(next.usage ?? result.usage),
          });
          return messages;
        });
        if (done) {
          setStopPending(false);
          setToolSteps([]);
        }
      },
      (event) => {
        if (!isCurrent() || event.event !== "workspace_warning") return;
        // Only the existing safe count parser can turn warnings into UI data.
        const warning = parseWorkspaceBindingWarning(event.data);
        if (warning)
          toast.warning(
            t("workspaceBindingsSkipped", {
              resources: [
                warning.skipped.skills
                  ? t("workspaceSkippedSkills", { count: warning.skipped.skills })
                  : null,
                warning.skipped.tools
                  ? t("workspaceSkippedTools", { count: warning.skipped.tools })
                  : null,
                warning.skipped.datasets
                  ? t("workspaceSkippedDatasets", { count: warning.skipped.datasets })
                  : null,
              ]
                .filter(Boolean)
                .join(t("workspaceBindingSeparator")),
            })
          );
      }
    );
  };

  const handleSend = async () => {
    if (loading || uploading || loadingHistorySession || !input.trim()) return;
    if (!workspace.ready || !user?.id || !operationTenantId) return;
    const version = ++conversationVersion.current;
    const question = input.trim();
    const uploaded = [...attachments];
    setMessages((previous) => [
      ...previous,
      { role: "user", content: question, attachments: uploaded },
    ]);
    setInput("");
    setAttachments([]);
    setKnowledgeWrites([]);
    setStopFailed(false);
    setLoading(true);
    setIsStreaming(true);
    setStreamingMessage("");
    setToolSteps([]);
    try {
      const params: Record<string, unknown> = {
        enableWebSearch,
        attachments: uploaded.length ? uploaded : undefined,
      };
      const datasets = selectedAppId ? appDatasetIds : selectedDatasetIds;
      if (selectedAppId) {
        params.app_id = Number(selectedAppId);
        params.datasetId = optionalDatasetSelections.size
          ? Array.from(optionalDatasetSelections)
          : undefined;
      } else if (selectedDatasetIds.length) params.datasetId = selectedDatasetIds;
      const run = await start(question, datasets, params);
      if (version !== conversationVersion.current) return;
      attachRun(run, version);
    } catch (error) {
      if (version !== conversationVersion.current) return;
      // Admission was not retried. Keep the submitted question and let re-entry query its request ID.
      setLoading(false);
      setIsStreaming(false);
      const code = (error as { response?: { data?: { detail?: { code?: string } } } })?.response
        ?.data?.detail?.code;
      toast.error(
        code === "insufficient_balance"
          ? t("insufficientBalance")
          : code === "user_credit_account_busy"
            ? t("creditAccountBusy")
            : t("runStartFailed")
      );
    }
    focusInput();
  };

  const handleStop = async () => {
    if (stopPending || !runRef.current || terminalRun(runRef.current.status)) return;
    const version = conversationVersion.current;
    setStopPending(true);
    setStopFailed(false);
    try {
      await stop();
      // The returned snapshot or the subscribed status is authoritative; never fake cancellation.
    } catch {
      if (version === conversationVersion.current) {
        setStopFailed(true);
        toast.error(t("runStopFailed"));
      }
    } finally {
      if (version === conversationVersion.current) setStopPending(false);
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
  const loadHistorySession = async (sessionId: number | string, restoredRun?: ChatRunSnapshot) => {
    setKnowledgeWrites([]);
    const version = ++conversationVersion.current;
    const isCurrent = () => version === conversationVersion.current;
    detach();
    setLoading(false);
    setIsStreaming(false);
    setStreamingMessage("");
    setToolSteps([]);
    pendingRestoredApp.current = null;
    runRef.current = null;
    setRunStatus(null);
    setStopFailed(false);
    setLoadingHistorySession(true);
    try {
      const response = await axios.get(`/api/chat/sessions/${sessionId}/details`);
      if (!isCurrent()) return;
      const sessionData = response.data;

      const historyMessages: Message[] = [];

      if (sessionData.details && sessionData.details.length > 0) {
        for (const detail of sessionData.details) {
          historyMessages.push({
            role: "user",
            detail_id: detail.id,
            content: detail.question || "",
            attachments: toHistoryAttachments(detail.attachments),
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

          if (restoredRun?.detail_id === detail.id) continue;
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

      // 把数字员工切回这条会话原本用的那个。
      //
      // 不做这件事的后果不是"显示不对"——会话视图里根本不渲染员工选择器，
      // 用户看不见当前是谁、也没法改。继续提问就带着上次选的员工跑，
      // 于是找不到原来那条会话依赖的 skill，而界面上毫无提示。
      //
      // 老会话可能没记 app_id（线上 44%），那时保持当前选择不动 ——
      // 强行清空会让它们连默认员工都没有，比不改更糟。
      if (sessionData.appId != null) {
        handleAppSelect(String(sessionData.appId));
        pendingRestoredApp.current = apps.some((app) => app.id === Number(sessionData.appId))
          ? null
          : String(sessionData.appId);
      }

      setMessages(historyMessages);
      setPreviewResource(null);
      setHistoryOpen(false);
      setChatId(String(sessionId));
      const running = restoredRun ?? (await active(String(sessionId)))[0];
      if (!isCurrent()) return;
      if (running) attachRun(running, version);

      setTimeout(() => {
        if (isCurrent()) scrollToBottom(true);
      }, 100);
    } catch (error: any) {
      if (!isCurrent()) return;
      console.error("Load history session failed:", error);
      alert(`${t("loadHistoryFailed")}: ${error.response?.data?.error || error.message}`);
    } finally {
      if (isCurrent()) setLoadingHistorySession(false);
    }
  };

  useEffect(() => {
    const wanted = pendingRestoredApp.current;
    if (!appsLoading && wanted && apps.some((app) => String(app.id) === wanted)) {
      handleAppSelect(wanted);
      pendingRestoredApp.current = null;
    }
  }, [apps, appsLoading, handleAppSelect]);

  const loadHistoryRef = useRef(loadHistorySession);
  loadHistoryRef.current = loadHistorySession;
  const restoreErrorRef = useRef("");
  restoreErrorRef.current = t("runRestoreFailed");
  useEffect(() => {
    if (!workspace.ready || !user?.id || !operationTenantId) return;
    const entry = `${user.id}:${operationTenantId}`;
    if (restoreEntry.current === entry) return;
    restoreEntry.current = entry;
    const version = conversationVersion.current;
    let cancelled = false;
    const valid = () => !cancelled && version === conversationVersion.current;
    void (async () => {
      try {
        const explicit = new URLSearchParams(window.location.search).get("session_id");
        let remembered: { run_id?: string; session_id?: string } = {};
        let pending: string | null = null;
        try {
          remembered = JSON.parse(
            sessionStorage.getItem(chatRunStorageKey()) ||
              localStorage.getItem(chatRunStorageKey()) ||
              "{}"
          );
          pending = sessionStorage.getItem(`${chatRunStorageKey()}:pending`);
        } catch {}
        if (explicit) {
          if (valid()) await loadHistoryRef.current(explicit);
          return;
        }
        const runs = await active(undefined, pending ?? undefined);
        if (!valid()) return;
        if (runs[0]) {
          if (!terminalRun(runs[0].status))
            await loadHistoryRef.current(runs[0].session_id, runs[0]);
          return;
        }
        if (remembered.run_id) {
          const last = await snapshot(remembered.run_id);
          if (!valid()) return;
          if (!terminalRun(last.status)) {
            await loadHistoryRef.current(last.session_id, last);
          } else {
            // Finished conversations stay in history, not in automatic entry recovery.
            try {
              sessionStorage.removeItem(chatRunStorageKey());
              localStorage.removeItem(chatRunStorageKey());
            } catch {}
          }
        }
      } catch {
        if (valid()) toast.error(restoreErrorRef.current);
      }
    })();
    return () => {
      cancelled = true;
      if (restoreEntry.current === entry) restoreEntry.current = "";
    };
    // Intentionally run once per ready actor/workspace, not whenever history or selection changes.
  }, [workspace.ready, user?.id, operationTenantId, active, snapshot]);

  // Shared input props for WelcomeView and ChatInputComposite
  const inputProps = {
    input,
    onInputChange: setInput,
    onSend: handleSend,
    onStop: handleStop,
    loading,
    isStreaming,
    attachments,
    pendingAttachments,
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
    onClearDatasets: handleClearDatasets,
    currentTenantId: operationTenantId,
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
      <div ref={chatContainerRef} className="w-full h-full min-h-0 relative">
        {loading &&
          (connection === "reconnecting" ||
            runStatus === "stopping" ||
            stopPending ||
            stopFailed) && (
            <div
              role="status"
              className="absolute top-2 inset-x-4 z-10 rounded-md border bg-background px-3 py-2 text-sm text-muted-foreground"
            >
              {runStatus === "stopping" || stopPending
                ? t("runStopping")
                : connection === "reconnecting"
                  ? t("runReconnecting")
                  : t("runStopFailed")}
              {stopFailed && (
                <button type="button" className="ml-2 underline" onClick={handleStop}>
                  {t("runStopRetry")}
                </button>
              )}
            </div>
          )}
        {showWelcomeView ? (
          <WelcomeView {...inputProps} />
        ) : (
          <div className="relative flex h-full min-h-0 w-full">
            <div className="flex min-h-0 min-w-0 flex-1 flex-col mx-auto px-1 sm:px-4 max-w-4xl">
              <MessageList
                messages={messages}
                streamingMessage={visibleStreamingMessage}
                isStreaming={isStreaming}
                knowledgeWriteCards={knowledgeWrites.map((selection) => (
                  <KnowledgeWriteCard key={selection.request_id} selection={selection} />
                ))}
                toolSteps={toolSteps}
                toolsRunning={isStreaming}
                segments={segments}
                segmentsLoading={segmentsLoading}
                onOpenReferences={openReferencesDialog}
                onPreviewFile={(file) => {
                  const filename = file.originalname || file.filename || "";
                  const url = file.id
                    ? getFileDownloadUrl(file.id, file.filename || filename)
                    : file.sourceUrl || file.path;
                  if (!url) return;
                  const absoluteUrl = new URL(url, window.location.origin).href;
                  const resource = attachmentPreviewResource({ filename, url: absoluteUrl });
                  if (resource) setPreviewResource(resource);
                  else downloadChatLink(workspaceUrl(absoluteUrl), filename);
                }}
                onPreviewAttachment={(attachment) => {
                  const resource = attachmentPreviewResource(attachment);
                  if (resource) setPreviewResource(resource);
                  else handlePreviewAttachment(attachment);
                }}
                onPreviewResource={setPreviewResource}
                sendFeedback={sendFeedback}
                messagesContainerRef={messagesContainerRef}
                messagesEndRef={messagesEndRef}
              />

              <div
                className="flex-shrink-0"
                style={{ paddingBottom: "max(0.5rem, env(safe-area-inset-bottom))" }}
              >
                <ChatInputComposite {...inputProps} placeholder={t("placeholderReply")} />
              </div>
            </div>
            {previewResource && (
              <ResourcePreviewPanel
                resource={previewResource}
                onClose={() => setPreviewResource(null)}
              />
            )}
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
