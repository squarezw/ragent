import assert from "node:assert/strict";
import { test } from "node:test";
import { isSelfReview, unwrapPendingReviews } from "../lib/reviewQueue.ts";

test("unwrapPendingReviews 后端实际形状：合并 items 按 target_type 拆分", () => {
  const result = unwrapPendingReviews({
    total: 3,
    skills: 2,
    apps: 1,
    items: [
      {
        target_type: "skill",
        id: 1,
        name: "weekly-report",
        display_name: "周报",
        user_id: 42,
        submitted_at: "2026-07-25T01:00:00Z",
      },
      { target_type: "skill", id: 2, name: "meeting-notes", user_id: null },
      { target_type: "app", id: 9, name: "客服助手", user_id: 7 },
    ],
  });
  assert.equal(result.total, 3);
  assert.equal(result.skills.length, 2);
  assert.equal(result.apps.length, 1);
  assert.equal(result.skills[0].display_name, "周报");
  assert.equal(result.skills[0].user_id, 42);
  assert.equal(result.skills[1].user_id, null);
  assert.equal(result.apps[0].id, 9);
  assert.equal(result.apps[0].user_id, 7);
});

test("unwrapPendingReviews items 形状缺 total 时按 items 长度补", () => {
  const result = unwrapPendingReviews({
    items: [{ target_type: "skill", id: 1, name: "a" }],
  });
  assert.equal(result.total, 1);
  // 未知 target_type 不落入任何分组，但计入 total
  const mixed = unwrapPendingReviews({
    items: [
      { target_type: "skill", id: 1, name: "a" },
      { target_type: "workflow", id: 2, name: "b" },
    ],
  });
  assert.equal(mixed.skills.length, 1);
  assert.equal(mixed.apps.length, 0);
  assert.equal(mixed.total, 2);
});

test("unwrapPendingReviews 冻结契约旧形状（skills/apps 数组）保持兼容", () => {
  const result = unwrapPendingReviews({
    skills: [{ id: 1, name: "a" }],
    apps: [{ id: 2, name: "b" }],
  });
  assert.equal(result.skills.length, 1);
  assert.equal(result.apps.length, 1);
  assert.equal(result.total, 2);
});

test("unwrapPendingReviews 容错：空/非对象返回空队列", () => {
  assert.deepEqual(unwrapPendingReviews(null), { skills: [], apps: [], total: 0 });
  assert.deepEqual(unwrapPendingReviews(undefined), { skills: [], apps: [], total: 0 });
  assert.deepEqual(unwrapPendingReviews("oops"), { skills: [], apps: [], total: 0 });
});

test("isSelfReview 同人且非超管为真", () => {
  assert.equal(isSelfReview(42, 42, false), true);
});

test("isSelfReview 超管审自己允许（返回 false 不隐藏按钮）", () => {
  assert.equal(isSelfReview(42, 42, true), false);
});

test("isSelfReview 不同人为假", () => {
  assert.equal(isSelfReview(42, 7, false), false);
});

test("isSelfReview 任一 id 缺失不拦（交给后端兜底）", () => {
  assert.equal(isSelfReview(undefined, 42, false), false);
  assert.equal(isSelfReview(null, 42, false), false);
  assert.equal(isSelfReview(42, undefined, false), false);
  assert.equal(isSelfReview(42, null, false), false);
});
