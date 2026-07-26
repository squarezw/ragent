import assert from "node:assert/strict";
import { test } from "node:test";
import {
  ASSET_MAX_FILE_BYTES,
  ASSET_MAX_TOTAL_BYTES,
  arrayBufferToBase64,
  diffExecConfig,
  encodeAssetPath,
  formatBytes,
  groupAssetsByDir,
  inferAssetKind,
  joinEncodedSegments,
  normalizeAssetDiff,
  normalizeAssetPath,
  normalizeExecConfig,
  parseAssetList,
  parseExecConfig,
  parseSandboxImages,
  parseSkillDiff,
  planUploads,
  resolveImageSelection,
  sandboxImageValue,
  shortSha,
  summarizeAssetDiff,
  validateAssetPath,
  validateWritableSubdir,
  willRevertToDraft,
} from "../lib/skillAssets.ts";
import type { SkillExecConfigSummary } from "../types/review.ts";
import type { SkillAssetItem } from "../types/skill.ts";

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

// ---------------------------------------------------------------------------
// P8 资产管理纯函数
// ---------------------------------------------------------------------------

const asset = (path: string, size: number, kind = "asset"): SkillAssetItem => ({
  path,
  kind,
  size_bytes: size,
  sha256: "0123456789abcdef".repeat(4),
  source_repo: null,
  source_commit: null,
  created_by_agent: false,
  updated_at: null,
});

test("normalizeAssetPath 抹平 ./ 前导斜杠 重复斜杠 尾斜杠与首尾空白", () => {
  assert.equal(normalizeAssetPath("  scripts/run.py  "), "scripts/run.py");
  assert.equal(normalizeAssetPath("./scripts/run.py"), "scripts/run.py");
  assert.equal(normalizeAssetPath("/scripts//run.py/"), "scripts/run.py");
  assert.equal(
    normalizeAssetPath("references/（模版）新建元一期.docx"),
    "references/（模版）新建元一期.docx"
  );
  assert.equal(normalizeAssetPath(""), "");
});

test("validateAssetPath 接受中文与空格路径", () => {
  assert.equal(validateAssetPath("references/（模版）新建元一期 v2.docx"), null);
  assert.equal(validateAssetPath("data/尽调通表_2026Q1.xlsx"), null);
  assert.equal(validateAssetPath("scripts/run.py"), null);
});

test("validateAssetPath 逐条对齐后端拒绝规则", () => {
  assert.equal(validateAssetPath(""), "empty");
  assert.equal(validateAssetPath("a".repeat(501)), "tooLong");
  assert.equal(validateAssetPath("scripts\\run.py"), "backslash");
  assert.equal(validateAssetPath("/etc/passwd"), "absolute");
  assert.equal(validateAssetPath("scripts//run.py"), "emptySegment");
  assert.equal(validateAssetPath("scripts/../../etc/passwd"), "dotSegment");
  assert.equal(validateAssetPath("./run.py"), "dotSegment");
  assert.equal(validateAssetPath(".report_state/cache.json"), "hiddenSegment");
  assert.equal(validateAssetPath("scripts/.hidden"), "hiddenSegment");
});

test("validateWritableSubdir 允许隐藏段但拒 .. 与空", () => {
  assert.equal(validateWritableSubdir(".report_state"), null);
  assert.equal(validateWritableSubdir("out/cache"), null);
  assert.equal(validateWritableSubdir("  "), "empty");
  assert.equal(validateWritableSubdir("../escape"), "dotSegment");
});

test("inferAssetKind 按顶层目录推断，其余归 reference", () => {
  assert.equal(inferAssetKind("scripts/run.py"), "script");
  assert.equal(inferAssetKind("data/holdings.csv"), "data");
  assert.equal(inferAssetKind("assets/logo.png"), "asset");
  assert.equal(inferAssetKind("references/guide.md"), "reference");
  assert.equal(inferAssetKind("SKILL.md"), "reference");
  assert.equal(inferAssetKind("misc/notes.txt"), "reference");
  assert.equal(inferAssetKind("./scripts/nested/run.py"), "script");
});

test("encodeAssetPath 编码中文与空格但保留分隔符", () => {
  assert.equal(encodeAssetPath("scripts/run.py"), "scripts/run.py");
  assert.equal(
    encodeAssetPath("references/（模版）新建元一期.docx"),
    `references/${encodeURIComponent("（模版）新建元一期.docx")}`
  );
  assert.equal(encodeAssetPath("data/a b.csv"), "data/a%20b.csv");
  assert.equal(encodeAssetPath("data/a#b?c.csv"), "data/a%23b%3Fc.csv");
  // 往返：逐段解码回原路径
  const original = "references/（模版）新建 元一期.docx";
  assert.equal(encodeAssetPath(original).split("/").map(decodeURIComponent).join("/"), original);
});

