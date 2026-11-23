import { useCallback, useEffect, useRef, useState } from "react";
import { transcribeRecording } from "@/lib/transcribeRecording";

type SttStatus = "idle" | "uploading" | "processing" | "completed" | "failed";

interface UseSpeechToTextOptions {
  onResult?: (text: string) => void;
  onError?: (error: Error) => void;
  maxPollingAttempts?: number;
  pollingIntervalMs?: number;
}

export function useSpeechToText(options: UseSpeechToTextOptions = {}) {
  const [status, setStatus] = useState<SttStatus>("idle");
  const controller = useRef<AbortController | null>(null);
  const current = useRef(options);
  current.current = options;
  const cancel = useCallback(() => {
    controller.current?.abort();
    setStatus("idle");
  }, []);
  useEffect(() => () => controller.current?.abort(), []);
  const transcribe = useCallback(async (blob: Blob) => {
    controller.current?.abort();
    const request = new AbortController();
    controller.current = request;
    setStatus("uploading");
    try {
      const { maxPollingAttempts, pollingIntervalMs } = current.current;
      const text = await transcribeRecording(blob, request.signal, maxPollingAttempts, pollingIntervalMs,
        () => !request.signal.aborted && setStatus("processing"));
      if (request.signal.aborted) return;
      setStatus("completed");
      current.current.onResult?.(text);
    } catch (error) {
      if (request.signal.aborted) return;
      setStatus("failed");
      current.current.onError?.(error instanceof Error ? error : new Error("Transcription failed"));
    }
  }, []);
  return { status, isProcessing: status === "uploading" || status === "processing", transcribe, cancel };
}
