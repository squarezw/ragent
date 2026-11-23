"use client";

import { ArrowUp, Mic, MicOff, X } from "lucide-react";
import { useTranslations } from "next-intl";
import type { ReactNode } from "react";
import type { useVoiceConversation } from "@/hooks/useVoiceConversation";

export function VoiceConversationPanel({ voice, busy, input, setInput, send, confirmations }: {
  voice: ReturnType<typeof useVoiceConversation>;
  busy: boolean;
  input: string;
  setInput: (value: string) => void;
  send: () => void;
  confirmations: ReactNode;
}) {
  const t = useTranslations("chat");
  const label = !voice.ready ? "voiceConnecting" : voice.hearing ? "voiceHearing" :
    voice.speaking ? "voiceSpeaking" : voice.transcribing ? "voiceTranscribing" : busy || voice.preparing ? "voiceThinking" : voice.muted ? "voiceMuted" : "voiceListening";
  return <section className="mx-auto flex h-full min-h-0 w-full max-w-4xl flex-col px-3 sm:px-5"
    aria-label={t("voiceConversation")}>
    <div className="flex flex-1 min-h-0 flex-col items-center justify-end gap-3 overflow-y-auto pb-6 sm:justify-center">
      <button type="button" onClick={voice.interrupt} disabled={!busy && !voice.speaking}
        aria-label={t("voiceInterrupt")} title={t("voiceInterrupt")}
        className={`voice-orb relative size-24 shrink-0 overflow-hidden rounded-full sm:size-32 ${voice.speaking || voice.hearing ? "voice-orb-active" : ""}`} />
      <span role="status" className="text-xs font-medium text-muted-foreground">{t(label)}</span>
      {confirmations}
    </div>
    <div className="mx-auto flex w-full items-center gap-2"
      style={{ paddingBottom: "calc(clamp(24px, 5dvh, 48px) + env(safe-area-inset-bottom, 0px))" }}>
      <form className="flex min-w-0 flex-1 items-center rounded-full border bg-background px-4 shadow-sm"
        onSubmit={event => { event.preventDefault(); if (input.trim()) send(); }}>
        <input aria-label={t("placeholderReply")} placeholder={t("placeholderReply")} value={input}
          onChange={event => setInput(event.target.value)}
          className="h-12 min-w-0 flex-1 bg-transparent text-base outline-none" />
        {input.trim() && <button aria-label={t("sendMessage")} className="p-2" type="submit"><ArrowUp size={18}/></button>}
      </form>
      <button type="button" disabled={!voice.ready} aria-pressed={voice.muted}
        aria-label={t(voice.muted ? "voiceUnmute" : "voiceMute")} onClick={voice.toggleMute}
        className="flex size-12 shrink-0 items-center justify-center rounded-full bg-muted text-foreground">
        {voice.muted ? <MicOff size={20}/> : <Mic size={20}/>}
      </button>
      <button type="button" onClick={voice.exit} aria-label={t("voiceExit")}
        className="flex size-12 shrink-0 items-center justify-center rounded-full bg-foreground text-background"><X size={21}/></button>
    </div>
    <style jsx>{`
      .voice-orb { background: radial-gradient(ellipse at 24% 25%, #e4faff 3%, transparent 50%), radial-gradient(ellipse at 85% 75%, #4caaff 2%, transparent 55%), linear-gradient(135deg,#b5edff 18%,#b9dcfa 45%,#368abf 65%,#0077c8 90%); box-shadow: inset 0 0 20px #ffffff88; }
      .voice-orb-active { animation: voice-breathe 1.5s ease-in-out infinite alternate; }
      @keyframes voice-breathe { from { transform: scale(.94); } to { transform: scale(1.06); } }
      @media (prefers-reduced-motion: reduce) { .voice-orb-active { animation: none; } }
    `}</style>
  </section>;
}
