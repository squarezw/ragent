// Send ~40 ms blocks rather than making the UI thread handle every render quantum.
class VoiceCapture extends AudioWorkletProcessor {
  constructor() {
    super();
    this.frames = new Float32Array(2048);
    this.offset = 0;
  }
  process(inputs) {
    const input = inputs[0]?.[0];
    if (!input) return true;
    for (let offset = 0; offset < input.length;) {
      const count = Math.min(input.length - offset, this.frames.length - this.offset);
      this.frames.set(input.subarray(offset, offset + count), this.offset);
      this.offset += count;
      offset += count;
      if (this.offset === this.frames.length) {
        this.port.postMessage(this.frames, [this.frames.buffer]);
        this.frames = new Float32Array(2048);
        this.offset = 0;
      }
    }
    return true;
  }
}
registerProcessor("voice-capture", VoiceCapture);
