import assert from "node:assert/strict";
import { test } from "node:test";
import { latestReject, reviewActionLabelKey, unwrapReviewLog } from "../lib/reviewLog.ts";

const row = (overrides: Record<string, unknown> = {}) => ({
  id: 1,
  action: "reject",
  comment: "描述不够清晰",
  actor_id: 7,
  actor_name: "王审核",
  created_at: "2026-07-25T02:00:00Z",
  ...overrides,
});

test("unwrapReviewLog 正常响应原样归一化并保持顺序", () => {
  const items = unwrapReviewLog({
    items: [row({ id: 3, action: "reject" }), row({ id: 2, action: "submit", comment: null })],
  });
  assert.equal(items.length, 2);
  assert.deepEqual(
    items.map((i) => i.id),
    [3, 2]
  );
  assert.equal(items[0].comment, "描述不够清晰");
  assert.equal(items[1].comment, null);
});

test("unwrapReviewLog 容错：非对象/缺 items/items 非数组返回空数组", () => {
  assert.deepEqual(unwrapReviewLog(null), []);
  assert.deepEqual(unwrapReviewLog(undefined), []);
  assert.deepEqual(unwrapReviewLog("oops"), []);
  assert.deepEqual(unwrapReviewLog({}), []);
  assert.deepEqual(unwrapReviewLog({ items: "not-array" }), []);
});

test("unwrapReviewLog 逐项容错：缺 id 的行丢弃，字段形状不对归一化为 null/空串", () => {
  const items = unwrapReviewLog({
    items: [
      null,
      { action: "reject" }, // 缺 id → 丢弃
      { id: 5, action: 42, comment: 42, actor_id: "x", actor_name: 0, created_at: 0 },
    ],
  });
  assert.equal(items.length, 1);
  assert.deepEqual(items[0], {
    id: 5,
    action: "",
    comment: null,
    actor_id: null,
    actor_name: null,
    created_at: null,
  });
});

test("latestReject 取倒序列表中的第一条 reject", () => {
  const items = unwrapReviewLog({
    items: [
      row({ id: 10, action: "submit", comment: null }),
      row({ id: 9, action: "reject", comment: "第二次驳回" }),
      row({ id: 8, action: "reject", comment: "第一次驳回" }),
    ],
  });
  assert.equal(latestReject(items)?.id, 9);
  assert.equal(latestReject(items)?.comment, "第二次驳回");
});

test("latestReject 无驳回记录时返回 null", () => {
  assert.equal(latestReject([]), null);
  const items = unwrapReviewLog({
    items: [row({ id: 1, action: "approve" }), row({ id: 2, action: "submit" })],
  });
  assert.equal(latestReject(items), null);
});

test("reviewActionLabelKey 四个已知 action 映射齐全", () => {
  assert.equal(reviewActionLabelKey("submit"), "actionSubmit");
  assert.equal(reviewActionLabelKey("approve"), "actionApprove");
  assert.equal(reviewActionLabelKey("reject"), "actionReject");
  assert.equal(reviewActionLabelKey("self_publish"), "actionSelfPublish");
});

test("reviewActionLabelKey 未知 action 返回 null（UI 原样展示存储值）", () => {
  assert.equal(reviewActionLabelKey("withdraw"), null);
  assert.equal(reviewActionLabelKey(""), null);
});
