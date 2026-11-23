import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import { mount, run } from "./helpers/chatRunPageHarness.ts";

const voice = { exports: {} as typeof import("../lib/voiceDialogue") };
runInNewContext(ts.transpileModule(readFileSync(new URL("../lib/voiceDialogue.ts", import.meta.url), "utf8"), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS }
}).outputText, { exports: voice.exports, module: voice, Blob, DataView, ArrayBuffer });

test("speech uses only complete phrases; decimal numbers and split image or URL markup survive streaming", () => {
  const long = "较长回复可能只有逗号，".repeat(60);
  const cut = voice.exports.nextSpeechPhrase(long, 0, false)!;
  assert.ok(cut.end > 0 && cut.end <= 320);
  assert.equal(voice.exports.nextSpeechPhrase("直径12.", 0, false), null);
  const answer = "直径12.5毫米。![图](https://example.com/a.png)结论一致！";
  const first = voice.exports.nextSpeechPhrase(answer, 0, false)!;
  assert.equal(first.text, "直径12.5毫米。");
  assert.equal(voice.exports.nextSpeechPhrase("!", 0, false), null);
  assert.equal(voice.exports.nextSpeechPhrase("![图。", 0, false), null);
  const second = voice.exports.nextSpeechPhrase(answer, first.end, true)!;
  assert.equal(second.text, "结论一致！");
  assert.equal(second.end, answer.length);
  assert.equal(voice.exports.spokenText('<img src="secret">说明[产物](https://example.com/file)'), "说明产物");
});

test("speech activity preserves the attack, tolerates a short pause and gates weak speaker echoes", async () => {
  const detector = new voice.exports.SpeechDetector(16000);
  const frame = (amplitude: number) => new Float32Array(800).fill(amplitude);
  for (let i = 0; i < 10; i++) assert.equal(detector.push(frame(.018), true), undefined);
  detector.reset();
  for (let i = 0; i < 4; i++) detector.push(frame(0), false);
  assert.equal(detector.push(frame(.09), false), undefined);
  assert.equal(detector.push(frame(.09), false), "start");
  for (let i = 0; i < 8; i++) assert.equal(detector.push(frame(0), false), undefined);
  detector.push(frame(.09), false);
  let result;
  for (let i = 0; i < 19 && !result; i++) result = detector.push(frame(0), false);
  assert.ok(Array.isArray(result));
  assert.equal(result[0][0], 0);
  assert.ok(result[4][0] > .08);
  const wav = await voice.exports.waveRecording(result, 16000).arrayBuffer();
  const header = new DataView(wav);
  assert.equal(header.getUint32(24, true), 16000);
  assert.equal(header.getUint32(40, true), wav.byteLength - 44);
});

test("barge-in stops exactly one run, waits for termination and forwards the played boundary", async () => {
  const page = mount();
  await page.settle();
  page.find("WelcomeView")!.props.onVoiceEnter();
  page.render();
  page.voiceText("第一句");
  await page.settle();
  assert.equal(page.calls.requests[0].params.interaction_mode, "voice");
  page.barge({ run_id: "r1", heard_chars: 2 });
  page.voiceText("下一句");
  assert.equal(page.calls.starts, 1);
  const updates = page.calls.voiceUpdates.length;
  page.emit(run({ answer: "晚到的语音" }));
  assert.equal(page.calls.voiceUpdates.length, updates);
  page.emit(run({ status: "cancelled" }));
  await page.settle();
  assert.equal(page.calls.stop, 1);
  assert.equal(page.calls.requests[1].params.previous_voice_turn.heard_chars, 2);
  assert.equal(page.calls.requests[1].question, "下一句");
});

test("reopening a voice turn retains its text-only mode and playback boundary", async () => {
  const page = mount({ search: "?session_id=11", details: [
    {id: 20, question: "请说明", answer: "先说结论。![图](x)", interaction_mode: "voice", voice_heard_chars: 5}
  ] });
  await page.settle();
  const answer = page.find("MessageList")!.props.messages[1];
  assert.equal(answer.voice, true);
  assert.equal(answer.heardChars, 5);
  assert.equal(page.calls.voiceUpdates.length, 0);
});
