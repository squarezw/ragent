import assert from "node:assert/strict";
import { test } from "node:test";
import {
  diffExecConfig,
  formatBytes,
  normalizeAssetDiff,
  normalizeExecConfig,
  parseSkillDiff,
  summarizeAssetDiff,
} from "../lib/skillAssets.ts";
import type { SkillExecConfigSummary } from "../types/review.ts";

const backendDiff = {
  id: 7,
  name: "fund-report",
  status: "pending_review",
  draft: "# draft body",
  published: "# published body",
  assets: [
    {
      path: "scripts/run.py",
      kind: "script",
      change: "modified",
      draft_sha256: "aaa",
      published_sha256: "bbb",
      draft_size: 2048,
      published_size: 1024,
      draft_text: "print('v2')",
      published_text: "print('v1')",
    },
    {
      path: "data/holdings.csv",
      kind: "data",
      change: "added",
      draft_sha256: "ccc",
      published_sha256: null,
      draft_size: 512,
      published_size: null,
      draft_text: null,
      published_text: null,
    },
    {
      path: "reference/old.md",
      kind: "reference",
      change: "removed",
      draft_sha256: null,
      published_sha256: "ddd",
      draft_size: null,
      published_size: 300,
      draft_text: null,
      published_text: null,
    },
    {
      path: "assets/logo.png",
      kind: "asset",
      change: "unchanged",
      draft_sha256: "eee",
      published_sha256: "eee",
      draft_size: 4096,
      published_size: 4096,
      draft_text: null,
      published_text: null,
    },
  ],
  exec_config_draft: {
    skill_id: 7,
    stage: "draft",
    entrypoint: "scripts/run.py",
    image: "ragent/python-sandbox:3.12",
    image_enabled: true,
    timeout_sec: 300,
    writable_subdirs: [".report_state"],
    needs_llm: true,
    warm_pool: false,
    updated_at: "2026-07-25T01:00:00Z",
  },
  exec_config_published: null,
};

test("parseSkillDiff 后端 P8a 完整形状", () => {
  const diff = parseSkillDiff(backendDiff);
  assert.equal(diff.draft, "# draft body");
  assert.equal(diff.published, "# published body");
  assert.equal(diff.assets.length, 4);
  assert.equal(diff.assets[0].path, "scripts/run.py");
  assert.equal(diff.assets[0].change, "modified");
  assert.equal(diff.assets[0].draft_text, "print('v2')");
  assert.equal(diff.exec_config_draft?.image, "ragent/python-sandbox:3.12");
  assert.equal(diff.exec_config_draft?.timeout_sec, 300);
  assert.equal(diff.exec_config_draft?.needs_llm, true);
  assert.deepEqual(diff.exec_config_draft?.writable_subdirs, [".report_state"]);
  assert.equal(diff.exec_config_published, null);
});

test("parseSkillDiff 旧后端形状（无 assets/exec_config）降级为空", () => {
  const diff = parseSkillDiff({ draft: "d", published: null });
  assert.equal(diff.draft, "d");
  assert.equal(diff.published, null);
  assert.deepEqual(diff.assets, []);
  assert.equal(diff.exec_config_draft, null);
  assert.equal(diff.exec_config_published, null);
});

test("parseSkillDiff 容错：空/非对象", () => {
  const diff = parseSkillDiff(null);
  assert.equal(diff.draft, "");
  assert.deepEqual(diff.assets, []);
});

test("normalizeAssetDiff 剔除坏行、未知 change 按 modified 保守标注", () => {
  const items = normalizeAssetDiff([
    { path: "a.py", kind: "script", change: "renamed" },
    { kind: "script", change: "added" },
    "oops",
    null,
    { path: "b.csv", kind: "data", change: "added", draft_size: 10 },
  ]);
  assert.equal(items.length, 2);
  assert.equal(items[0].change, "modified");
  assert.equal(items[1].path, "b.csv");
  assert.equal(items[1].draft_size, 10);
  assert.deepEqual(normalizeAssetDiff(undefined), []);
  assert.deepEqual(normalizeAssetDiff({}), []);
});

test("normalizeExecConfig 缺 entrypoint/image 视为无配置", () => {
  assert.equal(normalizeExecConfig(null), null);
  assert.equal(normalizeExecConfig({ entrypoint: "run.py" }), null);
  assert.equal(normalizeExecConfig({ image: "img:1" }), null);
  const cfg = normalizeExecConfig({ entrypoint: "run.py", image: "img:1" });
  assert.equal(cfg?.timeout_sec, 120);
  assert.equal(cfg?.image_enabled, true);
  assert.deepEqual(cfg?.writable_subdirs, []);
  assert.equal(cfg?.needs_llm, false);
});

test("summarizeAssetDiff 草稿清单规模 + 变更计数（removed 不计入草稿）", () => {
  const summary = summarizeAssetDiff(parseSkillDiff(backendDiff).assets);
  assert.equal(summary.total, 3); // modified + added + unchanged
  assert.equal(summary.totalBytes, 2048 + 512 + 4096);
  assert.equal(summary.added, 1);
  assert.equal(summary.removed, 1);
  assert.equal(summary.modified, 1);
  assert.equal(summary.hasChanges, true);
});

test("summarizeAssetDiff 全部 unchanged 时 hasChanges 为假", () => {
  const summary = summarizeAssetDiff(
    normalizeAssetDiff([
      { path: "a", kind: "script", change: "unchanged", draft_size: 5, published_size: 5 },
    ])
  );
  assert.equal(summary.total, 1);
  assert.equal(summary.hasChanges, false);
});

const baseCfg: SkillExecConfigSummary = {
  stage: "published",
  entrypoint: "run.py",
  image: "img:1",
  image_enabled: true,
  timeout_sec: 120,
  writable_subdirs: ["state"],
  needs_llm: false,
  warm_pool: false,
};

test("diffExecConfig 相同配置无差异（stage/image_enabled 不参与对比）", () => {
  const draft = { ...baseCfg, stage: "draft", image_enabled: false };
  assert.deepEqual(diffExecConfig(draft, baseCfg), []);
});

test("diffExecConfig 逐字段标注差异", () => {
  const draft: SkillExecConfigSummary = {
    ...baseCfg,
    stage: "draft",
    image: "img:2",
    timeout_sec: 600,
    writable_subdirs: ["state", "out"],
    needs_llm: true,
  };
  assert.deepEqual(diffExecConfig(draft, baseCfg), [
    "image",
    "timeout_sec",
    "writable_subdirs",
    "needs_llm",
  ]);
});

test("diffExecConfig 任一侧缺失不逐字段标（整块新增/移除）", () => {
  assert.deepEqual(diffExecConfig(baseCfg, null), []);
  assert.deepEqual(diffExecConfig(null, baseCfg), []);
  assert.deepEqual(diffExecConfig(null, null), []);
});

test("formatBytes 人类可读格式", () => {
  assert.equal(formatBytes(0), "0 B");
  assert.equal(formatBytes(512), "512 B");
  assert.equal(formatBytes(1536), "1.5 KB");
  assert.equal(formatBytes(2 * 1024 * 1024), "2.0 MB");
  assert.equal(formatBytes(3 * 1024 * 1024 * 1024), "3.0 GB");
  assert.equal(formatBytes(null), "-");
  assert.equal(formatBytes(undefined), "-");
  assert.equal(formatBytes(-1), "-");
});
