import assert from "node:assert/strict";
import { test } from "node:test";
import {
  extractSseErrorMessage,
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

test("parseToolStatusPayload: 非字符串 skill / 非布尔 ok 被忽略", () => {
  const parsed = parseToolStatusPayload({ name: "x", skill: 42, phase: "finished", ok: "yes" });
  assert.deepEqual(parsed, { name: "x", phase: "finished" });
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
