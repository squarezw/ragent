"use client";

import { useEffect, useRef, useState } from "react";
import { Square, Volume2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import axios from "@/lib/axios";
import { Button } from "@/components/ui/button";
import { spokenText } from "@/lib/voiceDialogue";
import { VoicePlayback } from "@/lib/voicePlayback";

let stopCurrent: (() => void) | undefined;

export default function ReadAnswerButton({ content }: { content: string }) {
  const t = useTranslations("chat");
  const [active, setActive] = useState(false);
  const cancel = useRef<(() => void) | undefined>(undefined);
  useEffect(() => () => cancel.current?.(), [content]);

  async function toggle() {
    if (cancel.current) {
      cancel.current();
      return;
    }
    stopCurrent?.();
    const controller = new AbortController();
    let context: AudioContext | undefined;
    let player: VoicePlayback | undefined;
    function stop() {
      if (controller.signal.aborted) return;
      controller.abort();
      player?.stop();
      if (context) void context.close().catch(() => {});
      if (stopCurrent === stop) stopCurrent = undefined;
      cancel.current = undefined;
      setActive(false);
    }
    stopCurrent = cancel.current = stop;
    setActive(true);
    try {
      context = new AudioContext();
      const [, settings] = await Promise.all([context.resume(), axios.get("/api/tts/settings", { signal: controller.signal })]);
      if (controller.signal.aborted) return;
      const mode = settings.data?.tts_model_mode;
      if (mode !== "local" && mode !== "remote") throw new Error();
      player = new VoicePlayback(context, mode, document.documentElement.lang || "zh-CN",
        () => {}, key => toast.error(t(key)), undefined, stop);
      player.update("read-answer", content, true);
    } catch {
      if (!controller.signal.aborted) toast.error(t("voicePlaybackFailed"));
      stop();
    }
  }

  if (!spokenText(content)) return null;
  const label = t(active ? "stopReadingAnswer" : "readAnswer");
  return <Button type="button" size="icon" variant="ghost" title={label}
    aria-label={label} aria-pressed={active} onClick={toggle}>
    {active ? <Square className="w-5 h-5 text-muted-foreground" /> : <Volume2 className="w-5 h-5 text-muted-foreground" />}
  </Button>;
}
