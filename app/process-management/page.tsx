"use client";

import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import DocumentConversionTab from "./components/DocumentConversionTab";
import DocumentEditorTab from "./components/DocumentEditorTab";
import type { EditingContext } from "./components/DocumentEditorTab";
import ProcessManagementTab from "./components/ProcessManagementTab";
import { startHandbookAnalyze } from "./services/api";

type View = "process-management" | "document-conversion" | "document-editor";

function viewFromHash(): View {
  if (typeof window === "undefined") return "process-management";
  const h = window.location.hash.slice(1);
  if (h === "document-conversion" || h === "document-editor") return h;
  return "process-management";
}

function editingContextFromURL(): EditingContext | null {
  if (typeof window === "undefined") return null;
  const params = new URLSearchParams(window.location.search);
  const docId = params.get("docId");
  const sessionId = params.get("sessionId");
  if (docId || sessionId) {
    return { docId: docId || undefined, sessionId: sessionId || undefined };
  }
  return null;
}

function buildUrl(view: View, ctx?: EditingContext | null): string {
  const base = window.location.pathname;
  const hash = view === "process-management" ? "" : `#${view}`;
  const params = new URLSearchParams();
  if (view === "document-editor" && ctx) {
    if (ctx.docId) params.set("docId", ctx.docId);
    if (ctx.sessionId) params.set("sessionId", ctx.sessionId);
  }
  if (view === "document-conversion" && ctx?.sessionId) {
    params.set("sessionId", ctx.sessionId);
  }
  const search = params.toString();
  return `${base}${search ? `?${search}` : ""}${hash}`;
}

