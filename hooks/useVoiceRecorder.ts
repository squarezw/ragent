import { useCallback, useRef, useState } from "react";

type VoiceRecorderStatus = "idle" | "recording" | "stopping";

interface UseVoiceRecorderOptions {
  maxSeconds?: number;
  onRecordingComplete: (blob: Blob) => void;
  onError?: (error: Error) => void;
}

function getSupportedMimeType(): string {
  if (typeof MediaRecorder === "undefined") return "";
  const types = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"];
  for (const type of types) {
    if (MediaRecorder.isTypeSupported(type)) return type;
  }
  return "";
}

export function useVoiceRecorder({
  maxSeconds = 15,
  onRecordingComplete,
  onError,
}: UseVoiceRecorderOptions) {
  const [status, setStatus] = useState<VoiceRecorderStatus>("idle");
  const [secondsElapsed, setSecondsElapsed] = useState(0);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const autoStopRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cancelledRef = useRef(false);
  const streamRef = useRef<MediaStream | null>(null);

  const cleanup = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    if (autoStopRef.current) {
      clearTimeout(autoStopRef.current);
      autoStopRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
    mediaRecorderRef.current = null;
    chunksRef.current = [];
    setSecondsElapsed(0);
  }, []);

  const startRecording = useCallback(async () => {
    if (status !== "idle") return;

    const mimeType = getSupportedMimeType();
    if (!mimeType) {
      onError?.(new Error("MediaRecorder not supported"));
      return;
    }

    cancelledRef.current = false;

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

      const recorder = new MediaRecorder(stream, { mimeType });
      mediaRecorderRef.current = recorder;
      chunksRef.current = [];

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) {
          chunksRef.current.push(e.data);
        }
      };

      recorder.onstop = () => {
        if (cancelledRef.current) {
          cleanup();
          setStatus("idle");
          return;
        }

        const chunks = chunksRef.current;
        if (chunks.length > 0) {
          const blob = new Blob(chunks, { type: mimeType });
          onRecordingComplete(blob);
        }
        cleanup();
        setStatus("idle");
      };

      recorder.onerror = () => {
        onError?.(new Error("Recording failed"));
        cleanup();
        setStatus("idle");
      };

      recorder.start();
      setStatus("recording");
      setSecondsElapsed(0);

      // Countdown timer
      timerRef.current = setInterval(() => {
        setSecondsElapsed((prev) => prev + 1);
      }, 1000);

      // Auto-stop at max duration
      autoStopRef.current = setTimeout(() => {
        if (mediaRecorderRef.current?.state === "recording") {
          setStatus("stopping");
          mediaRecorderRef.current.stop();
        }
      }, maxSeconds * 1000);
    } catch (err: any) {
      cleanup();
      setStatus("idle");

      if (err.name === "NotAllowedError") {
        onError?.(new Error("NotAllowedError"));
      } else if (err.name === "NotFoundError") {
        onError?.(new Error("NotFoundError"));
      } else {
        onError?.(new Error("Recording failed"));
      }
    }
  }, [status, maxSeconds, onRecordingComplete, onError, cleanup]);

  const stopRecording = useCallback(() => {
    if (mediaRecorderRef.current?.state === "recording") {
      setStatus("stopping");
      mediaRecorderRef.current.stop();
    }
  }, []);

  const cancelRecording = useCallback(() => {
    cancelledRef.current = true;
    if (mediaRecorderRef.current?.state === "recording") {
      mediaRecorderRef.current.stop();
    } else {
      cleanup();
      setStatus("idle");
    }
  }, [cleanup]);

  return {
    status,
    secondsElapsed,
    isRecording: status === "recording",
    startRecording,
    stopRecording,
    cancelRecording,
  };
}
