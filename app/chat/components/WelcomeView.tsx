"use client";

import React from "react";
import { Bot } from "lucide-react";
import { useTranslations } from "next-intl";
import { useTimeGreeting } from "@/hooks/useTimeGreeting";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import ChatInputComposite from "./ChatInputComposite";
import AppShortcuts from "./AppShortcuts";

interface Attachment {
  filename: string;
  type: string;
  content: string;
  url?: string;
}

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

interface WelcomeViewProps {
  // Input state
  input: string;
  onInputChange: (value: string) => void;
  onSend: () => void;
  onStop: () => void;
  loading: boolean;
  isStreaming: boolean;

  // File handling
  attachments: Attachment[];
  uploading: boolean;
  onFileSelect: (event: React.ChangeEvent<HTMLInputElement>) => void;
  onFileDrop: (files: File[]) => void;
  onRemoveAttachment: (index: number) => void;
  fileInputRef: React.RefObject<HTMLInputElement | null>;

  // History
  onHistoryOpen: () => void;

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

export default function WelcomeView({
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
  voiceStatus,
  voiceSecondsElapsed,
  voiceMaxSeconds,
  sttStatus,
  onMicClick,
  onVoiceStop,
  onVoiceCancel,
}: WelcomeViewProps) {
  const t = useTranslations("chat");
  const greeting = useTimeGreeting();
  const { user } = useCurrentUser();

  const username = user?.username || user?.name || "";

  return (
    <div className="flex flex-col items-center justify-center h-full w-full px-4">
      <div className="flex flex-col items-center max-w-3xl w-full">
        {/* AI Icon */}
        <div className="mb-6">
          <div className="w-16 h-16 rounded-full bg-gradient-to-br from-primary/20 to-primary/5 flex items-center justify-center">
            <Bot className="w-8 h-8 text-primary" />
          </div>
        </div>

        {/* Greeting */}
        <h1 className="text-2xl font-semibold text-foreground mb-8">
          {greeting}
          {username && <span className="text-primary">, {username}</span>}
        </h1>

        {/* Input Composite */}
        <div className="w-full">
          <ChatInputComposite
            input={input}
            onInputChange={onInputChange}
            onSend={onSend}
            onStop={onStop}
            loading={loading}
            isStreaming={isStreaming}
            attachments={attachments}
            uploading={uploading}
            onFileSelect={onFileSelect}
            onFileDrop={onFileDrop}
            onRemoveAttachment={onRemoveAttachment}
            fileInputRef={fileInputRef}
            onHistoryOpen={onHistoryOpen}
            placeholder={t("placeholderInitial")}
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
            voiceStatus={voiceStatus}
            voiceSecondsElapsed={voiceSecondsElapsed}
            voiceMaxSeconds={voiceMaxSeconds}
            sttStatus={sttStatus}
            onMicClick={onMicClick}
            onVoiceStop={onVoiceStop}
            onVoiceCancel={onVoiceCancel}
          />
        </div>

        {/* AI Disclaimer */}
        <p className="text-xs text-muted-foreground mt-4 text-center">{t("aiDisclaimer")}</p>

        {/* App Shortcuts */}
        <div className="w-full mt-6">
          <AppShortcuts
            apps={apps}
            appsLoading={appsLoading}
            selectedAppId={selectedAppId}
            onAppSelect={onAppSelect}
          />
        </div>
      </div>
    </div>
  );
}
