import axios from "@/lib/axios";
import { nextSpeechPhrase } from "./voiceDialogue";

export interface PlaybackBoundary { run_id: string; heard_chars: number; }

export class VoicePlayback {
  private request: AbortController | null = null;
  private source: AudioBufferSourceNode | null = null;
  private answer = "";
  private run = "";
  private offset = 0;
  private final = false;
  private stopped = false;
  private playing = false;
  private phraseEnd = 0;
  private fractionPlayed = 0;
  private remoteStart = 0;
  private speakingLocal = false;

  constructor(private context: AudioContext, private mode: "local" | "remote",
    private language: string, private onPlaying: (value: boolean) => void,
    private onError: (message: "voiceNoLocalVoice" | "voicePlaybackFailed") => void,
    private onPreparing: (value: boolean) => void = () => {},
    private onFinished?: () => void) {}

  get pendingAudio() { return !this.stopped && this.offset < this.answer.length; }

  get isPlaying() { return this.playing; }

  update(run: string, answer: string, final: boolean) {
    if (run !== this.run) {
      this.stop();
      this.run = run;
      this.offset = 0;
      this.stopped = false;
    }
    if (this.stopped) return;
    this.answer = answer;
    this.final = final;
    if (!this.request) void this.drain();
  }

  stop(): PlaybackBoundary | undefined {
    const interrupted = this.run && !this.stopped && (!this.final || this.offset < this.answer.length);
    let boundary = this.offset;
    if (this.playing && this.phraseEnd > this.offset) {
      const duration = this.source?.buffer?.duration;
      const fraction = duration ? (this.context.currentTime - this.remoteStart) / duration : this.fractionPlayed;
      const phrase = Array.from(this.answer.slice(this.offset, this.phraseEnd));
      const count = Math.min(phrase.length, Math.max(1, Math.floor(phrase.length * fraction)));
      boundary += phrase.slice(0, count).join("").length;
    }
    this.onPreparing(false);
    this.stopped = true;
    this.request?.abort();
    this.request = null;
    if (this.source) { this.source.stop(); this.source = null; }
    if (this.speakingLocal) { window.speechSynthesis.cancel(); this.speakingLocal = false; }
    this.playing = false;
    this.onPlaying(false);
    if (interrupted) return { run_id: this.run, heard_chars: Array.from(this.answer.slice(0, boundary)).length };
  }

  private async drain() {
    const request = new AbortController();
    this.request = request;
    try {
      while (!request.signal.aborted) {
        const phrase = nextSpeechPhrase(this.answer, this.offset, this.final);
        if (!phrase) break;
        if (phrase.text) {
          this.phraseEnd = phrase.end;
          this.fractionPlayed = 0;
          this.onPreparing(true);
          if (this.mode === "local") await this.speakLocal(phrase.text, request.signal);
          else await this.speakRemote(phrase.text, request.signal);
        }
        if (!request.signal.aborted) {
          this.playing = false;
          this.onPlaying(false);
        }
        if (!request.signal.aborted) this.offset = phrase.end;
      }
    } catch (error) {
      if (!request.signal.aborted) {
        this.onError(error instanceof Error && error.message === "no-local-voice" ? "voiceNoLocalVoice" : "voicePlaybackFailed");
        this.stopped = true;
      }
    } finally {
      if (this.request === request) {
        this.onPreparing(false);
        this.request = null;
        this.playing = false;
        this.onPlaying(false);
        if (this.stopped || (this.final && this.offset >= this.answer.length)) this.onFinished?.();
      }
    }
  }

  private async speakLocal(text: string, signal: AbortSignal) {
    const synth = window.speechSynthesis;
    const lang = /[\u3400-\u9fff]/.test(text) ? "zh" : this.language.split("-")[0];
    const pick = () => synth?.getVoices().find(v => v.localService && v.lang.toLowerCase().startsWith(lang));
    let voice = pick();
    if (!voice && synth && !synth.getVoices().length) {
      await new Promise<void>(resolve => {
        const ready = () => { clearTimeout(timer); synth.removeEventListener("voiceschanged", ready); resolve(); };
        const timer = setTimeout(ready, 1000);
        synth.addEventListener("voiceschanged", ready, { once: true });
      });
      voice = pick();
    }
    signal.throwIfAborted();
    if (!voice) throw new Error("no-local-voice");
    const speech = new SpeechSynthesisUtterance(text);
    speech.voice = voice;
    speech.lang = voice.lang;
    await new Promise<void>((resolve, reject) => {
      let watchdog: ReturnType<typeof setTimeout>;
      const cleanup = () => { clearTimeout(watchdog); signal.removeEventListener("abort", done); };
      const done = () => { cleanup(); resolve(); };
      const failed = () => { cleanup(); reject(new Error("Local synthesis failed")); };
      // Some mobile engines silently ignore a speech request instead of firing an error.
      watchdog = setTimeout(() => { failed(); synth.cancel(); }, 6000);
      signal.addEventListener("abort", done, { once: true });
      speech.onstart = () => {
        clearTimeout(watchdog);
        if (!signal.aborted) { this.playing = true; this.onPlaying(true); }
      };
      speech.onboundary = event => {
        if (!signal.aborted) this.fractionPlayed = event.charIndex / text.length;
      };
      speech.onend = done;
      speech.onerror = failed;
      this.speakingLocal = true;
      synth.speak(speech);
    });
    if (!signal.aborted) this.speakingLocal = false;
  }

  private async speakRemote(text: string, signal: AbortSignal) {
    const { data } = await axios.post("/api/tts/synthesize", { text }, { signal, responseType: "arraybuffer" });
    const buffer = await this.context.decodeAudioData(data);
    signal.throwIfAborted();
    const source = this.context.createBufferSource();
    this.source = source;
    source.buffer = buffer;
    source.connect(this.context.destination);
    this.playing = true;
    this.onPlaying(true);
    await new Promise<void>(resolve => {
      source.onended = () => { source.disconnect(); resolve(); };
      this.remoteStart = this.context.currentTime;
      source.start();
    });
    if (this.source === source) this.source = null;
  }
}
