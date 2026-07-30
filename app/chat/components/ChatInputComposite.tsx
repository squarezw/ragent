"use client";

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
  Loader2,
  Upload,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import DatasetSelectorDropdown from "./DatasetSelectorDropdown";
import type { Attachment } from "../hooks/useFileAttachments";

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
  organizedDatasets: any;
  orgLoading: boolean;
  // Voice input
  voiceStatus?: "idle" | "recording" | "stopping";
  voiceSecondsElapsed?: number;
  voiceMaxSeconds?: number;
  sttStatus?: "idle" | "uploading" | "processing" | "completed" | "failed";
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
  organizedDatasets,
  orgLoading,
  voiceStatus = "idle",
  voiceSecondsElapsed = 0,
  voiceMaxSeconds = 15,
  sttStatus = "idle",
  onMicClick,
  onVoiceStop,
  onVoiceCancel,
}: ChatInputCompositeProps) {
  const t = useTranslations("chat");
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
          onSend();
        }
      }
    },
    [onSend]
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
    textareaRef.current?.focus();
  }, []);

  const canSend = input.trim() || attachments.length > 0;

  return (
    <div
      className={`w-full rounded-2xl border bg-card shadow-sm overflow-hidden relative transition-colors ${
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
      {attachments.length > 0 && (
        <div className="px-4 pt-3 pb-2 border-b border-border">
          <div className="flex flex-wrap gap-2">
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

      {/* Textarea */}
      <div className="px-4 py-3">
        <Textarea
          ref={textareaRef}
          value={input}
          onChange={(e) => onInputChange(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder || t("inputPlaceholder")}
          disabled={loading || isStreaming}
          className="min-h-[44px] max-h-[120px] resize-none overflow-y-auto border-0 shadow-none focus-visible:ring-0 p-0 text-base"
          style={{ height: "44px" }}
        />
      </div>

      {/* Action bar */}
      <div className="px-3 pb-3 flex items-center gap-1">
        {/* Left side: attachment + history */}
        <input
          ref={fileInputRef}
          type="file"
          accept=".pdf,.doc,.docx,.xlsx,.xls,.txt,.ai"
          multiple
          onChange={onFileSelect}
          className="hidden"
        />

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
            organizedDatasets={organizedDatasets}
            orgLoading={orgLoading}
            disabled={loading || isStreaming}
          />
        )}

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
        ) : voiceStatus === "recording" ? (
          <div className="flex items-center gap-1.5">
            <TooltipProvider delayDuration={100}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    onClick={onVoiceCancel}
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 rounded-full"
                  >
                    <X className="w-4 h-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>
                  <p>{t("voiceRecordingCancel")}</p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
            <span className="text-xs text-destructive font-medium tabular-nums min-w-[28px] text-center">
              {voiceMaxSeconds - voiceSecondsElapsed}s
            </span>
            <Button
              onClick={onVoiceStop}
              variant="destructive"
              size="icon"
              className="h-8 w-8 rounded-full animate-pulse"
            >
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
              >
                <rect width="14" height="14" x="5" y="5" rx="2"></rect>
              </svg>
            </Button>
          </div>
        ) : sttStatus === "uploading" || sttStatus === "processing" ? (
          <Button disabled variant="default" size="icon" className="h-8 w-8 rounded-full">
            <Loader2 className="w-4 h-4 animate-spin" />
          </Button>
        ) : input.trim() ? (
          <Button
            onClick={onSend}
            disabled={loading}
            variant="default"
            size="icon"
            className="h-8 w-8 rounded-full"
          >
            <ArrowUp className="w-4 h-4" />
          </Button>
        ) : onMicClick ? (
          <TooltipProvider delayDuration={100}>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  onClick={onMicClick}
                  disabled={loading}
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 rounded-full"
                >
                  <Mic className="w-4 h-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                <p>{t("voiceInput")}</p>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        ) : (
          <Button
            onClick={onSend}
            disabled={loading || !canSend}
            variant="default"
            size="icon"
            className="h-8 w-8 rounded-full"
          >
            <ArrowUp className="w-4 h-4" />
          </Button>
        )}
      </div>
    </div>
  );
}