export default function ProcessManagementPage() {
  const t = useTranslations("processManagement");
  const { user, loading: userLoading } = useCurrentUser();
  // undefined = still loading (skip fetch), null = no company, string = resolved
  const companyCode = userLoading ? undefined : (user?.company_code ?? null);
  const [activeView, setActiveView] = useState<View>(viewFromHash);

  const SESSION_ID_KEY = "ragent-handbook-session";

  // Shared handbook session state — prefer URL param, fallback to sessionStorage
  const [handbookSessionId, setHandbookSessionId] = useState<string | null>(() => {
    if (typeof window === "undefined") return null;
    const urlSid = new URLSearchParams(window.location.search).get("sessionId");
    if (urlSid) return urlSid;
    return sessionStorage.getItem(SESSION_ID_KEY);
  });
  const [sessionRefreshKey, setSessionRefreshKey] = useState(0);
  const [editingContext, setEditingContext] = useState<EditingContext | null>(() => editingContextFromURL());

  // Browser history integration — ctx is persisted in URL search params for document-editor
  const navigateTo = useCallback((view: View, ctx?: EditingContext | null) => {
    window.history.pushState({ view }, "", buildUrl(view, ctx));
    setActiveView(view);
  }, []);

  /** Replace current history entry (browser back skips it) */
  const redirectTo = useCallback((view: View, ctx?: EditingContext | null) => {
    window.history.replaceState({ view }, "", buildUrl(view, ctx));
    setActiveView(view);
  }, []);

  const goBack = useCallback(() => {
    window.history.back();
  }, []);

  useEffect(() => {
    const onPopState = () => {
      setActiveView(viewFromHash());
      setEditingContext(editingContextFromURL());
      const urlSid = new URLSearchParams(window.location.search).get("sessionId");
      if (urlSid && viewFromHash() === "document-conversion") {
        setHandbookSessionId(urlSid);
      }
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  /** Called from ProcessMigrationDialog when user clicks "智能合并" */
  const handleMergeFiles = useCallback(
    async ({
      fileIds,
      fileKeys,
      fileNames,
      nodeId,
      companyCode,
      sourceNodeId,
      l1OwnerName,
    }: {
      fileIds: string[];
      fileKeys: string[];
      nodeId: string | null;
      companyCode: string;
      fileNames?: string[];
      sourceNodeId?: string;
      l1OwnerName?: string;
    }) => {
      if (!nodeId) {
        toast.error(t("conversion.selectNodeFirst"));
        return;
      }
      if (userLoading) {
        toast.error(t("conversion.userLoading"));
        return;
      }
      const authoringDept = user?.dept_name?.trim();
      if (!authoringDept) {
        toast.error(t("conversion.missingUserDept"));
        return;
      }
      try {
        const result = await startHandbookAnalyze({
          node_id: nodeId,
          source_file_ids: fileIds,
          source_file_keys: fileKeys,
          source_file_names: fileNames,
          company_code: companyCode,
          source_node_id: sourceNodeId,
          authoring_dept: authoringDept,
          l1_owner_name: l1OwnerName,
        });
        setHandbookSessionId(result.session_id);
        sessionStorage.setItem(SESSION_ID_KEY, result.session_id);
        setSessionRefreshKey((k) => k + 1);
        toast.success(t("conversion.analyzeSubmitted"));
      } catch (e: unknown) {
        const errData = (
          e as { response?: { data?: { error?: string | { message?: string }; detail?: string } } }
        )?.response?.data;
        const msg =
          (typeof errData?.error === "string" ? errData.error : errData?.error?.message) ||
          (typeof errData?.detail === "string" ? errData.detail : null) ||
          (e instanceof Error ? e.message : null) ||
          t("conversion.analyzeFailed");
        toast.error(msg);
      }
    },
    [user?.dept_name, userLoading, t]
  );

  const handleAnalyzeComplete = useCallback((status: string) => {
    if (status === "completed" || status === "failed") {
      sessionStorage.removeItem(SESSION_ID_KEY);
    }
    // Refresh doc list whenever generation/analysis finishes
    if (status === "completed" || status === "generated") {
      setSessionRefreshKey((k) => k + 1);
    }
  }, []);

  return (
    <div className="flex h-full flex-col overflow-hidden -m-2 sm:-m-6">
      <div className="flex-1 min-h-0 relative">
        <div
          className="absolute inset-0 flex flex-col overflow-hidden"
          style={{
            display: activeView === "process-management" ? "flex" : "none",
          }}
        >
          <ProcessManagementTab
            companyCode={companyCode}
            onSwitchView={(v) => navigateTo(v as View)}
            onMergeFiles={handleMergeFiles}
            sessionRefreshKey={sessionRefreshKey}
            onEditDocument={(ctx) => {
              setEditingContext(ctx);
              navigateTo("document-editor", ctx);
            }}
            onOpenConversion={(sid) => {
              setHandbookSessionId(sid);
              sessionStorage.setItem(SESSION_ID_KEY, sid);
              navigateTo("document-conversion", { sessionId: sid });
            }}
          />
        </div>
        <div
          className="absolute inset-0 flex flex-col overflow-hidden"
          style={{
            display: activeView === "document-conversion" ? "flex" : "none",
          }}
        >
          <DocumentConversionTab
            onBack={() => {
              setSessionRefreshKey((k) => k + 1);
              goBack();
            }}
            onGoToEditor={(docId) => {
              const ctx: EditingContext = docId
                ? { docId }
                : handbookSessionId
                  ? { sessionId: handbookSessionId }
                  : {};
              setEditingContext(ctx);
              // replaceState: browser back skips document-conversion
              redirectTo("document-editor", ctx);
            }}
            sessionId={handbookSessionId}
            onStatusChange={handleAnalyzeComplete}
            isActive={activeView === "document-conversion"}
          />
        </div>
        <div
          className="absolute inset-0 flex flex-col overflow-hidden"
          style={{
            display: activeView === "document-editor" ? "flex" : "none",
          }}
        >
          <DocumentEditorTab
            onBack={() => {
              setEditingContext(null);
              setSessionRefreshKey((k) => k + 1);
              goBack();
            }}
            onAfterSubmitReview={() => {
              setEditingContext(null);
              setSessionRefreshKey((k) => k + 1);
              redirectTo("process-management");
            }}
            editingContext={editingContext}
            hideSubmitReview={!editingContext?.docId}
          />
        </div>
      </div>
    </div>
  );
}
