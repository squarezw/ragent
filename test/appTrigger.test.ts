import assert from "node:assert/strict";
import { test } from "node:test";
import { PRESENTATION_MODE_LABEL_KEY, presentationModeLabel } from "../lib/appTrigger.ts";

// 假 t：直接回文案键，便于断言映射本身
const t = ((k: string) => k) as unknown as (key: never) => string;

test("展示方式仅映射聊天和自定义", () => {
  assert.equal(presentationModeLabel("Chat", t), "chatType");
  assert.equal(presentationModeLabel("Custom", t), "customType");
  assert.deepEqual(PRESENTATION_MODE_LABEL_KEY, {
    Chat: "chatType",
    Custom: "customType",
  });
});

test("旧展示方式不会被渲染成有效选项", () => {
  assert.equal(presentationModeLabel("Subscription", t), "");
  assert.equal(presentationModeLabel("Email", t), "");
  assert.equal(presentationModeLabel("Tool", t), "");
  assert.equal(presentationModeLabel("Plugin", t), "");
  assert.equal(presentationModeLabel("SomethingNew", t), "");
});
