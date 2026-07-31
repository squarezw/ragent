import assert from "node:assert/strict";
import { test } from "node:test";
import {
  appStatusBadge,
  hasUnpublishedChanges,
  resolveReviewStatus,
  reviewStatusBadge,
} from "../lib/reviewStatus.ts";

test("resolveReviewStatus 合法状态原样返回", () => {
  for (const status of ["draft", "pending_review", "rejected", "published"] as const) {
    assert.equal(resolveReviewStatus(status, null), status);
    assert.equal(resolveReviewStatus(status, "published body"), status);
  }
});

test("resolveReviewStatus 缺失/非法时按 published_content 兜底", () => {
  assert.equal(resolveReviewStatus(undefined, null), "draft");
  assert.equal(resolveReviewStatus(undefined, undefined), "draft");
  assert.equal(resolveReviewStatus(null, "body"), "published");
  assert.equal(resolveReviewStatus("unknown_status", "body"), "published");
  assert.equal(resolveReviewStatus(42, null), "draft");
});

test("hasUnpublishedChanges 只在已有发布正文且草稿不同的情况下为真", () => {
  assert.equal(hasUnpublishedChanges("same", "same"), false);
  assert.equal(hasUnpublishedChanges("changed", "same"), true);
  // 从未发布：永远 false
  assert.equal(hasUnpublishedChanges("anything", null), false);
  assert.equal(hasUnpublishedChanges("anything", undefined), false);
  // content 缺失按空串比较
  assert.equal(hasUnpublishedChanges(undefined, ""), false);
  assert.equal(hasUnpublishedChanges(null, "body"), true);
});

test("reviewStatusBadge 四态映射齐全", () => {
  assert.equal(reviewStatusBadge("draft").labelKey, "statusDraft");
  assert.equal(reviewStatusBadge("draft").variant, "secondary");
  assert.equal(reviewStatusBadge("pending_review").labelKey, "statusPendingReview");
  assert.equal(reviewStatusBadge("rejected").variant, "destructive");
  assert.equal(reviewStatusBadge("published").labelKey, "statusPublished");
});

test("appStatusBadge：published 与非法/缺失 status 都不出徽标", () => {
  // published 是数字员工的正常终态且无出口动作，显示它只是噪音
  assert.equal(appStatusBadge("published"), null);
  assert.equal(appStatusBadge(undefined), null);
  assert.equal(appStatusBadge(""), null);
  assert.equal(appStatusBadge("archived"), null);
});

test("appStatusBadge：三个异常态照常出徽标且与共用映射一致", () => {
  for (const status of ["draft", "pending_review", "rejected"] as const) {
    assert.deepEqual(appStatusBadge(status), reviewStatusBadge(status));
  }
});

test("appStatusBadge 不影响 Skill 的 published 徽标", () => {
  // Skill 有双快照，"已发布"要和"有未发布修改"区分，徽标有信息量
  assert.equal(reviewStatusBadge("published").labelKey, "statusPublished");
});
