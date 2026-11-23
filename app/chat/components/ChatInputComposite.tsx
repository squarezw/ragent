"use client";

import styles from "./ChatComposer.module.css";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import {
  Plus,
  History,
  ArrowUp,
  X,
  FileText,
  FileType,
  FileSpreadsheet,
  Mic,
  AudioLines,
  Loader2,
  Upload,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import DatasetSelectorDropdown from "./DatasetSelectorDropdown";
import type { Attachment, PendingAttachment } from "../hooks/useFileAttachments";
import { ATTACHMENT_ACCEPT } from "@/lib/chatAttachments";
import { pasteChatAttachments } from "../clipboardAttachments";

interface App {
  id: number;
  name: string;
  description: string;
  dataset_ids: string[];
  is_default?: boolean;
}

interface Dataset {
  id: string;
  name: string;
}

interface ChatInputCompositeProps {
  input: string;
  onInputChange: (value: string) => void;
  onSend: () => void;
  onStop: () => void;
  loading: boolean;
  isStreaming: boolean;
  attachments: Attachment[];
  pendingAttachments: PendingAttachment[];
  uploading: boolean;
  onFileSelect: (event: React.ChangeEvent<HTMLInputElement>) => void;
  onFileDrop: (files: File[]) => void;
  onRemoveAttachment: (index: number) => void;
  fileInputRef: React.RefObject<HTMLInputElement | null>;
  onHistoryOpen: () => void;
  placeholder?: string;
  // Dataset selection
  apps: App[];
  appsLoading: boolean;
  selectedAppId: string;
  appDatasets: Dataset[];
  optionalDatasetSelections: Set<string>;
  selectedDatasetIds: string[];
  onAppSelect: (appId: string) => void;
  onDatasetToggle: (datasetId: string) => void;
  onClearDatasets?: () => void;
  currentTenantId?: number | string | null;
  organizedDatasets: any;
  orgLoading: boolean;
  // Voice input
  voiceStatus?: "idle" | "recording" | "stopping";
  voiceLevel?: number;
  voiceSecondsElapsed?: number;
  voiceMaxSeconds?: number;
  sttStatus?: "idle" | "uploading" | "processing" | "completed" | "failed";
  onVoiceEnter?: () => void;
  onMicClick?: () => void;
  onVoiceStop?: () => void;
  onVoiceCancel?: () => void;
}

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

export default function ChatInputComposite({
  input,
  onInputChange,
  onSend,
  onStop,
  loading,
  isStreaming,
  attachments,
  pendingAttachments,
  uploading,
  onFileSelect,
  onFileDrop,
  onRemoveAttachment,
  fileInputRef,
  onHistoryOpen,
  placeholder,
  apps,
  appsLoading,
  selectedAppId,
  appDatasets,
  optionalDatasetSelections,
  selectedDatasetIds,
  onAppSelect,
  onDatasetToggle,
  onClearDatasets,
  currentTenantId,
  organizedDatasets,
  orgLoading,
  voiceStatus = "idle",
  voiceLevel = 0,
  voiceSecondsElapsed = 0,
  voiceMaxSeconds = 15,
  sttStatus = "idle",
  onVoiceEnter,
  onMicClick,
  onVoiceStop,
  onVoiceCancel,
}: ChatInputCompositeProps) {
  const t = useTranslations("chat");
  const [mobileTools, setMobileTools] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [isDragOver, setIsDragOver] = useState(false);
  const dragCounterRef = useRef(0);

  const handleDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounterRef.current += 1;
    if (e.dataTransfer.types.includes("Files")) {
      setIsDragOver(true);
    }
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounterRef.current -= 1;
    if (dragCounterRef.current === 0) {
      setIsDragOver(false);
    }
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      dragCounterRef.current = 0;
      setIsDragOver(false);

      const files = Array.from(e.dataTransfer.files);
      if (files.length > 0) {
        onFileDrop(files);
      }
    },
    [onFileDrop]
  );

  const canSend = Boolean(input.trim());

  // Handle keyboard events
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === "Enter") {
        if (e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) {
          // Ctrl/Cmd/Alt/Shift + Enter: newline
          return;
        } else {
          // Enter: send message
          e.preventDefault();
          if (canSend && !loading && !isStreaming && !uploading) onSend();
        }
      }
    },
    [canSend, loading, isStreaming, onSend, uploading]
  );

  // Auto-resize textarea
  const adjustTextareaHeight = useCallback(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
      const scrollHeight = textareaRef.current.scrollHeight;
      const maxHeight = 120;
      const minHeight = 44;
      const newHeight = Math.min(Math.max(scrollHeight, minHeight), maxHeight);
      textareaRef.current.style.height = `${newHeight}px`;
    }
  }, []);

  useEffect(() => {
    adjustTextareaHeight();
  }, [input, adjustTextareaHeight]);

  useEffect(() => {
    if (!window.matchMedia?.("(pointer: coarse)").matches) textareaRef.current?.focus();
  }, []);

  return (
    <div
      className={`${styles.composer} border bg-card shadow-sm overflow-hidden relative transition-colors ${
        isDragOver ? "border-primary border-dashed bg-primary/5" : "border-border"
      }`}
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
    >
      {/* Drag overlay */}
      {isDragOver && (
        <div className="absolute inset-0 z-10 flex items-center justify-center bg-primary/5 rounded-2xl pointer-events-none">
          <div className="flex flex-col items-center gap-2 text-primary">
            <Upload className="w-8 h-8" />
            <span className="text-sm font-medium">{t("dropFilesHere")}</span>
          </div>
        </div>
      )}
      {/* File previews */}
      {(attachments.length > 0 || pendingAttachments.length > 0) && (
        <div className={`${styles.previews} px-4 pt-3 pb-2 border-b border-border`}>
          <div className="flex flex-wrap gap-2">
            {pendingAttachments.map((attachment) => (
              <div
                key={`upload-${attachment.id}`}
                className="flex items-center gap-2 bg-muted rounded-lg px-3 py-1.5 text-sm"
                role="status"
                aria-label={`${attachment.filename}: ${t("uploadAttachment")}`}
              >
                {getFileIcon(attachment.type)}
                <span className="max-w-[150px] truncate">{attachment.filename}</span>
                <Loader2
                  className="w-3.5 h-3.5 animate-spin text-muted-foreground"
                  aria-hidden="true"
                />
              </div>
            ))}
            {attachments.map((attachment, index) => (
              <div
                key={index}
                className="flex items-center gap-2 bg-muted rounded-lg px-3 py-1.5 text-sm"
              >
                {getFileIcon(attachment.type)}
                <span className="max-w-[150px] truncate">{attachment.filename}</span>
                <button
                  type="button"
                  onClick={() => onRemoveAttachment(index)}
                  className="text-muted-foreground hover:text-foreground p-0.5 rounded hover:bg-muted-foreground/10"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      <button type="button" aria-label={t("voiceChatTools")} aria-expanded={mobileTools}
        className={styles.mobileToolsButton}
        onClick={() => setMobileTools(open => !open)}><Plus className="size-5" /></button>
      {/* Textarea */}
      <div className={styles.draft}>
        <Textarea
          ref={textareaRef}
          value={input}
          data-workspace-dirty={input.trim() || attachments.length > 0 || pendingAttachments.length > 0 ? "true" : undefined}
          onChange={(e) => onInputChange(e.target.value)}
          onKeyDown={handleKeyDown}
          onPaste={(event) => pasteChatAttachments(event, onFileDrop, onInputChange)}
          placeholder={placeholder || t("inputPlaceholder")}
          disabled={loading || isStreaming}
          className="min-h-[44px] max-h-[120px] resize-none overflow-y-auto border-0 shadow-none focus-visible:ring-0 px-0 py-2.5 sm:p-0 text-base"
          style={{ height: "44px" }}
        />
      </div>

      {/* Action bar */}
      <div className={styles.toolbar}>
        {/* Left side: attachment + history */}
        <input
          ref={fileInputRef}
          type="file"
          accept={ATTACHMENT_ACCEPT}
          multiple
          onChange={onFileSelect}
          className="hidden"
        />

        <div className={styles.tools} data-open={mobileTools}>
        <TooltipProvider delayDuration={100}>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => fileInputRef.current?.click()}
                disabled={loading || isStreaming || uploading}
                className="h-8 w-8 rounded-lg"
              >
                {uploading ? (
                  <div className="w-4 h-4 border-2 border-muted-foreground border-t-primary rounded-full animate-spin" />
                ) : (
                  <Plus className="w-4 h-4" />
                )}
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              <p>{t("uploadAttachment")}</p>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>

        <TooltipProvider delayDuration={100}>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                onClick={onHistoryOpen}
                disabled={loading || isStreaming}
                className="h-8 w-8 rounded-lg"
              >
                <History className="w-4 h-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              <p>{t("historyRecords")}</p>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>

        {/* Spacer */}
        <div className="flex-1" />

        {/* Right side: dataset selector + send button */}
        {voiceStatus !== "recording" && sttStatus !== "uploading" && sttStatus !== "processing" && (
          <DatasetSelectorDropdown
            apps={apps}
            appsLoading={appsLoading}
            selectedAppId={selectedAppId}
            appDatasets={appDatasets}
            optionalDatasetSelections={optionalDatasetSelections}
            selectedDatasetIds={selectedDatasetIds}
            onAppSelect={onAppSelect}
            onDatasetToggle={onDatasetToggle}
            onClearDatasets={onClearDatasets}
            currentTenantId={currentTenantId}
            organizedDatasets={organizedDatasets}
            orgLoading={orgLoading}
            disabled={loading || isStreaming}
          />
        )}

        </div>
        {isStreaming ? (
          <Button onClick={onStop} variant="default" size="icon" className="h-8 w-8 rounded-full">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="currentColor"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-label={t("stop")}
            >
              <rect width="14" height="14" x="5" y="5" rx="2"></rect>
            </svg>
          </Button>
        ) : (
          <div className={styles.primaryActions}>
            {voiceStatus === "recording" ? <>
              <button type="button" aria-label={t("voiceRecordingCancel")} onClick={onVoiceCancel}
                className="p-1 text-muted-foreground"><X size={16}/></button>
              <span className="text-xs tabular-nums">{voiceMaxSeconds - voiceSecondsElapsed}s</span>
              <Button type="button" size="icon" variant="ghost" aria-label={t("voiceFinishDictation")}
                className="size-9 rounded-full text-primary" onClick={onVoiceStop}>
                <AudioLines className="size-5 transition-transform motion-reduce:transform-none" style={{ transform: `scaleY(${0.6 + voiceLevel})` }}/>
              </Button>
            </> : <Button type="button" size="icon" variant="ghost" aria-label={t("voiceInput")}
              title={t("voiceInput")} disabled={!onMicClick || uploading || loading || sttStatus === "processing" || sttStatus === "uploading"}
              className="size-9 rounded-full" onClick={onMicClick}>
              {sttStatus === "processing" || sttStatus === "uploading" ? <Loader2 className="size-4 animate-spin"/> : <Mic className="size-4"/>}
            </Button>}
            <button
              type="button"
              aria-label={t(canSend ? "sendMessage" : "voiceConversation")}
              title={t(canSend ? "sendMessage" : "voiceConversation")}
              disabled={loading || uploading || voiceStatus !== "idle" || sttStatus === "processing" || sttStatus === "uploading" || (!canSend && !onVoiceEnter)}
              className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-black text-white transition-opacity hover:opacity-85 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:opacity-50 dark:bg-white dark:text-black"
              onClick={canSend ? onSend : onVoiceEnter}
            >
              {canSend ? <ArrowUp size={22} aria-hidden="true" /> : <AudioLines size={22} strokeWidth={2.75} aria-hidden="true" />}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
