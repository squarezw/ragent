import assert from "node:assert/strict";
import { test } from "node:test";
import { TRIGGER_LABEL_KEY, triggerLabel } from "../lib/appTrigger.ts";

// 假 t：直接回文案键，便于断言映射本身
const t = ((k: string) => k) as unknown as (key: never) => string;

test("底层值 → 文案键的映射", () => {
  assert.equal(triggerLabel("Chat", t), "chatType");
  assert.equal(triggerLabel("Email", t), "emailType");
  assert.equal(triggerLabel("Custom", t), "customType");
});

test("Subscription 显示为定时任务，但值本身不变", () => {
  // 这条是整个改动的关键取舍：显示归到「定时任务」，存的值仍是 Subscription，
  // 因为 isStreamApp 靠它决定要不要显示订阅源管理。
  assert.equal(triggerLabel("Subscription", t), "subscriptionType");
  assert.ok("Subscription" in TRIGGER_LABEL_KEY);
});

test("撤下的 Tool / Plugin 仍有文案，不显示空白", () => {
  assert.equal(triggerLabel("Tool", t), "toolType");
  assert.equal(triggerLabel("Plugin", t), "pluginType");
});

test("认不出的值原样显示", () => {
  // 比显示空白强，也让"哪儿冒出个新值"看得见
  assert.equal(triggerLabel("SomethingNew", t), "SomethingNew");
  assert.equal(triggerLabel("", t), "");
});
