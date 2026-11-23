import { useCallback, useEffect, useRef, useState } from "react";

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
  const [level, setLevel] = useState(0);
  const meter = useRef<AudioContext | null>(null);
  const meterTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const permission = useRef(0);
  const starting = useRef(false);
  const cancelledRef = useRef(false);
  const streamRef = useRef<MediaStream | null>(null);

  const cleanup = useCallback(() => {
    starting.current = false;
    if (meterTimer.current) clearInterval(meterTimer.current);
    meterTimer.current = null;
    if (meter.current) void meter.current.close().catch(() => {});
    meter.current = null;
    setLevel(0);
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
    if (status !== "idle" || starting.current) return;

    const mimeType = getSupportedMimeType();
    if (!mimeType) {
      onError?.(new Error("MediaRecorder not supported"));
      return;
    }

    const ticket = ++permission.current;
    starting.current = true;
    cancelledRef.current = false;

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (ticket !== permission.current) { stream.getTracks().forEach(track => track.stop()); return; }
      streamRef.current = stream;
      if (window.AudioContext) {
        const context = new AudioContext();
        meter.current = context;
        const analyser = context.createAnalyser();
        context.createMediaStreamSource(stream).connect(analyser);
        const samples = new Float32Array(analyser.fftSize);
        void context.resume().catch(() => {});
        meterTimer.current = setInterval(() => {
          analyser.getFloatTimeDomainData(samples);
          const rms = Math.sqrt(samples.reduce((sum, v) => sum + v * v, 0) / samples.length);
          setLevel(Math.min(1, rms * 10));
        }, 90);
      }

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
      if (ticket !== permission.current) return;
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
    permission.current++;
    cancelledRef.current = true;
    if (mediaRecorderRef.current?.state === "recording") {
      mediaRecorderRef.current.stop();
    } else {
      cleanup();
      setStatus("idle");
    }
  }, [cleanup]);

  useEffect(() => () => { permission.current++; cancelledRef.current = true; cleanup(); }, [cleanup]);

  return {
    level,
    status,
    secondsElapsed,
    isRecording: status === "recording",
    startRecording,
    stopRecording,
    cancelRecording,
  };
}
