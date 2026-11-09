import assert from "node:assert/strict";
import { test } from "node:test";
// @ts-expect-error Node strip-types requires the explicit TypeScript extension.
import { parseKnowledgeWriteConfirmation } from "../lib/knowledgeWrite.ts";

const payload = {
  status: "confirmation_required",
  request_id: "a".repeat(32),
  chat_id: "42",
  filename: "报告.xlsx",
  datasets: [{ id: "550e8400-e29b-41d4-a716-446655440000", name: "我的知识库" }],
};

test("accepts structured selection and strips unrelated fields", () => {
  assert.deepEqual(
    parseKnowledgeWriteConfirmation({ ...payload, confirmed: true, object_key: "PRIVATE" }),
    payload
  );
});
test("rejects malformed selection before rendering an action", () => {
  for (const value of [
    null,
    "confirmed",
    {},
    { ...payload, datasets: [] },
    { ...payload, request_id: "../confirm" },
    { ...payload, chat_id: "other/session" },
    { ...payload, datasets: [{ id: "../target", name: "bad" }] },
  ]) {
    assert.equal(parseKnowledgeWriteConfirmation(value), null);
  }
});
