import { useCallback, useEffect, useRef, useState } from "react";
import axios from "@/lib/axios";
import { SpeechDetector, waveRecording } from "@/lib/voiceDialogue";
import { transcribeRecording } from "@/lib/transcribeRecording";
import { VoicePlayback, type PlaybackBoundary } from "@/lib/voicePlayback";

export type VoiceError = "voiceRecordingFailed" | "voiceRecognitionFailed" | "voicePlaybackFailed" | "voiceNoLocalVoice" | "micPermissionDenied" | "micNotFound" | "voiceSecureMicrophone";
interface Options {
  awaitingReply: () => boolean;
  onText: (text: string) => void;
  onInterrupt: (boundary?: PlaybackBoundary) => void;
  onError: (key: VoiceError) => void;
}
interface Session {
  context: AudioContext;
  abort: AbortController;
  muted: boolean;
  stream?: MediaStream;
  node?: AudioWorkletNode;
  detector: SpeechDetector;
  playback?: VoicePlayback;
  transcription?: AbortController;
  recordings: Blob[];
  recognized: string[];
  hearing: boolean;
}

export function useVoiceConversation(options: Options) {
  const meterRef = useRef<HTMLButtonElement>(null);
  const callbacks = useRef(options);
  callbacks.current = options;
  const current = useRef<Session | null>(null);
  const [active, setActive] = useState(false);
  const [ready, setReady] = useState(false);
  const [muted, setMuted] = useState(false);
  const [preparing, setPreparing] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [hearing, setHearing] = useState(false);
  const [transcribing, setTranscribing] = useState(false);

  const interrupt = useCallback(() => {
    const session = current.current;
    if (session) callbacks.current.onInterrupt(session.playback?.stop());
  }, []);

  const exit = useCallback(() => {
    const session = current.current;
    if (!session) return;
    interrupt();
    current.current = null;
    session.abort.abort();
    session.transcription?.abort();
    session.stream?.getTracks().forEach(track => track.stop());
    session.node?.port.close();
    session.node?.disconnect();
    void session.context.close().catch(() => {});
    setActive(false);
    setReady(false);
    setHearing(false);
    setPreparing(false);
    setSpeaking(false);
    setTranscribing(false);
    setMuted(false);
  }, [interrupt]);

  useEffect(() => {
    const hide = () => { if (document.hidden) exit(); };
    document.addEventListener("visibilitychange", hide);
    window.addEventListener("pagehide", exit);
    return () => {
      document.removeEventListener("visibilitychange", hide);
      window.removeEventListener("pagehide", exit);
      exit();
    };
  }, [exit]);

  const enter = useCallback(async () => {
    if (current.current) return;
    let attempt: Session | undefined;
    try {
      if (!navigator.mediaDevices?.getUserMedia || !window.AudioContext) {
        callbacks.current.onError("voiceSecureMicrophone");
        return;
      }
      // Safari requires synthesis to be unlocked by the same user gesture as the call.
      const synth = window.speechSynthesis;
      const local = synth?.getVoices().find(voice => voice.localService);
      if (local) {
        const unlockSpeech = new SpeechSynthesisUtterance(" ");
        unlockSpeech.voice = local;
        unlockSpeech.volume = 0;
        synth.speak(unlockSpeech);
      }
      const context = new AudioContext();
      const session: Session = { context, abort: new AbortController(), muted: false, recordings: [], recognized: [], hearing: false, detector: new SpeechDetector(context.sampleRate) };
      attempt = session;
      current.current = session;
      setActive(true);
      if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
      // Resume within the initiating touch event so subsequent audio playback works on mobile.
      const unlock = context.resume();
      const capture = navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } })
        .then(stream => {
          if (current.current !== session) { stream.getTracks().forEach(track => track.stop()); return; }
          session.stream = stream;
        });
      const [,,settings] = await Promise.all([unlock, capture, axios.get("/api/tts/settings", { signal: session.abort.signal }),
        context.audioWorklet.addModule("/voice-capture.js")]);
      if (session.abort.signal.aborted || !session.stream) return;
      const mode = settings.data?.tts_model_mode;
      if (mode !== "local" && mode !== "remote") throw new Error("Invalid speech synthesis settings");
      session.playback = new VoicePlayback(context, mode, document.documentElement.lang || "zh-CN",
        setSpeaking, key => callbacks.current.onError(key), setPreparing);
      const input = context.createMediaStreamSource(session.stream);
      const node = new AudioWorkletNode(context, "voice-capture");
      session.node = node;
      input.connect(node);
      // The capture worklet writes silence to its output; connecting it keeps the node scheduled.
      node.connect(context.destination);
      async function transcribeQueue() {
        if (session.transcription) return;
        const request = new AbortController();
        session.transcription = request;
        setTranscribing(true);
        try {
          while (session.recordings.length && !request.signal.aborted) {
            const text = await transcribeRecording(session.recordings.shift()!, request.signal);
            if (!request.signal.aborted && text.trim()) session.recognized.push(text.trim());
          }
          // A long statement can span multiple captured clips; deliver them in spoken order.
          if (!request.signal.aborted && !session.hearing && session.recognized.length) {
            const text = session.recognized.join(" ");
            session.recognized = [];
            callbacks.current.onText(text);
          }
        } catch {
          if (!request.signal.aborted) callbacks.current.onError("voiceRecognitionFailed");
        } finally {
          if (current.current === session && session.transcription === request) {
            session.transcription = undefined;
            setTranscribing(false);
            if (session.recordings.length) void transcribeQueue();
          }
        }
      }
      node.port.onmessage = ({ data }: MessageEvent<Float32Array>) => {
        if (session.muted || session.abort.signal.aborted) return;
        const capture = session.detector.push(data, callbacks.current.awaitingReply() || !!session.playback?.pendingAudio);
        meterRef.current?.style.setProperty("--level", session.detector.meterLevel.toFixed(2));
        if (capture === "start") {
          session.hearing = true;
          setHearing(true);
          interrupt();
        } else if (capture) {
          session.hearing = false;
          setHearing(false);
          session.recordings.push(waveRecording(capture, context.sampleRate));
          void transcribeQueue();
        }
      };
      session.stream.getAudioTracks()[0]?.addEventListener("ended", exit, { once: true });
      setReady(true);
    } catch (error) {
      // A cancelled permission prompt may settle after the user has opened a different session.
      if (attempt && current.current !== attempt) return;
      if (attempt) exit();
      callbacks.current.onError(error instanceof DOMException && error.name === "NotAllowedError" ? "micPermissionDenied" :
        error instanceof DOMException && error.name === "NotFoundError" ? "micNotFound" : "voiceRecordingFailed");
    }
  }, [exit, interrupt]);

  const toggleMute = useCallback(() => {
    const session = current.current;
    if (!session) return;
    session.muted = !session.muted;
    session.stream?.getAudioTracks().forEach(track => { track.enabled = !session.muted; });
    meterRef.current?.style.removeProperty("--level");
    session.detector.reset();
    session.hearing = false;
    if (session.muted) {
      session.transcription?.abort();
      session.recordings = [];
      session.recognized = [];
    }
    setMuted(session.muted);
    setHearing(false);
    setTranscribing(false);
  }, []);

  const update = useCallback((id: string, answer: string, done: boolean) => {
    current.current?.playback?.update(id, answer, done);
  }, []);
  return { meterRef, active, ready, muted, hearing, speaking, preparing, transcribing, enter, exit, interrupt, toggleMute, update };
}
