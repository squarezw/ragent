"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { ChevronRight, Edit3, Plus, ArrowRightLeft, FileText, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { getMimeTypeFromExtension } from "@/lib/mimeTypes";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import type { ProcessNode, RelatedDoc } from "../types/process";
import {
  fetchNodeDocuments,
  deleteDocument,
  deleteHandbookSession,
  updateDocumentStatus,
  fetchHandbookSessions,
  getHandbookAnalyzeStatusLight,
  getHandbookGenerateStatus,
  fetchDocument,
  persistSessionDocFile,
  startDocumentRevision,
  discardDocumentRevision,
} from "../services/api";
import { levelBadgeStyles, docStatusStyles, isActiveSessionStatus, sessionCardStyles } from "./processConstants";
import type { HandbookSession } from "../services/api";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import DocPreviewDialog from "./DocPreviewDialog";
import { FilePreviewDialog } from "@/components/FilePreviewDialog";
import SubmitReviewDialog from "./SubmitReviewDialog";
import type { EditingContext } from "./DocumentEditorTab";

interface ProcessDetailPanelProps {
  node: ProcessNode | null;
  tree: ProcessNode[];
  onSelect: (id: string) => void;
  getBreadcrumb: (id: string) => ProcessNode[];
  onEdit: (id: string) => void;
  onDelete: (id: string) => void;
  onMigrate: () => void;
  onAddDoc?: () => void;
  onSwitchTab?: (tab: string) => void;
  onEditDocument?: (ctx: EditingContext) => void;
  onOpenConversion?: (sessionId: string) => void;
  sessionRefreshKey?: number;
}

function formatElapsed(createdAt: string): string {
  const diff = Math.max(0, Date.now() - new Date(createdAt).getTime());
  const totalSec = Math.floor(diff / 1000);
  if (totalSec < 60) return `${totalSec}s`;
  const hours = Math.floor(totalSec / 3600);
  const mins = Math.floor((totalSec % 3600) / 60);
  const secs = totalSec % 60;
  const ss = secs.toString().padStart(2, "0");
  if (hours > 0) {
    const mm = mins.toString().padStart(2, "0");
    return `${hours}:${mm}:${ss}`;
  }
  return `${mins}:${ss}`;
}

