import assert from "node:assert/strict";
import { test } from "node:test";
import {
  extractSseErrorMessage,
  findToolCompletionIndex,
  isSseCommentLine,
  parseToolStatusPayload,
} from "../lib/chatSse.ts";

test("parseToolStatusPayload: started 帧（含 skill）", () => {
  const parsed = parseToolStatusPayload({
    name: "execute_skill",
    skill: "pdf-report",
    phase: "started",
  });
  assert.deepEqual(parsed, { name: "execute_skill", skill: "pdf-report", phase: "started" });
});

test("parseToolStatusPayload: started 帧（无 skill）", () => {
  const parsed = parseToolStatusPayload({ name: "web_search", phase: "started" });
  assert.deepEqual(parsed, { name: "web_search", phase: "started" });
  assert.equal(parsed?.skill, undefined);
});

test("parseToolStatusPayload: 带 display_name 的帧", () => {
  const parsed = parseToolStatusPayload({
    name: "execute_skill",
    skill: "fund-report",
    display_name: "基金季报/年报生成器",
    phase: "started",
  });
  assert.deepEqual(parsed, {
    name: "execute_skill",
    skill: "fund-report",
    display_name: "基金季报/年报生成器",
    phase: "started",
  });
});

test("parseToolStatusPayload: 无 display_name 时字段缺省", () => {
  const parsed = parseToolStatusPayload({
    name: "execute_skill",
    skill: "fund-report",
    phase: "finished",
    ok: true,
  });
  assert.deepEqual(parsed, {
    name: "execute_skill",
    skill: "fund-report",
    phase: "finished",
    ok: true,
  });
  assert.equal(parsed?.display_name, undefined);
});

test("parseToolStatusPayload: finished 帧携带 ok", () => {
  assert.deepEqual(parseToolStatusPayload({ name: "web_search", phase: "finished", ok: true }), {
    name: "web_search",
    phase: "finished",
    ok: true,
  });
  assert.deepEqual(
    parseToolStatusPayload({ name: "execute_skill", skill: "s", phase: "finished", ok: false }),
    { name: "execute_skill", skill: "s", phase: "finished", ok: false }
  );
});

test("parseToolStatusPayload: 非法 payload 返回 null", () => {
  assert.equal(parseToolStatusPayload(null), null);
  assert.equal(parseToolStatusPayload("started"), null);
  assert.equal(parseToolStatusPayload({}), null);
  assert.equal(parseToolStatusPayload({ name: "", phase: "started" }), null);
  assert.equal(parseToolStatusPayload({ name: "x", phase: "running" }), null);
  assert.equal(parseToolStatusPayload({ phase: "finished", ok: true }), null);
});

test("parseToolStatusPayload: 非字符串 skill/display_name / 非布尔 ok 被忽略", () => {
  const parsed = parseToolStatusPayload({
    name: "x",
    skill: 42,
    display_name: ["nope"],
    phase: "finished",
    ok: "yes",
  });
  assert.deepEqual(parsed, { name: "x", phase: "finished" });
  assert.equal(
    parseToolStatusPayload({ name: "x", display_name: "", phase: "started" })?.display_name,
    undefined
  );
});

test("extractSseErrorMessage: message/error/detail 字段优先", () => {
  assert.equal(extractSseErrorMessage({ message: "boom" }), "boom");
  assert.equal(extractSseErrorMessage({ error: "bad request" }), "bad request");
  assert.equal(extractSseErrorMessage({ detail: "llm timeout" }), "llm timeout");
  assert.equal(extractSseErrorMessage({ message: "first", error: "second" }), "first");
});

test("extractSseErrorMessage: 裸字符串与兜底序列化", () => {
  assert.equal(extractSseErrorMessage("plain failure"), "plain failure");
  assert.equal(extractSseErrorMessage({ code: 500 }), '{"code":500}');
  assert.equal(extractSseErrorMessage(null), "null");
});

test("isSseCommentLine: 心跳注释行跳过，event/data 行不受影响", () => {
  assert.equal(isSseCommentLine(": ping"), true);
  assert.equal(isSseCommentLine(":keepalive"), true);
  assert.equal(isSseCommentLine("event: tool_status"), false);
  assert.equal(isSseCommentLine('data: {"v":"x"}'), false);
});

test("parallel tool completions use call IDs and accept out-of-order finishes", () => {
  const steps = [
    { label: "inspect", toolCallId: "a" },
    { label: "inspect", toolCallId: "b" },
  ];
  assert.equal(
    findToolCompletionIndex(steps, { name: "inspect", phase: "finished", tool_call_id: "b" }),
    1
  );
  const finished = [{ ...steps[0], ok: true }, steps[1]];
  assert.equal(
    findToolCompletionIndex(finished, { name: "inspect", phase: "finished", tool_call_id: "a" }),
    -1
  );
  assert.equal(findToolCompletionIndex(finished, { name: "inspect", phase: "finished" }), 1);
  assert.equal(
    parseToolStatusPayload({ name: "inspect", phase: "started", tool_call_id: "a" })?.tool_call_id,
    "a"
  );
});

test("unknown and duplicate IDs never complete another outstanding call", () => {
  const steps = [
    { label: "inspect", toolCallId: "a", ok: false },
    { label: "inspect", toolCallId: "b" },
  ];
  assert.equal(
    findToolCompletionIndex(steps, { name: "inspect", phase: "finished", tool_call_id: "missing" }),
    -1
  );
  assert.equal(
    findToolCompletionIndex(steps, { name: "inspect", phase: "finished", tool_call_id: "a" }),
    -1
  );
  assert.equal(
    findToolCompletionIndex(steps, {
      name: "different label",
      phase: "finished",
      tool_call_id: "b",
    }),
    1
  );
});

test("legacy completions match the oldest unfinished display label", () => {
  const steps = [
    { label: "Skill title", ok: true },
    { label: "other" },
    { label: "Skill title" },
    { label: "Skill title" },
  ];
  assert.equal(
    findToolCompletionIndex(steps, {
      name: "execute_skill",
      skill: "skill-id",
      display_name: "Skill title",
      phase: "finished",
    }),
    2
  );
  assert.equal(
    findToolCompletionIndex([{ label: "skill-id" }], {
      name: "execute_skill",
      skill: "skill-id",
      phase: "finished",
    }),
    0
  );
  assert.equal(findToolCompletionIndex(steps, { name: "missing", phase: "finished" }), -1);
});

test("malformed or empty call IDs are omitted", () => {
  for (const tool_call_id of ["", null, 1, {}]) {
    const parsed = parseToolStatusPayload({ name: "inspect", phase: "started", tool_call_id });
    assert.ok(parsed);
    assert.equal(parsed.tool_call_id, undefined);
  }
});
