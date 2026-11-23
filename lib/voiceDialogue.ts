/** Plain text for speech and for rendering voice responses without external media. */
export function spokenText(raw: string): string {
  return raw
    .replace(/```[\s\S]*?(?:```|$)/g, "")
    .replace(/!\[[^\]]*(?:\]\((?:[^()]|\([^()]*\))*(?:\)|$)|\]\[[^\]]*(?:\]|$)|\]|$)/g, "")
    .replace(/<[^>]*(?:>|$)/g, "")
    .replace(/\[([^\]]*)\]\([^)]*(?:\)|$)/g, "$1")
    .replace(/(?:https?:\/\/|data:image\/)[^\s，。！？；）]+/gi, "")
    .replace(/^[ \t]*[>#|]+[ \t]*/gm, "")
    .replace(/[*`|]/g, "")
    .trim();
}

export function nextSpeechPhrase(answer: string, from: number, final: boolean) {
  const rest = answer.slice(from);
  if (!rest) return null;
  // Hold an unfinished Markdown construct or URL until its closing delimiter arrives.
  // A model can emit long paragraphs without punctuation. Split at a visible word or
  // character boundary while keeping raw offsets for interrupted-playback history.
  if (rest.length > 340) {
    const start = rest.slice(0, 340);
    if (!/[。！？?；;\n]/.test(start)) {
      for (let end = 320; end >= 140; end--) {
        const prefix = rest.slice(0, end);
        if (/[\uD800-\uDBFF]$/.test(prefix) || /[a-z0-9.]$/i.test(prefix) && /^[a-z0-9.]/i.test(rest.slice(end))) continue;
        if (/[!\[][^\]]*$|\]\([^)]*$|<[^>]*$|(?:https?:\/\/|data:image\/)[^\s]*$/i.test(prefix)) continue;
        if ((prefix.match(/```/g)?.length ?? 0) % 2) continue;
        return { text: spokenText(prefix), end: from + end };
      }
    }
  }
  const boundaries = /(?:[。！？?；;\n]|!(?!\[)|\.(?=\s|$))/g;
  for (const match of rest.matchAll(boundaries)) {
    const length = match.index! + match[0].length;
    const prefix = rest.slice(0, length);
    if (/!?(?:\[[^\]]*$|\[[^\]]*\]\([^)]*$)|<[^>]*$|(?:https?:\/\/|data:image\/)[^\s。！？；]*$/i.test(prefix)) continue;
    if ((prefix.match(/```/g)?.length ?? 0) % 2) continue;
    if ((match[0] === "." || match[0] === "!") && !final && length === rest.length) continue;
    return { text: spokenText(prefix), end: from + length };
  }
  return final ? { text: spokenText(rest), end: answer.length } : null;
}

export class SpeechDetector {
  private lead: Float32Array[] = [];
  private recording: Float32Array[] = [];
  private attack = 0;
  private silent = 0;
  private duration = 0;
  private floor = 0.003;
  constructor(private rate: number) {}

  reset() {
    this.recording = [];
    this.lead = [];
    this.attack = this.silent = this.duration = 0;
  }

  push(frame: Float32Array, playing: boolean): "start" | Float32Array[] | undefined {
    let energy = 0;
    for (const amplitude of frame) energy += amplitude * amplitude;
    const level = Math.sqrt(energy / frame.length);
    const seconds = frame.length / this.rate;
    const threshold = Math.max(playing ? 0.027 : 0.011, this.floor * (playing ? 3.5 : 2.6));
    const voiced = level > threshold;
    if (this.recording.length) {
      this.recording.push(frame);
      this.duration += seconds;
      this.silent = voiced ? 0 : this.silent + seconds;
      if (this.silent >= 0.85 || this.duration >= 55) {
        const frames = this.recording;
        this.reset();
        return frames;
      }
      return;
    }
    if (!voiced) this.floor = Math.min(.035, .96 * this.floor + .04 * level);
    this.lead.push(frame);
    while (this.lead.length > Math.ceil(.32 / seconds)) this.lead.shift();
    this.attack = voiced ? this.attack + seconds : 0;
    if (this.attack >= (playing ? .12 : .075)) {
      this.recording = this.lead;
      this.lead = [];
      return "start";
    }
  }
}

/** Resample a single-channel capture to the 16 kHz PCM format both STT providers accept. */
export function waveRecording(frames: Float32Array[], rate: number) {
  const count = frames.reduce((sum, frame) => sum + frame.length, 0);
  const length = Math.floor(count * 16000 / rate);
  const buffer = new ArrayBuffer(44 + 2 * length);
  const view = new DataView(buffer);
  for (const [offset, text] of [[0, "RIFF"], [8, "WAVEfmt "], [36, "data"]] as const)
    for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i));
  view.setUint32(4, 36 + length * 2, true);
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, 16000, true);
  view.setUint32(28, 32000, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  view.setUint32(40, length * 2, true);
  let frame = 0, index = 0, consumed = 0;
  for (let i = 0; i < length; i++) {
    const until = Math.min(count, Math.round((i + 1) * rate / 16000));
    const samples = until - consumed;
    let sum = 0;
    while (consumed < until) {
      sum += frames[frame][index++];
      consumed++;
      if (index === frames[frame].length) { frame++; index = 0; }
    }
    view.setInt16(44 + i * 2, Math.max(-1, Math.min(1, sum / Math.max(1, samples))) * 32767, true);
  }
  return new Blob([buffer], { type: "audio/wav" });
}