export default function ProcessDetailPanel({
  node,
  tree,
  onSelect,
  getBreadcrumb,
  onEdit,
  onDelete,
  onMigrate,
  onAddDoc,
  onSwitchTab,
  onEditDocument,
  onOpenConversion,
  sessionRefreshKey,
}: ProcessDetailPanelProps) {
  const t = useTranslations("processManagement");
  const { user: currentUser } = useCurrentUser();
  const canDeleteDoc = useCallback(
    (doc: RelatedDoc) => {
      if (!currentUser) return false;
      if (currentUser.isSuperAdmin) return true;
      return !!doc.createdBy && doc.createdBy === String(currentUser.id);
    },
    [currentUser],
  );
  const [previewDoc, setPreviewDoc] = useState<RelatedDoc | null>(null);
  const [filePreviewFile, setFilePreviewFile] = useState<Record<string, any> | null>(null);
  const [reviewDoc, setReviewDoc] = useState<RelatedDoc | null>(null);
  const [deleteDoc, setDeleteDoc] = useState<RelatedDoc | null>(null);
  const [discardDoc, setDiscardDoc] = useState<RelatedDoc | null>(null);
  const [deleteSession, setDeleteSession] = useState<HandbookSession | null>(null);
  const [docs, setDocs] = useState<RelatedDoc[]>([]);
  const [docsLoading, setDocsLoading] = useState(false);
  const [activeSessions, setActiveSessions] = useState<HandbookSession[]>([]);

  const canManageDocs = node?.level === 1 || node?.level === 2 || node?.level === 3;
  const isL3 = node?.level === 3;
  const activeSessionsRef = useRef(activeSessions);
  activeSessionsRef.current = activeSessions;
  const persistedDocIds = useRef(new Set<string>());
  /** Cache sessionId → document_id so we only call getHandbookGenerateStatus once per session */
  const sessionDocIdCache = useRef(new Map<string, string>());

  /** Load documents for the current node.
   *  每个节点只展示直接挂在该节点下的文件（不再继承父链）。
   *  Plus in-flight session docs overlay (也限定在当前节点的 session)。
   */
  const loadAllDocs = useCallback(
    async (nodeId: string, sessions: HandbookSession[], isPolling = false) => {
      if (!isPolling) setDocsLoading(true);
      try {
        const result = await fetchNodeDocuments(nodeId);
        const nodeDocs = result.data;
        const seen = new Set<string>(nodeDocs.map((d) => d.id));

        // docfuse evicts the generate session shortly after completion, so
        // looking up status for a session whose doc is already persisted 404s.
        // Prime the cache from nodeDocs and skip those sessions entirely.
        const sessionIdsWithDoc = new Set<string>();
        for (const d of nodeDocs) {
          if (d.sessionId) {
            sessionDocIdCache.current.set(d.sessionId, d.id);
            sessionIdsWithDoc.add(d.sessionId);
          }
        }

        // Documents from generate-completed sessions — auto-create 会写到 session.nodeId（即触发生成的节点）
        const completedSessions = sessions.filter(
          (s) =>
            s.phase === "generate" &&
            s.status === "completed" &&
            !sessionIdsWithDoc.has(s.sessionId)
        );
        const sessionDocs: RelatedDoc[] = [];

        await Promise.all(
          completedSessions.map(async (s) => {
            try {
              // Check cache first to avoid unnecessary status API call
              let documentId = sessionDocIdCache.current.get(s.sessionId);
              if (!documentId) {
                const genStatus = await getHandbookGenerateStatus(s.sessionId);
                documentId = genStatus.document_id;
                if (documentId) {
                  sessionDocIdCache.current.set(s.sessionId, documentId);
                }
              }
              // Skip if already present from node docs
              if (documentId && !seen.has(documentId)) {
                const doc = await fetchDocument(documentId);
                seen.add(doc.id);
                sessionDocs.push({
                  id: doc.id,
                  name: doc.name,
                  aiSummary: doc.ai_summary || "",
                  nodeId: doc.node_id,
                  dept: doc.department || "",
                  status: doc.status,
                  owner: doc.created_by_name || doc.created_by || "",
                  createdAt: doc.created_at,
                  docNumber: doc.doc_number || "",
                  sessionId: s.sessionId,
                  createdBy: doc.created_by || undefined,
                });
                // Ensure DOCX is persisted locally for editing (only once)
                if (!persistedDocIds.current.has(doc.id)) {
                  persistedDocIds.current.add(doc.id);
                  persistSessionDocFile(doc.id, s.sessionId).catch(() => {});
                }
              }
            } catch {
              // Skip if document fetch fails
            }
          })
        );

        setDocs([...nodeDocs, ...sessionDocs]);
      } catch {
        if (!isPolling) setDocs([]);
      } finally {
        if (!isPolling) setDocsLoading(false);
      }
    },
    []
  );

  const loadSessions = useCallback(async (nodeId: string): Promise<HandbookSession[]> => {
    // 每个节点的 session 只归属于自己（在哪个节点触发的 analyze/generate 就存在哪个节点）
    try {
      const sessions = await fetchHandbookSessions(nodeId);
      setActiveSessions(sessions);
      return sessions;
    } catch {
      setActiveSessions([]);
      return [];
    }
  }, []);

  // Initial load when node changes
  useEffect(() => {
    if (node && canManageDocs) {
      const load = async () => {
        const sessions = await loadSessions(node.id);
        loadAllDocs(node.id, sessions);
      };
      load();
    } else {
      setDocs([]);
      setActiveSessions([]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [node?.id, canManageDocs, loadAllDocs, loadSessions]);

  // After migration or generation: reload sessions AND docs
  useEffect(() => {
    if (node && canManageDocs && (sessionRefreshKey ?? 0) > 0) {
      const reload = async () => {
        const sessions = await loadSessions(node.id);
        loadAllDocs(node.id, sessions);
      };
      reload();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionRefreshKey]);

  // Re-render every 1s so the "已耗时" display stays current
  const hasRunningSessions = activeSessions.some(
    (s) => isActiveSessionStatus(s.status)
  );
  const [, setElapsedTick] = useState(0);
  useEffect(() => {
    if (!hasRunningSessions) return;
    const timer = setInterval(() => setElapsedTick((t) => t + 1), 1000);
    return () => clearInterval(timer);
  }, [hasRunningSessions]);

  // Poll active sessions via lightweight status endpoint
  const hasQueuedOnly = !hasRunningSessions && activeSessions.some(
    (s) => s.status === "queued"
  );
  const pollInterval = hasRunningSessions ? 5000 : hasQueuedOnly ? 30000 : 0;
  useEffect(() => {
    if (!node || !canManageDocs || pollInterval === 0) return;
    const timer = setInterval(async () => {
      const current = activeSessionsRef.current;
      const polling = current.filter((s) => isActiveSessionStatus(s.status));
      if (polling.length === 0) return;
      const results = await Promise.all(
        polling.map((s) =>
          getHandbookAnalyzeStatusLight(s.sessionId).catch(() => ({ status: s.status, session_id: s.sessionId }))
        )
      );
      const changed = results.some((r, i) => r.status !== polling[i].status);
      if (changed) {
        const sessions = await loadSessions(node.id);
        loadAllDocs(node.id, sessions, true);
      }
    }, pollInterval);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [node?.id, canManageDocs, pollInterval, loadAllDocs, loadSessions]);

  const refreshDocs = useCallback(() => {
    if (node) loadAllDocs(node.id, activeSessions);
  }, [node, activeSessions, loadAllDocs]);

  const handleDeleteDoc = (doc: RelatedDoc) => {
    setDeleteDoc(doc);
  };

  const confirmDeleteDoc = async () => {
    if (!deleteDoc) return;
    try {
      await deleteDocument(deleteDoc.id);
      // Also delete the associated handbook session to stop stale polling
      if (deleteDoc.sessionId) {
        deleteHandbookSession(deleteDoc.sessionId).catch(() => {});
        sessionDocIdCache.current.delete(deleteDoc.sessionId);
        setActiveSessions((prev) =>
          prev.filter((s) => s.sessionId !== deleteDoc.sessionId)
        );
      }
      setDocs((prev) => prev.filter((d) => d.id !== deleteDoc.id));
      toast.success(t("toast.docDeleted", { name: deleteDoc.name, id: deleteDoc.id }));
    } catch {
      toast.error(t("toast.docDeleteFailed"));
    } finally {
      setDeleteDoc(null);
    }
  };

  const confirmDeleteSession = async () => {
    if (!deleteSession) return;
    try {
      await deleteHandbookSession(deleteSession.sessionId);
      setActiveSessions((prev) => prev.filter((s) => s.id !== deleteSession.id));
      toast.success(t("toast.sessionDeleted"));
    } catch {
      toast.error(t("toast.sessionDeleteFailed"));
    } finally {
      setDeleteSession(null);
    }
  };

  const handleSubmitReview = (doc: RelatedDoc) => {
    setReviewDoc(doc);
  };

  const handleOffline = async (doc: RelatedDoc) => {
    try {
      await updateDocumentStatus(doc.id, "offline");
      toast.success(`${doc.name} ${t("detail.offline")}`);
      refreshDocs();
    } catch {
      toast.error(t("toast.operationFailed"));
    }
  };

  const handleEditApproved = async (doc: RelatedDoc) => {
    try {
      await startDocumentRevision(doc.id);
    } catch {
      toast.error(t("toast.operationFailed"));
      return;
    }
    onEditDocument?.({ docId: doc.id });
  };

  const handleDiscardRevision = (doc: RelatedDoc) => {
    setDiscardDoc(doc);
  };

  const confirmDiscardRevision = async () => {
    if (!discardDoc) return;
    try {
      await discardDocumentRevision(discardDoc.id);
      toast.success(`${discardDoc.name} ${t("detail.discardDraft")}`);
      refreshDocs();
    } catch {
      toast.error(t("toast.operationFailed"));
    } finally {
      setDiscardDoc(null);
    }
  };

  if (!node) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center text-muted-foreground">
        <FileText className="h-12 w-12 mb-4 opacity-30" />
        <p className="text-sm font-medium">{t("tree.emptyTitle")}</p>
        <p className="text-xs mt-1">{t("tree.emptySubtitle")}</p>
      </div>
    );
  }

  const breadcrumb = getBreadcrumb(node.id);
  const l1Node = breadcrumb.find((n) => n.level === 1);
  const l2Node = breadcrumb.find((n) => n.level === 2);

  return (
    <div className="flex-1 overflow-y-auto p-6">
      {/* Breadcrumb */}
      <nav className="flex items-center gap-1 text-xs text-muted-foreground mb-4 flex-wrap">
        {breadcrumb.map((crumb, idx) => (
          <span key={crumb.id} className="flex items-center gap-1">
            {idx > 0 && <ChevronRight className="h-3 w-3" />}
            <button
              className={cn(
                "hover:text-foreground transition-colors",
                crumb.id === node.id && "text-foreground font-medium"
              )}
              onClick={() => {
                if (crumb.id !== node.id && crumb.level > 0) {
                  onSelect(crumb.id);
                }
              }}
            >
              {crumb.name}
            </button>
          </span>
        ))}
      </nav>

      {/* Header: Title + Action Buttons */}
      <div className="flex items-start justify-between gap-4 mb-4">
        <div className="flex-1 min-w-0">
          <div className="flex items-start gap-3 mb-2">
            {node.level >= 1 && node.level <= 3 && (
              <span
                className={cn(
                  "flex-shrink-0 text-xs font-semibold px-2 py-0.5 rounded border mt-0.5",
                  levelBadgeStyles[node.level]
                )}
              >
                L{node.level}
              </span>
            )}
            <h2 className="text-lg font-semibold text-foreground">{node.name}</h2>
          </div>
          {node.updated && (
            <p className="text-xs text-muted-foreground">
              {t("detail.updatedAt")}: {node.updated}
            </p>
          )}
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <Button variant="default" size="sm" onClick={() => onEdit(node.id)}>
            <Edit3 className="h-3.5 w-3.5 mr-1" />
            {t("detail.edit")}
          </Button>
        </div>
      </div>

      {/* Process Info Grid */}
      <div className="mb-6">
        <h3 className="text-sm font-semibold text-foreground mb-3 flex items-center gap-2">
          <FileText className="h-4 w-4 text-primary" />
          {t("detail.processInfo")}
        </h3>
        {node.desc && (
          <div className="rounded-lg border bg-muted/30 p-3 mb-3">
            <p className="text-xs text-muted-foreground mb-1">{t("detail.description")}</p>
            <p className="text-sm text-foreground">{node.desc}</p>
          </div>
        )}
        <div className="space-y-3">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {node.role && (
              <div className="rounded-lg border bg-muted/30 p-3">
                <p className="text-xs text-muted-foreground mb-1">{t("detail.role")}</p>
                <p className="text-sm text-foreground">{node.role}</p>
              </div>
            )}
            {node.org && (
              <div className="rounded-lg border bg-muted/30 p-3">
                <p className="text-xs text-muted-foreground mb-1">{t("detail.organization")}</p>
                <p className="text-sm text-foreground">{node.org}</p>
              </div>
            )}
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {l1Node?.owner && (
              <div className="rounded-lg border bg-muted/30 p-3">
                <p className="text-xs text-muted-foreground mb-1">{t("detail.l1Owner")}</p>
                <p className="text-sm text-foreground">{l1Node.owner}</p>
              </div>
            )}
            {l2Node?.owner && (
              <div className="rounded-lg border bg-muted/30 p-3">
                <p className="text-xs text-muted-foreground mb-1">{t("detail.l2Owner")}</p>
                <p className="text-sm text-foreground">{l2Node.owner}</p>
              </div>
            )}
            {node.level === 3 && node.owner && (
              <div className="rounded-lg border bg-muted/30 p-3">
                <p className="text-xs text-muted-foreground mb-1">{t("detail.l3Owner")}</p>
                <p className="text-sm text-foreground">{node.owner}</p>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Sub-processes */}
      {node.children && node.children.length > 0 && (
        <div className="mb-6">
          <h3 className="text-sm font-semibold text-foreground mb-3">
            {t("detail.subProcesses")} ({node.children.length})
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            {node.children.map((child) => (
              <button
                key={child.id}
                className="flex items-center gap-2 rounded-lg border bg-muted/20 p-3 text-left hover:bg-muted/40 transition-colors"
                onClick={() => onSelect(child.id)}
              >
                {child.level >= 1 && child.level <= 3 && (
                  <span
                    className={cn(
                      "flex-shrink-0 text-[10px] font-semibold px-1.5 py-0.5 rounded border",
                      levelBadgeStyles[child.level]
                    )}
                  >
                    L{child.level}
                  </span>
                )}
                <span className="text-sm text-foreground truncate">{child.name}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Related Documents Table (L2/L3 nodes) */}
      {canManageDocs && (
        <div>
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
              <FileText className="h-4 w-4 text-primary" />
              {t("detail.relatedDocsTitle")}
            </h3>
            <div className="flex items-center gap-1.5">
              <Button
                variant="outline"
                size="sm"
                className="h-7 text-xs px-2.5"
                onClick={onMigrate}
              >
                <ArrowRightLeft className="h-3 w-3 mr-1" />
                {t("detail.migrate")}
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="h-7 text-xs px-2.5"
                onClick={onAddDoc}
              >
                <Plus className="h-3 w-3 mr-1" />
                {t("detail.addDoc")}
              </Button>
            </div>
          </div>

          {/* Handbook sessions — card style for non-terminal states + analyze completed */}
          {activeSessions
            .filter((s) => {
              if (isActiveSessionStatus(s.status)) return true;
              if (s.status === "failed") return true;
              if (s.phase === "analyze" && s.status === "completed") return true;
              // generate completed → docs loaded via loadSessionDocs into docs table
              return false;
            })
            .map((session) => {
              const urls = session.requestBody?.source_file_urls || [];
              const fileNames = urls.map((u) => {
                try {
                  const path = decodeURIComponent(new URL(u).pathname);
                  const name = path.split("/").pop() || u;
                  return name.replace(/_[a-f0-9]{6}\./, ".");
                } catch {
                  return u;
                }
              });
              const isQueued = session.status === "queued";
              const isRunning = session.status === "pending" || session.status === "running";
              const isFailed = session.status === "failed";
              const isAnalyzeCompleted =
                session.phase === "analyze" && session.status === "completed";

              const borderColor = sessionCardStyles[session.status] || sessionCardStyles.completed;

              return (
                <div key={session.id} className={cn("rounded-lg border p-3 mb-3", borderColor)}>
                  <div className="flex items-center gap-3 mb-2">
                    {isQueued && (
                      <div className="h-4 w-4 rounded-full border-2 border-blue-400 flex items-center justify-center flex-shrink-0">
                        <div className="h-1.5 w-1.5 rounded-full bg-blue-400" />
                      </div>
                    )}
                    {isRunning && (
                      <div className="h-4 w-4 border-2 border-amber-400 border-t-transparent rounded-full animate-spin flex-shrink-0" />
                    )}
                    {isFailed && (
                      <div className="h-4 w-4 rounded-full bg-red-500 flex items-center justify-center flex-shrink-0">
                        <span className="text-white text-[10px] font-bold">!</span>
                      </div>
                    )}
                    {isAnalyzeCompleted && (
                      <div className="h-4 w-4 rounded-full bg-green-500 flex items-center justify-center flex-shrink-0">
                        <svg className="h-2.5 w-2.5 text-white" viewBox="0 0 12 12" fill="none">
                          <path
                            d="M2.5 6l2.5 2.5 4.5-5"
                            stroke="currentColor"
                            strokeWidth="1.5"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          />
                        </svg>
                      </div>
                    )}
                    <p className="text-sm font-medium flex-1">
                      {isQueued && t("detail.sessionQueued", { count: fileNames.length })}
                      {isRunning &&
                        (session.phase === "generate"
                          ? t("detail.sessionGenerating", { count: fileNames.length })
                          : t("detail.sessionAnalyzing", { count: fileNames.length }))}
                      {isFailed && (session.phase === "generate" ? t("detail.sessionGenerateFailed") : t("detail.sessionAnalyzeFailed"))}
                      {isAnalyzeCompleted && t("detail.sessionAnalyzeCompleted", { count: fileNames.length })}
                    </p>
                    {isAnalyzeCompleted && (
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-7 text-xs px-2.5 flex-shrink-0"
                        onClick={() => onOpenConversion?.(session.sessionId)}
                      >
                        {t("detail.resolveConflicts")}
                      </Button>
                    )}
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-7 text-xs px-2.5 flex-shrink-0"
                      onClick={() => setDeleteSession(session)}
                    >
                      {t("detail.deleteDoc")}
                    </Button>
                  </div>
                  {isFailed && session.errorMessage && (
                    <p className="pl-7 text-xs text-red-400 mb-2">{session.errorMessage}</p>
                  )}
                  <div className="pl-7 space-y-1">
                    {fileNames.map((name, i) => (
                      <div
                        key={i}
                        className="flex items-center gap-2 text-xs text-muted-foreground"
                      >
                        <FileText className="h-3 w-3 flex-shrink-0" />
                        <span className="truncate">{name}</span>
                      </div>
                    ))}
                  </div>
                  {isRunning && (
                    <p className="text-xs text-amber-500/70 text-right mt-2">
                      正在处理中 · 已耗时 {formatElapsed(session.createdAt)}
                    </p>
                  )}
                </div>
              );
            })}

          {(() => {
            if (docsLoading) {
              return (
                <div className="flex items-center justify-center py-8 text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                  <span className="text-sm">{t("detail.loadingDocs")}</span>
                </div>
              );
            }
            if (docs.length === 0 && activeSessions.length === 0) {
              return (
                <div className="text-center py-8 text-muted-foreground text-sm">
                  {t("detail.noDocs")}
                </div>
              );
            }
            if (docs.length === 0) return null;
            return (
              <div className="rounded-lg border overflow-hidden">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b bg-muted/30">
                      <th className="text-left px-3 py-2 text-xs font-medium text-muted-foreground">
                        {t("detail.docName")}
                      </th>
                      <th className="text-left px-3 py-2 text-xs font-medium text-muted-foreground w-[90px]">
                        {t("detail.status")}
                      </th>
                      <th className="text-left px-3 py-2 text-xs font-medium text-muted-foreground w-[70px]">
                        {t("detail.owner")}
                      </th>
                      <th className="text-left px-3 py-2 text-xs font-medium text-muted-foreground w-[90px]">
                        {t("detail.createdAt")}
                      </th>
                      <th className="text-right px-3 py-2 text-xs font-medium text-muted-foreground w-[220px]">
                        {t("detail.actions")}
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {docs.map((doc) => (
                      <tr
                        key={doc.id}
                        className="border-b last:border-b-0 hover:bg-muted/20 transition-colors"
                      >
                        <td className="px-3 py-2">
                          <button
                            className="text-primary hover:underline text-sm text-left"
                            onClick={() => {
                              const ext = doc.name.match(/\.[^.]+$/)?.[0]?.toLowerCase();
                              const mime = ext ? getMimeTypeFromExtension(ext) : null;
                              const hasFile = doc.filePath || doc.sessionId || (mime && mime !== "application/octet-stream");
                              if (hasFile) {
                                const effectiveExt = ext || ".docx";
                                setFilePreviewFile({
                                  filename: `${doc.id}${effectiveExt}`,
                                  originalname: ext ? doc.name : `${doc.name}.docx`,
                                  mimetype: getMimeTypeFromExtension(effectiveExt),
                                  sourceUrl: `${window.location.origin}/api/v1/process-management/process-documents/${doc.id}/file`,
                                });
                              } else {
                                setPreviewDoc(doc);
                              }
                            }}
                          >
                            {doc.name}
                          </button>
                        </td>
                        <td className="px-3 py-2">
                          <span
                            className={cn(
                              "inline-flex text-[11px] font-medium px-2 py-0.5 rounded-full border",
                              docStatusStyles[doc.status]
                            )}
                          >
                            {t(`status.${doc.status}`)}
                          </span>
                        </td>
                        <td className="px-3 py-2 text-sm text-muted-foreground">{doc.owner}</td>
                        <td className="px-3 py-2 text-xs text-muted-foreground">{doc.createdAt}</td>
                        <td className="px-3 py-2">
                          <div className="flex items-center justify-end gap-1">
                            {(() => {
                              const isDocx = doc.name.toLowerCase().endsWith(".docx");
                              const editEntry = {
                                key: "edit",
                                label: t("detail.editDoc"),
                                color: "text-primary",
                                show: isDocx,
                              };
                              const actionsByStatus: Record<string, Array<{
                                key: string;
                                label: string;
                                color: string;
                                onClick: () => void;
                                show?: boolean;
                              }>> = {
                                draft: [
                                  { ...editEntry, onClick: () => onEditDocument?.({ docId: doc.id }) },
                                  { key: "submit", label: t("detail.submitReview"), color: "text-green-500", onClick: () => handleSubmitReview(doc), show: !!doc.sessionId && !!doc.aiSummary },
                                  { key: "delete", label: t("detail.deleteDoc"), color: "text-destructive", onClick: () => handleDeleteDoc(doc), show: canDeleteDoc(doc) },
                                ],
                                revising: [
                                  { ...editEntry, onClick: () => onEditDocument?.({ docId: doc.id }) },
                                  { key: "submit", label: t("detail.submitReview"), color: "text-green-500", onClick: () => handleSubmitReview(doc), show: !!doc.sessionId && !!doc.aiSummary },
                                  { key: "discard", label: t("detail.discardDraft"), color: "text-destructive", onClick: () => handleDiscardRevision(doc) },
                                ],
                                approved: [
                                  { ...editEntry, onClick: () => handleEditApproved(doc) },
                                  { key: "offline", label: t("detail.offline"), color: "text-amber-500", onClick: () => handleOffline(doc) },
                                ],
                                offline: [
                                  { key: "delete", label: t("detail.deleteDoc"), color: "text-destructive", onClick: () => handleDeleteDoc(doc), show: canDeleteDoc(doc) },
                                ],
                              };
                              const actions = (actionsByStatus[doc.status] ?? []).filter(
                                (a) => a.show !== false,
                              );
                              return (
                                <>
                                  {doc.status === "offline" && (
                                    <span className="text-xs text-muted-foreground italic">
                                      {t("status.offline")}
                                    </span>
                                  )}
                                  {actions.map((a) => (
                                    <Button
                                      key={a.key}
                                      variant="link"
                                      size="sm"
                                      className={`h-auto px-1 py-0 text-xs ${a.color}`}
                                      onClick={a.onClick}
                                    >
                                      {a.label}
                                    </Button>
                                  ))}
                                </>
                              );
                            })()}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            );
          })()}
        </div>
      )}

      {/* Doc Preview Dialog */}
      <DocPreviewDialog
        open={!!previewDoc}
        onOpenChange={(open) => {
          if (!open) setPreviewDoc(null);
        }}
        doc={previewDoc}
      />

      <FilePreviewDialog
        open={!!filePreviewFile}
        onOpenChange={(open) => {
          if (!open) setFilePreviewFile(null);
        }}
        file={filePreviewFile}
      />

      {/* Submit Review Dialog */}
      <SubmitReviewDialog
        open={!!reviewDoc}
        onOpenChange={(open) => {
          if (!open) setReviewDoc(null);
        }}
        docId={reviewDoc?.id ?? null}
        docName={reviewDoc?.name ?? ""}
        initialDocNumber={reviewDoc?.docNumber ?? ""}
        onSuccess={refreshDocs}
      />

      {/* Delete Confirmation Dialog */}
      <AlertDialog
        open={!!deleteDoc}
        onOpenChange={(open) => {
          if (!open) setDeleteDoc(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("dialog.confirmDelete")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("dialog.deleteDocMsg")}
              {deleteDoc && (
                <span className="font-medium text-foreground"> &laquo;{deleteDoc.name}&raquo;</span>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("dialog.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={confirmDeleteDoc}
            >
              {t("dialog.confirmDeleteBtn")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Discard Revision Confirmation Dialog */}
      <AlertDialog
        open={!!discardDoc}
        onOpenChange={(open) => {
          if (!open) setDiscardDoc(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("dialog.confirmDiscard")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("dialog.discardMsg")}
              {discardDoc && (
                <span className="font-medium text-foreground"> &laquo;{discardDoc.name}&raquo;</span>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("dialog.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={confirmDiscardRevision}
            >
              {t("dialog.confirmDiscardBtn")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Delete Session Confirmation Dialog */}
      <AlertDialog
        open={!!deleteSession}
        onOpenChange={(open) => {
          if (!open) setDeleteSession(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("dialog.confirmDelete")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("dialog.deleteSessionMsg")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("dialog.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={confirmDeleteSession}
            >
              {t("dialog.confirmDeleteBtn")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
