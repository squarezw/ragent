import { useCallback, useRef, useState } from "react";
import axios from "@/lib/axios";

type SttStatus = "idle" | "uploading" | "processing" | "completed" | "failed";

interface UseSpeechToTextOptions {
  onResult?: (text: string) => void;
  onError?: (error: Error) => void;
  maxPollingAttempts?: number;
  pollingIntervalMs?: number;
}

export function useSpeechToText({
  onResult,
  onError,
  maxPollingAttempts = 30,
  pollingIntervalMs = 1000,
}: UseSpeechToTextOptions = {}) {
  const [status, setStatus] = useState<SttStatus>("idle");
  const pollingRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortedRef = useRef(false);

  const cleanup = useCallback(() => {
    if (pollingRef.current) {
      clearTimeout(pollingRef.current);
      pollingRef.current = null;
    }
  }, []);

  const pollTask = useCallback(
    async (taskId: string, attempt: number) => {
      if (abortedRef.current) {
        cleanup();
        setStatus("idle");
        return;
      }

      if (attempt >= maxPollingAttempts) {
        cleanup();
        setStatus("failed");
        onError?.(new Error("Polling timeout"));
        return;
      }

      try {
        const response = await axios.get(`/api/stt/tasks/${taskId}`);
        const data = response.data;

        if (data.status === "completed" || data.status === "SUCCESS") {
          cleanup();
          setStatus("completed");
          const text = data.result?.text || data.text || "";
          onResult?.(text);
          // Reset to idle after a short delay
          setTimeout(() => setStatus("idle"), 300);
          return;
        }

        if (data.status === "failed" || data.status === "FAILURE") {
          cleanup();
          setStatus("failed");
          onError?.(new Error(data.error || "STT failed"));
          setTimeout(() => setStatus("idle"), 2000);
          return;
        }

        // Still processing, poll again
        pollingRef.current = setTimeout(() => {
          pollTask(taskId, attempt + 1);
        }, pollingIntervalMs);
      } catch (err: any) {
        cleanup();
        setStatus("failed");
        onError?.(new Error(err.response?.data?.error || err.message || "Polling failed"));
        setTimeout(() => setStatus("idle"), 2000);
      }
    },
    [maxPollingAttempts, pollingIntervalMs, onResult, onError, cleanup]
  );

  const transcribe = useCallback(
    async (blob: Blob) => {
      abortedRef.current = false;
      setStatus("uploading");

      try {
        const formData = new FormData();
        const ext = blob.type.includes("mp4") ? "mp4" : "webm";
        formData.append("file", blob, `recording.${ext}`);

        const response = await axios.post("/api/stt/single-speaker", formData, {
          headers: {
            "Content-Type": "multipart/form-data",
          },
        });

        const data = response.data;
        const taskId = data.task_id;

        if (!taskId) {
          // If the response has the result directly (no async task)
          if (data.text || data.result?.text) {
            setStatus("completed");
            const text = data.text || data.result?.text || "";
            onResult?.(text);
            setTimeout(() => setStatus("idle"), 300);
            return;
          }
          throw new Error("No task_id returned");
        }

        setStatus("processing");
        pollTask(taskId, 0);
      } catch (err: any) {
        setStatus("failed");
        onError?.(new Error(err.response?.data?.error || err.message || "Upload failed"));
        setTimeout(() => setStatus("idle"), 2000);
      }
    },
    [pollTask, onResult, onError]
  );

  const cancel = useCallback(() => {
    abortedRef.current = true;
    cleanup();
    setStatus("idle");
  }, [cleanup]);

  return {
    status,
    isProcessing: status === "uploading" || status === "processing",
    transcribe,
    cancel,
  };
}