test("joinEncodedSegments 把 Next.js 已解码的 catch-all 段重新编码", () => {
  assert.equal(joinEncodedSegments(["data", "a b.csv"]), "data/a%20b.csv");
  assert.equal(
    joinEncodedSegments(["references", "（模版）新建元一期.docx"]),
    `references/${encodeURIComponent("（模版）新建元一期.docx")}`
  );
  assert.equal(joinEncodedSegments("run.py"), "run.py");
  assert.equal(joinEncodedSegments([]), "");
  assert.equal(joinEncodedSegments(undefined), "");
});

test("shortSha 取前 8 位", () => {
  assert.equal(shortSha("0123456789abcdef"), "01234567");
  assert.equal(shortSha(""), "-");
  assert.equal(shortSha(null), "-");
});

test("parseAssetList 容错解包并回算合计", () => {
  const parsed = parseAssetList({
    skill_id: 3,
    stage: "draft",
    items: [
      { path: "scripts/run.py", kind: "script", size_bytes: 100, sha256: " abc " },
      { kind: "data", size_bytes: 1 },
      "bad",
    ],
  });
  assert.equal(parsed.stage, "draft");
  assert.equal(parsed.items.length, 1);
  assert.equal(parsed.items[0].sha256, "abc");
  assert.equal(parsed.total, 1);
  assert.equal(parsed.total_bytes, 100);
  const empty = parseAssetList(undefined);
  assert.deepEqual(empty.items, []);
  assert.equal(empty.total_bytes, 0);
});

test("parseExecConfig 带 llm 限额字段；缺 entrypoint 视为无配置", () => {
  const cfg = parseExecConfig({
    skill_id: 3,
    stage: "draft",
    entrypoint: "scripts/run.py",
    image: "ragent-skill-fund:latest",
    timeout_sec: 300,
    writable_subdirs: [".report_state"],
    needs_llm: true,
    warm_pool: false,
    llm_max_calls: 5,
    llm_max_total_tokens: 100000,
    updated_at: "2026-07-27T00:00:00Z",
  });
  assert.equal(cfg?.entrypoint, "scripts/run.py");
  assert.equal(cfg?.llm_max_calls, 5);
  assert.equal(cfg?.llm_max_total_tokens, 100000);
  assert.equal(cfg?.updated_at, "2026-07-27T00:00:00Z");
  assert.equal(parseExecConfig({ image: "x:1" }), null);
  assert.equal(parseExecConfig(null), null);
});

test("parseSandboxImages 归一化并回算 ref", () => {
  const images = parseSandboxImages({
    items: [
      {
        id: 1,
        name: "ragent-skill-fund",
        tag: "latest",
        digest: null,
        is_enabled: true,
        ref: "ragent-skill-fund:latest",
      },
      { id: 2, name: "ragent-skill-x", tag: "v2", digest: "sha256:beef", is_enabled: false },
      { tag: "orphan" },
    ],
    total: 3,
  });
  assert.equal(images.length, 2);
  assert.equal(images[1].ref, "ragent-skill-x@sha256:beef");
  assert.equal(images[1].is_enabled, false);
  assert.deepEqual(parseSandboxImages(undefined), []);
});

test("sandboxImageValue 永远是 name:tag（digest ref 提交会被后端 rsplit 拆坏成 422）", () => {
  const digestImage = {
    id: 2,
    name: "ragent-skill-x",
    tag: "v2",
    digest: "sha256:beef",
    is_enabled: true,
    description: null,
    ref: "ragent-skill-x@sha256:beef",
  };
  assert.equal(sandboxImageValue(digestImage), "ragent-skill-x:v2");
});

test("resolveImageSelection 把 digest 形态的 ref 映射回可提交的 name:tag", () => {
  const images = parseSandboxImages({
    items: [
      { id: 1, name: "ragent-skill-fund", tag: "latest", digest: null, is_enabled: true },
      { id: 2, name: "ragent-skill-x", tag: "v2", digest: "sha256:beef", is_enabled: true },
    ],
  });
  const byDigest = resolveImageSelection("ragent-skill-x@sha256:beef", images);
  assert.equal(byDigest.value, "ragent-skill-x:v2");
  assert.equal(byDigest.matched?.id, 2);

  const byTag = resolveImageSelection("ragent-skill-fund:latest", images);
  assert.equal(byTag.value, "ragent-skill-fund:latest");
  assert.equal(byTag.matched?.id, 1);

  const unknown = resolveImageSelection("removed-image:1", images);
  assert.equal(unknown.value, "removed-image:1");
  assert.equal(unknown.matched, null);

  assert.deepEqual(resolveImageSelection(null, images), { value: "", matched: null });
});

