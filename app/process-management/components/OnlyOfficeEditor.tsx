"use client";

import { useState, useEffect, useCallback } from "react";
import { DocumentEditor } from "@onlyoffice/document-editor-react";
import { Loader2, AlertCircle } from "lucide-react";
import axios from "@/lib/axios";

interface OnlyOfficeEditorProps {
  /** "doc" for process document, "session" for handbook session */
  type: "doc" | "session";
  /** Document ID or session ID */
  id: string;
  onDocumentReady?: () => void;
  onError?: (errorCode: number, errorDescription: string) => void;
  onSaveStateChange?: (isSaving: boolean) => void;
  /** Called with the document key once config is loaded, so parent can trigger force-save */
  onDocKeyReady?: (key: string) => void;
}

interface OnlyOfficeConfig {
  document: {
    fileType: string;
    key: string;
    title: string;
    url: string;
  };
  documentType: string;
  editorConfig: {
    callbackUrl: string;
    lang: string;
    mode: string;
    user: { id: string; name: string };
    customization: Record<string, unknown>;
  };
  token: string;
}

export default function OnlyOfficeEditor({
  type,
  id,
  onDocumentReady,
  onError,
  onSaveStateChange,
  onDocKeyReady,
}: OnlyOfficeEditorProps) {
  const [config, setConfig] = useState<OnlyOfficeConfig | null>(null);
  const [documentServerUrl, setDocumentServerUrl] = useState("");
  const [loading, setLoading] = useState(true);
  const [editorReady, setEditorReady] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    const loadConfig = async () => {
      setLoading(true);
      setError(null);
      try {
        const resp = await axios.get(`/api/internal/onlyoffice/config/${id}`, { params: { type } });
        if (cancelled) return;
        setConfig(resp.data);
        setDocumentServerUrl(resp.data.onlyofficeUrl);
        onDocKeyReady?.(resp.data.document?.key);
      } catch (err: any) {
        if (cancelled) return;
        console.error("Failed to load OnlyOffice config:", err);
        setError(err?.response?.data?.detail || "Failed to load editor config");
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    loadConfig();
    return () => {
      cancelled = true;
    };
  }, [id, type]);

  const handleDocumentReady = useCallback(() => {
    setEditorReady(true);
    onDocumentReady?.();
  }, [onDocumentReady]);

  const handleDocumentStateChange = useCallback(
    (event: object) => {
      const e = event as { data: boolean };
      onSaveStateChange?.(e.data);
    },
    [onSaveStateChange],
  );

  const handleError = useCallback(
    (event: object) => {
      const e = event as { data: { errorCode: number; errorDescription: string } };
      console.error("OnlyOffice error:", e.data);
      onError?.(e.data.errorCode, e.data.errorDescription);
    },
    [onError],
  );

  if (loading) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center text-muted-foreground">
        <Loader2 className="h-8 w-8 animate-spin mb-4" />
        <p className="text-sm">正在加载编辑器...</p>
      </div>
    );
  }

  if (error || !config) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center text-muted-foreground">
        <AlertCircle className="h-10 w-10 mb-4 text-destructive/60" />
        <p className="text-sm text-destructive">{error || "配置加载失败"}</p>
      </div>
    );
  }

  return (
    <div className="flex-1 min-h-0 relative">
      {!editorReady && (
        <div className="absolute inset-0 z-10 flex flex-col items-center justify-center bg-background">
          <Loader2 className="h-8 w-8 animate-spin mb-4 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">正在加载编辑器...</p>
        </div>
      )}
      <DocumentEditor
        id="onlyoffice-editor"
        documentServerUrl={documentServerUrl}
        config={config}
        events_onDocumentReady={handleDocumentReady}
        events_onDocumentStateChange={handleDocumentStateChange}
        events_onError={handleError}
      />
    </div>
  );
}
