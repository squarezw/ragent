import assert from "node:assert/strict";
import test from "node:test";
import { RunSseDecoder, parseRunSnapshot, reduceRun, terminalRun } from "../lib/chatRun.ts";
const snapshot = () =>
  parseRunSnapshot({
    run_id: "r1",
    session_id: "11",
    detail_id: 12,
    app_id: 1,
    status: "running",
    cursor: 0,
    answer: "",
    tool_steps: [],
    pending_confirmations: [],
    usage: null,
    result: null,
    error: null,
    updated_at: "2026-11-14T00:00:00Z",
  });
test("SSE decoder handles every byte split, CRLF, comments, multiline JSON and committed IDs", () => {
  const wire = ': ping\r\n\r\nid: 1\r\nevent: delta\r\ndata: {\r\ndata: "v":"hello 世界"}\r\n\r\n';
  for (let split = 0; split < wire.length; split++) {
    const decoder = new RunSseDecoder();
    const events = [...decoder.push(wire.slice(0, split)), ...decoder.push(wire.slice(split))];
    assert.deepEqual(events, [{ id: 1, event: "delta", data: { v: "hello 世界" } }]);
  }
  assert.deepEqual(new RunSseDecoder().push('id: 1\nevent: delta\ndata: {"v":"partial"}'), []);
});
test("duplicate token replay and terminal replay never duplicate answer", () => {
  let state = snapshot();
  const delta = { id: 1, event: "delta", data: { v: "hello" } };
  state = reduceRun(state, delta);
  assert.equal(reduceRun(state, delta), state);
  state = reduceRun(state, {
    id: 2,
    event: "finish",
    data: { detail_id: 12, usage: { total_tokens: 2 } },
  });
  state = reduceRun(state, { id: 3, event: "status", data: { status: "completed" } });
  assert.equal(state.answer, "hello");
  assert.equal(state.status, "completed");
  assert.equal(terminalRun(state.status), true);
});
test("tool invocation replay upserts by call ID, preserving parallel calls and timestamps", () => {
  let state = snapshot();
  state = reduceRun(state, {
    id: 1,
    event: "tool_status",
    data: { name: "tool", tool_call_id: "a", phase: "started", started_at: "2026-11-14T00:00:00Z" },
  });
  state = reduceRun(state, {
    id: 2,
    event: "tool_status",
    data: { name: "tool", tool_call_id: "b", phase: "started" },
  });
  state = reduceRun(state, {
    id: 3,
    event: "tool_status",
    data: { name: "tool", tool_call_id: "a", phase: "finished", ok: true },
  });
  assert.equal(state.tool_steps.length, 2);
  assert.equal(state.tool_steps[0].phase, "finished");
  assert.equal(state.tool_steps[0].started_at, "2026-11-14T00:00:00Z");
});
test("snapshot reset replaces projection, confirmations dedupe and foreign run is rejected", () => {
  let state = snapshot();
  state = reduceRun(state, {
    id: 1,
    event: "knowledge_write_confirmation",
    data: { request_id: "k" },
  });
  state = reduceRun(state, {
    id: 2,
    event: "knowledge_write_confirmation",
    data: { request_id: "k" },
  });
  assert.equal(state.pending_confirmations.length, 1);
  state = reduceRun(state, {
    id: 5,
    event: "snapshot",
    data: { ...snapshot(), cursor: 5, answer: "restored" },
  });
  assert.equal(state.answer, "restored");
  assert.equal(state.cursor, 5);
  assert.throws(() =>
    reduceRun(state, {
      id: 6,
      event: "snapshot",
      data: { ...snapshot(), run_id: "foreign", cursor: 6 },
    })
  );
});

test("authoritative snapshot can reset a future cursor backwards", () => {
  const old = { ...snapshot(), cursor: 99, answer: "stale" };
  const next = reduceRun(old, {
    id: 5,
    event: "snapshot",
    data: { ...snapshot(), cursor: 5, answer: "truth" },
  });
  assert.equal(next.cursor, 5);
  assert.equal(next.answer, "truth");
});
test("terminal status followed by finish retains final metadata", () => {
  let state = reduceRun(snapshot(), { id: 1, event: "status", data: { status: "completed" } });
  state = reduceRun(state, {
    id: 2,
    event: "finish",
    data: { references: [{ id: 3 }], usage: { total_tokens: 12 } },
  });
  assert.deepEqual(state.result?.references, [{ id: 3 }]);
  assert.equal(state.usage?.total_tokens, 12);
});

test("standard SSE supports CR-only frames and CRLF split between chunks", () => {
  const wire = 'id: 1\revent: delta\rdata: {"v":"ok"}\r\r';
  const decoder = new RunSseDecoder();
  assert.deepEqual(decoder.push(wire), [{ id: 1, event: "delta", data: { v: "ok" } }]);
  const split = new RunSseDecoder();
  assert.deepEqual(split.push("id: 1\r"), []);
  assert.deepEqual(split.push('\nevent: delta\r\ndata: {"v":"ok"}\r'), []);
  assert.deepEqual(split.push("\n\r"), [{ id: 1, event: "delta", data: { v: "ok" } }]);
  assert.deepEqual(split.push("\n"), []);
});
