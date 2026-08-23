import assert from "node:assert/strict";
import { test } from "node:test";
import {
  ASSET_MAX_FILE_BYTES,
  ASSET_MAX_TOTAL_BYTES,
  arrayBufferToBase64,
  assetKindWarning,
  buildExecConfigPayload,
  diffExecConfig,
  encodeAssetPath,
  formatBytes,
  groupAssetsByDir,
  inferAssetKind,
  isEnvTemplatePath,
  isModelReadableAsset,
  isViewableAssetPath,
  joinEncodedSegments,
  normalizeAssetDiff,
  normalizeAssetPath,
  normalizeExecConfig,
  parseAssetList,
  parseExecConfig,
  parseSandboxImages,
  parseSkillDiff,
  planUploads,
  readableAssetPaths,
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
    image: "ragent/python-sandbox:3.12",
    image_enabled: true,
    timeout_sec: 300,
    writable_subdirs: [".report_state"],
    needs_network: true,
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
  assert.equal(diff.exec_config_draft?.needs_network, true);
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

test("normalizeExecConfig 缺 image 视为无配置", () => {
  assert.equal(normalizeExecConfig(null), null);
  assert.equal(normalizeExecConfig({}), null);
  assert.equal(normalizeExecConfig({ stage: "draft", timeout_sec: 300 }), null);
  const cfg = normalizeExecConfig({ image: "img:1" });
  assert.equal(cfg?.timeout_sec, 120);
  assert.equal(cfg?.image_enabled, true);
  assert.deepEqual(cfg?.writable_subdirs, []);
  assert.equal(cfg?.needs_network, false);
});

// 后端已删 entrypoint 列（迁移 039）：只有 image 的响应必须判为有效 exec 配置
test("normalizeExecConfig 有 image 无 entrypoint 仍是有效配置", () => {
  const cfg = normalizeExecConfig({
    stage: "draft",
    image: "ragent-skill-fund:latest",
    timeout_sec: 300,
    needs_network: true,
  });
  assert.notEqual(cfg, null);
  assert.equal(cfg?.image, "ragent-skill-fund:latest");
  assert.equal(cfg?.timeout_sec, 300);
  assert.equal(cfg?.needs_network, true);
});

// 后端已删 needs_llm / llm_max_* 三列（迁移 040）：旧键出现在响应里也不该被读进来
test("normalizeExecConfig 忽略后端已删的 LLM 字段（不再有 needs_llm 语义）", () => {
  const cfg = normalizeExecConfig({
    image: "img:1",
    needs_llm: true,
    llm_max_calls: 5,
    llm_max_total_tokens: 100000,
  }) as unknown as Record<string, unknown>;
  assert.equal(cfg.needs_network, false);
  assert.equal("needs_llm" in cfg, false);
  assert.equal("llm_max_calls" in cfg, false);
  assert.equal("llm_max_total_tokens" in cfg, false);
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
  image: "img:1",
  image_enabled: true,
  timeout_sec: 120,
  writable_subdirs: ["state"],
  needs_network: false,
  warm_pool: false,
  artifact_exclude: [],
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
    needs_network: true,
  };
  assert.deepEqual(diffExecConfig(draft, baseCfg), [
    "image",
    "timeout_sec",
    "writable_subdirs",
    "needs_network",
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

test("inferAssetKind 兜底走扩展名：二进制不再默认 reference（对齐后端 classify_kind）", () => {
  assert.equal(inferAssetKind("references/模板.docx"), "asset");
  assert.equal(inferAssetKind("字段计算规则.pdf"), "asset");
  assert.equal(inferAssetKind("report_manual/样例.xlsx"), "asset");
  assert.equal(inferAssetKind("logo.PNG"), "asset");
  // 顶层目录命中优先于扩展名，与后端 KIND_BY_TOP_DIR 一致
  assert.equal(inferAssetKind("scripts/手册.docx"), "script");
  assert.equal(inferAssetKind("data/表.xlsx"), "data");
});

test("isViewableAssetPath 镜像后端 is_viewable_path", () => {
  for (const path of ["references/guide.md", "AGENTS.md", "requirements.txt", "scripts/run.py"]) {
    assert.equal(isViewableAssetPath(path), true, path);
  }
  for (const path of ["a.docx", "a.pdf", "a.xlsx", "a.png", "a.zip", "a.PDF", "a.Docx"]) {
    assert.equal(isViewableAssetPath(path), false, path);
  }
  // 无扩展名 / 目录名带点 / 隐藏文件按 splitext 语义都算可读
  assert.equal(isViewableAssetPath("README"), true);
  assert.equal(isViewableAssetPath("v1.2/notes"), true);
  assert.equal(isViewableAssetPath(".gitignore"), true);
});

test("isModelReadableAsset 三条判据：kind=reference + 非二进制 + 非根 SKILL.md", () => {
  assert.equal(isModelReadableAsset({ kind: "reference", path: "references/guide.md" }), true);
  assert.equal(isModelReadableAsset({ kind: "reference", path: "AGENTS.md" }), true);
  // 根 SKILL.md 是全量注入的正文本体，后端 footer 也剔掉它
  assert.equal(isModelReadableAsset({ kind: "reference", path: "SKILL.md" }), false);
  assert.equal(isModelReadableAsset({ kind: "reference", path: "./SKILL.md" }), false);
  // 只剔根目录那一份；子目录同名文件仍可读
  assert.equal(isModelReadableAsset({ kind: "reference", path: "sub/SKILL.md" }), true);
  assert.equal(isModelReadableAsset({ kind: "reference", path: "references/表.docx" }), false);
  for (const kind of ["script", "asset", "data"]) {
    assert.equal(isModelReadableAsset({ kind, path: "references/guide.md" }), false, kind);
  }
});

test("readableAssetPaths 只收已发布快照里模型读得到的路径", () => {
  const published = [
    asset("references/guide.md", 100, "reference"),
    asset("references/表.docx", 200, "reference"),
    asset("SKILL.md", 300, "reference"),
    asset("scripts/run.py", 400, "script"),
    asset("data/holdings.csv", 500, "data"),
  ];
  assert.deepEqual([...readableAssetPaths(published)], ["references/guide.md"]);
  assert.equal(readableAssetPaths([]).size, 0);
});

test("assetKindWarning 只在二进制被标成 reference 时提示", () => {
  assert.equal(assetKindWarning("references/表.docx", "reference"), "binaryAsReference");
  assert.equal(assetKindWarning("字段规则.pdf", "reference"), "binaryAsReference");
  assert.equal(assetKindWarning("references/guide.md", "reference"), null);
  // 二进制标成 asset/data/script 是正解，不提示
  assert.equal(assetKindWarning("references/表.docx", "asset"), null);
  assert.equal(assetKindWarning("data/表.xlsx", "data"), null);
  // 文本标成 asset/data 只是放弃可读性，不提示（data/*.csv 这类是常态）
  assert.equal(assetKindWarning("data/holdings.csv", "data"), null);
  assert.equal(assetKindWarning("scripts/run.py", "script"), null);
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

test("parseExecConfig 读出 needs_network；缺 image 视为无配置", () => {
  const cfg = parseExecConfig({
    skill_id: 3,
    stage: "draft",
    image: "ragent-skill-fund:latest",
    timeout_sec: 300,
    writable_subdirs: [".report_state"],
    needs_network: true,
    warm_pool: false,
    updated_at: "2026-07-27T00:00:00Z",
  });
  assert.equal(cfg?.image, "ragent-skill-fund:latest");
  assert.equal(cfg?.needs_network, true);
  assert.equal(cfg?.updated_at, "2026-07-27T00:00:00Z");
  assert.equal(parseExecConfig({ stage: "draft", timeout_sec: 300 }), null);
  assert.equal(parseExecConfig(null), null);
});

const execEdits = {
  image: "ragent-skill-fund:latest",
  timeout_sec: 300,
  needs_network: true,
  warm_pool: false,
};

// 回归防线：可写目录已从表单下架，但后端 PUT 是全量覆盖（缺省 → []）。
// 这条断言失败就意味着保存一次运行配置会清掉 fund 的 .report_state 持久状态。
test("buildExecConfigPayload：edits 未给 writable_subdirs 时透传 GET 现值", () => {
  const loaded = parseExecConfig({
    stage: "draft",
    image: "ragent-skill-fund:latest",
    timeout_sec: 300,
    writable_subdirs: [".report_state"],
    needs_network: true,
  });
  const payload = buildExecConfigPayload(execEdits, loaded);
  assert.deepEqual(payload.writable_subdirs, [".report_state"]);
  assert.equal(payload.image, "ragent-skill-fund:latest");
  assert.equal(payload.timeout_sec, 300);
  assert.equal(payload.needs_network, true);
});

test("buildExecConfigPayload 编辑其它字段不影响透传的 writable_subdirs", () => {
  const loaded = parseExecConfig({
    image: "old:1",
    writable_subdirs: [".report_state", "out/cache"],
  });
  const payload = buildExecConfigPayload(
    { ...execEdits, image: "new:2", timeout_sec: 60, needs_network: false },
    loaded
  );
  assert.deepEqual(payload.writable_subdirs, [".report_state", "out/cache"]);
  assert.equal(payload.image, "new:2");
  assert.equal(payload.needs_network, false);
});

test("buildExecConfigPayload 首次配置（无现值）为空清单", () => {
  assert.deepEqual(buildExecConfigPayload(execEdits, null).writable_subdirs, []);
});

test("buildExecConfigPayload 表单未编辑内部产物时按现值透传", () => {
  // 与 writable_subdirs 同一个坑：后端全量覆盖，漏传等于把 CRP 的
  // ["**/findings.json"] 静默清空，中间产物又开始发链接给用户。
  const loaded = parseExecConfig({
    image: "ragent-skill-crp:latest",
    artifact_exclude: ["**/findings.json"],
  });
  const payload = buildExecConfigPayload(execEdits, loaded);
  assert.deepEqual(payload.artifact_exclude, ["**/findings.json"]);
});

test("buildExecConfigPayload 表单显式给了内部产物就用表单的", () => {
  const loaded = parseExecConfig({
    image: "x:1",
    artifact_exclude: ["**/old.json"],
  });
  const payload = buildExecConfigPayload(
    { ...execEdits, artifact_exclude: ["**/findings.json"] },
    loaded
  );
  assert.deepEqual(payload.artifact_exclude, ["**/findings.json"]);
});

test("buildExecConfigPayload 表单清空内部产物即真的清空", () => {
  // 空数组是"我要清掉"，不能被当成"没填"而回落现值——否则这项永远删不掉
  const loaded = parseExecConfig({ image: "x:1", artifact_exclude: ["**/a.json"] });
  const payload = buildExecConfigPayload({ ...execEdits, artifact_exclude: [] }, loaded);
  assert.deepEqual(payload.artifact_exclude, []);
});

test("diffExecConfig 标出内部产物声明的变化", () => {
  assert.deepEqual(
    diffExecConfig({ ...baseCfg, artifact_exclude: ["**/findings.json"] }, baseCfg),
    ["artifact_exclude"]
  );
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


test("validateAssetPath 放行根级 env 模板（前端曾漏这条例外）", () => {
  // 后端 validate_asset_path 有 is_env_template_path 放行，前端没有 →
  // 一个合法资产在界面上传不进去，报错还说它是"隐藏目录"（它是文件）。
  assert.equal(validateAssetPath(".env.example"), null);
  assert.equal(validateAssetPath(".env.template"), null);
});

test("validateAssetPath 只放行根级、只放行这两个名字", () => {
  // 与后端 is_env_template_path 同口径：子目录里的同名文件不算，真 .env 也不算
  assert.equal(validateAssetPath("scripts/.env.example"), "hiddenSegment");
  assert.equal(validateAssetPath(".env"), "hiddenSegment");
  assert.equal(validateAssetPath(".envrc"), "hiddenSegment");
  assert.equal(validateAssetPath(".git/config"), "hiddenSegment");
  assert.equal(validateAssetPath(".report_state/x.json"), "hiddenSegment");
});

test("isEnvTemplatePath 与后端 ENV_TEMPLATE_NAMES 对齐", () => {
  assert.equal(isEnvTemplatePath(".env.example"), true);
  assert.equal(isEnvTemplatePath(".env.template"), true);
  assert.equal(isEnvTemplatePath("sub/.env.example"), false);
});

// ── 沙箱镜像的 present 三态 ───────────────────────────────────────────────
//
// `sandbox_images` 是**允许清单不是库存清单**：登记了不代表宿主机上真有。
// 选了不存在的镜像，要到运行那一刻才以 docker 原文炸（exit 125 +
// pull access denied），而那句话会把人引向"权限/registry 配错了"。
//
// 三态不能压成两态：true=有；false=登记了但不存在；null=**docker 不可达**。
// 后两者混起来的话，后端没挂 docker.sock 时每一项都会显示"不存在"，
// 把人引去逐个重建镜像 —— 而该做的是查 socket。

test("present=true 原样保留", () => {
  const [img] = parseSandboxImages({ items: [{ name: "python", tag: "3.11-slim", present: true }] });
  assert.equal(img.present, true);
});

test("present=false 原样保留", () => {
  const [img] = parseSandboxImages({ items: [{ name: "a", tag: "1", present: false }] });
  assert.equal(img.present, false);
});

test("字段缺失（老后端）归为 null，不是 false", () => {
  // 老后端不返回这个字段。当成 false 会让所有镜像都显示"本机没有"，
  // 那是凭空造出来的告警。
  const [img] = parseSandboxImages({ items: [{ name: "a", tag: "1" }] });
  assert.equal(img.present, null);
});

test("present=null（docker 不可达）保持 null", () => {
  const [img] = parseSandboxImages({ items: [{ name: "a", tag: "1", present: null }] });
  assert.equal(img.present, null);
});

test("非布尔值一律归 null，不做真值转换", () => {
  // "false" / 0 / "" 这类值若按真值转换，会得到与后端语义相反的结论
  for (const bogus of ["true", "false", 0, 1, "", "yes"]) {
    const [img] = parseSandboxImages({ items: [{ name: "a", tag: "1", present: bogus }] });
    assert.equal(img.present, null, `present=${JSON.stringify(bogus)} 应归 null`);
  }
});


// ── writable_subdirs 现在可以在表单里编辑（2026-08-23）──
//
// 此前它只能改库：API 支持、diff 里会显示，却没有输入框。结果是全平台只有
// 1 个 skill 用了它 —— 不是没人需要跨对话持久化，是没有入口。

test("buildExecConfigPayload：edits 给了 writable_subdirs 就用它", () => {
  const loaded = parseExecConfig({
    stage: "draft",
    image: "ragent-skill-general:latest",
    timeout_sec: 120,
    writable_subdirs: [".report_state"],
    needs_network: true,
  });
  const payload = buildExecConfigPayload(
    { ...execEdits, writable_subdirs: [".lark"] },
    loaded
  );
  assert.deepEqual(payload.writable_subdirs, [".lark"], "表单的值应当覆盖服务端现值");
});

test("buildExecConfigPayload：edits 显式给空数组 = 真的清空", () => {
  // 用户在表单里把内容删干净，意思就是"不要持久目录了"。
  // 若这里回退成 loaded，删不掉 —— 表单看起来生效了，保存后又变回来。
  const loaded = parseExecConfig({
    stage: "draft",
    image: "ragent-skill-general:latest",
    timeout_sec: 120,
    writable_subdirs: [".lark"],
    needs_network: true,
  });
  const payload = buildExecConfigPayload({ ...execEdits, writable_subdirs: [] }, loaded);
  assert.deepEqual(payload.writable_subdirs, [], "显式空数组必须落成空，不能回退成现值");
});

test("buildExecConfigPayload：loaded 为 null 且 edits 未给 → 空清单", () => {
  // 把一个非可执行 skill 首次配成可执行：此时确实没有任何现值。
  const payload = buildExecConfigPayload(execEdits, null);
  assert.deepEqual(payload.writable_subdirs, []);
  assert.deepEqual(payload.artifact_exclude, []);
});

test("buildExecConfigPayload：两个列表字段互不干扰", () => {
  // 它们在表单里并排放，容易在改一个时把另一个漏掉 —— 后端是全量覆盖，
  // 漏了就是静默清空（CRP 的 **/findings.json 会重新发链接给用户）。
  const loaded = parseExecConfig({
    stage: "draft",
    image: "ragent-skill-docs:latest",
    timeout_sec: 120,
    writable_subdirs: [".lark"],
    artifact_exclude: ["**/findings.json"],
    needs_network: false,
  });
  const onlyWritable = buildExecConfigPayload(
    { ...execEdits, writable_subdirs: [".other"] },
    loaded
  );
  assert.deepEqual(onlyWritable.writable_subdirs, [".other"]);
  assert.deepEqual(
    onlyWritable.artifact_exclude,
    ["**/findings.json"],
    "只改可写目录时，内部产物不该被清空"
  );

  const onlyArtifact = buildExecConfigPayload(
    { ...execEdits, artifact_exclude: ["**/tmp.json"] },
    loaded
  );
  assert.deepEqual(onlyArtifact.artifact_exclude, ["**/tmp.json"]);
  assert.deepEqual(
    onlyArtifact.writable_subdirs,
    [".lark"],
    "只改内部产物时，可写目录不该被清空"
  );
});
