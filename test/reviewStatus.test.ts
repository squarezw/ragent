import assert from "node:assert/strict";
import { test } from "node:test";
import {
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