test("groupAssetsByDir 约定目录在前，其余字典序，根文件最后", () => {
  const groups = groupAssetsByDir([
    asset("SKILL.md", 10),
    asset("zzz/other.txt", 20),
    asset("data/b.csv", 30),
    asset("data/a.csv", 40),
    asset("scripts/run.py", 50),
    asset("misc/x.txt", 60),
  ]);
  assert.deepEqual(
    groups.map((g) => g.dir),
    ["scripts", "data", "misc", "zzz", ""]
  );
  assert.deepEqual(
    groups[1].items.map((i) => i.path),
    ["data/a.csv", "data/b.csv"]
  );
  assert.equal(groups[1].totalBytes, 70);
  assert.deepEqual(
    groups[4].items.map((i) => i.path),
    ["SKILL.md"]
  );
});

test("planUploads 推断 kind 并规范化路径", () => {
  const plan = planUploads(
    [],
    [
      { path: "./scripts/run.py", size: 100 },
      { path: "data/尽调通表 2026Q1.xlsx", size: 200 },
      { path: "notes.md", size: 10, kind: "asset" },
    ]
  );
  assert.deepEqual(
    plan.entries.map((e) => [e.path, e.kind, e.error]),
    [
      ["scripts/run.py", "script", null],
      ["data/尽调通表 2026Q1.xlsx", "data", null],
      ["notes.md", "asset", null],
    ]
  );
  assert.equal(plan.acceptedCount, 3);
  assert.equal(plan.totalBytesAfter, 310);
});

test("planUploads 单文件超 20MB 直接拦下，后续小文件不受影响", () => {
  const plan = planUploads(
    [],
    [
      { path: "data/huge.bin", size: ASSET_MAX_FILE_BYTES + 1 },
      { path: "data/ok.bin", size: 1024 },
    ]
  );
  assert.deepEqual(plan.entries[0].error, { type: "tooLarge", limit: ASSET_MAX_FILE_BYTES });
  assert.equal(plan.entries[1].error, null);
  assert.equal(plan.acceptedCount, 1);
  assert.equal(plan.rejectedCount, 1);
  assert.equal(plan.totalBytesAfter, 1024);
});

test("planUploads 边界：正好 20MB 放行", () => {
  const plan = planUploads([], [{ path: "data/exact.bin", size: ASSET_MAX_FILE_BYTES }]);
  assert.equal(plan.entries[0].error, null);
});

test("planUploads 合计超 100MB 报 quota，不占用配额", () => {
  const existing = [asset("data/old.bin", ASSET_MAX_TOTAL_BYTES - 1024)];
  const plan = planUploads(existing, [
    { path: "data/big.bin", size: 4096 },
    { path: "data/small.bin", size: 512 },
  ]);
  assert.deepEqual(plan.entries[0].error, { type: "quota", limit: ASSET_MAX_TOTAL_BYTES });
  assert.equal(plan.entries[1].error, null);
  assert.equal(plan.totalBytesAfter, ASSET_MAX_TOTAL_BYTES - 512);
});

test("planUploads 同名覆盖不重复计入配额（批内同名按最后一次计）", () => {
  // 累加语义下 90MB + 15MB 会超 100MB 配额，覆盖语义下只算 15MB
  const existing = [asset("data/x.bin", 90 * 1024 * 1024)];
  const plan = planUploads(existing, [
    { path: "data/x.bin", size: 15 * 1024 * 1024 },
    { path: "data/x.bin", size: 5 * 1024 * 1024 },
  ]);
  assert.equal(plan.entries[0].error, null);
  assert.equal(plan.entries[1].error, null);
  assert.equal(plan.totalBytesAfter, 5 * 1024 * 1024);
});

test("planUploads 非法路径带出具体错误码", () => {
  const plan = planUploads(
    [],
    [
      { path: ".report_state/cache.json", size: 10 },
      { path: "../escape.txt", size: 10 },
    ]
  );
  assert.deepEqual(plan.entries[0].error, { type: "path", code: "hiddenSegment" });
  assert.deepEqual(plan.entries[1].error, { type: "path", code: "dotSegment" });
  assert.equal(plan.acceptedCount, 0);
});

test("willRevertToDraft 只对 published / rejected 为真", () => {
  assert.equal(willRevertToDraft("published"), true);
  assert.equal(willRevertToDraft("rejected"), true);
  assert.equal(willRevertToDraft("draft"), false);
  assert.equal(willRevertToDraft("pending_review"), false);
  assert.equal(willRevertToDraft(undefined), false);
});

test("arrayBufferToBase64 与 Buffer 编码一致（含大于分块阈值的输入）", () => {
  const bytes = new Uint8Array(0x8000 + 1234);
  for (let i = 0; i < bytes.length; i++) bytes[i] = (i * 7) % 256;
  assert.equal(arrayBufferToBase64(bytes.buffer), Buffer.from(bytes).toString("base64"));
  assert.equal(arrayBufferToBase64(new Uint8Array([]).buffer), "");
});
