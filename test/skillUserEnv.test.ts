import assert from "node:assert/strict";
import { test } from "node:test";
import {
  isSecretEnvKey,
  MAX_ENV_KEYS,
  MAX_ENV_VALUE_LENGTH,
  buildEnvPayload,
  buildEnvRows,
  envPayloadBytes,
  hasEnvChanges,
  isReservedEnvKey,
  newEnvRow,
  parseUserEnv,
  parseUserEnvMeta,
  summarizeEnvConfig,
  validateEnvKey,
  validateEnvRows,
  validateEnvValue,
} from "../lib/skillUserEnv.ts";
import type { EnvRow } from "../lib/skillUserEnv.ts";

// --------------------------------------------------------------------------
// SKILL_ 前缀（平台保留名）——前端先挡，后端还有 422 兜底
// --------------------------------------------------------------------------

test("isReservedEnvKey 挡住 SKILL_ 前缀，大小写不敏感（后端用 key.upper()）", () => {
  assert.equal(isReservedEnvKey("SKILL_WORK_DIR"), true);
  assert.equal(isReservedEnvKey("SKILL_"), true);
  assert.equal(isReservedEnvKey("skill_work_dir"), true);
  assert.equal(isReservedEnvKey("Skill_Anything"), true);
});

test("isReservedEnvKey 不误伤仅前缀相似的名字", () => {
  for (const key of ["SKILLS_TOKEN", "SKILL", "MY_SKILL_KEY", "OPENAI_API_KEY"]) {
    assert.equal(isReservedEnvKey(key), false, key);
  }
});

// OPENAI_* 随迁移 040 起不再由平台注入，用户可自由配置
test("validateEnvKey 放行 OPENAI_*（平台不再注入，不是保留名）", () => {
  assert.equal(validateEnvKey("OPENAI_API_KEY"), null);
  assert.equal(validateEnvKey("OPENAI_BASE_URL"), null);
});

test("validateEnvKey 保留名报 reserved 而非 invalid（文案要说清原因）", () => {
  assert.equal(validateEnvKey("SKILL_WORK_DIR"), "reserved");
  assert.equal(validateEnvKey("  SKILL_X  "), "reserved");
});

test("validateEnvKey 镜像后端 ENV_KEY_RE", () => {
  assert.equal(validateEnvKey("QCC_TOKEN"), null);
  assert.equal(validateEnvKey("_private"), null);
  assert.equal(validateEnvKey("a1"), null);
  assert.equal(validateEnvKey(""), "empty");
  assert.equal(validateEnvKey("   "), "empty");
  assert.equal(validateEnvKey("1ABC"), "invalid");
  assert.equal(validateEnvKey("MY-KEY"), "invalid");
  assert.equal(validateEnvKey("MY KEY"), "invalid");
  assert.equal(validateEnvKey("KEY="), "invalid");
  assert.equal(validateEnvKey("键名"), "invalid");
  assert.equal(validateEnvKey("A".repeat(129)), "tooLong");
});

test("validateEnvValue 只挡 NUL 与超长；空格与中文合法", () => {
  assert.equal(validateEnvValue(""), null);
  assert.equal(validateEnvValue("  尾随空格是凭据的一部分 "), null);
  assert.equal(validateEnvValue("a\u0000b"), "nul");
  assert.equal(validateEnvValue("x".repeat(MAX_ENV_VALUE_LENGTH)), null);
  assert.equal(validateEnvValue("x".repeat(MAX_ENV_VALUE_LENGTH + 1)), "tooLong");
});

// --------------------------------------------------------------------------
// meta：configurable=false 时调用方整块不渲染
// --------------------------------------------------------------------------

test("parseUserEnvMeta configurable=false 时不给渲染依据（无模板的 skill 无入口）", () => {
  const meta = parseUserEnvMeta({
    skill_id: 6,
    user_id: 1,
    configurable: false,
    template_path: null,
    template_stage: null,
    declared_keys: [],
    configured_keys: [],
  });
  assert.equal(meta.configurable, false);
  assert.equal(meta.template_path, null);
  assert.deepEqual(meta.declared_keys, []);
});

test("parseUserEnvMeta 端点不可用 / 坏响应一律降级为不可配置", () => {
  for (const bad of [null, undefined, {}, "nope", [], { configurable: true }]) {
    assert.equal(parseUserEnvMeta(bad).configurable, false, JSON.stringify(bad) ?? "undefined");
  }
});

test("parseUserEnvMeta 完整形状（configurable 需 template_path 同时成立）", () => {
  const meta = parseUserEnvMeta({
    skill_id: 10,
    user_id: 1,
    configurable: true,
    template_path: ".env.example",
    template_stage: "published",
    declared_keys: ["MY_TEST_KEY", "OPTIONAL_URL"],
    configured_keys: ["MY_TEST_KEY"],
  });
  assert.equal(meta.configurable, true);
  assert.equal(meta.template_path, ".env.example");
  assert.equal(meta.template_stage, "published");
  assert.deepEqual(meta.declared_keys, ["MY_TEST_KEY", "OPTIONAL_URL"]);
  assert.deepEqual(meta.configured_keys, ["MY_TEST_KEY"]);
});

test("parseUserEnvMeta 响应里绝不该有值——解析结果不含任何值字段", () => {
  const meta = parseUserEnvMeta({
    configurable: true,
    template_path: ".env.template",
    declared_keys: ["K"],
    configured_keys: ["K"],
    env: { K: "leaked" },
  }) as unknown as Record<string, unknown>;
  assert.equal("env" in meta, false);
  assert.equal(JSON.stringify(meta).includes("leaked"), false);
});

test("parseUserEnv 容错解包（非字符串值丢弃，缺字段降级为空）", () => {
  const parsed = parseUserEnv({
    skill_id: 10,
    user_id: 1,
    env: { MY_TEST_KEY: "hello", BAD: 42, "  SPACED  ": "v" },
    declared_keys: ["MY_TEST_KEY", 7],
    updated_at: "2026-07-29T00:00:00Z",
  });
  assert.deepEqual(parsed.env, { MY_TEST_KEY: "hello", SPACED: "v" });
  assert.deepEqual(parsed.declared_keys, ["MY_TEST_KEY"]);
  assert.equal(parsed.updated_at, "2026-07-29T00:00:00Z");
  assert.deepEqual(parseUserEnv(null), { env: {}, declared_keys: [], updated_at: null });
});

// --------------------------------------------------------------------------
// 表单行整形
// --------------------------------------------------------------------------

test("buildEnvRows 声明键按模板顺序在前，未配置的留空值", () => {
  const rows = buildEnvRows(["QCC_TOKEN", "QCC_BASE_URL"], { QCC_TOKEN: "t" });
  assert.deepEqual(
    rows.map((r) => [r.key, r.value, r.declared]),
    [
      ["QCC_TOKEN", "t", true],
      ["QCC_BASE_URL", "", true],
    ]
  );
});

test("buildEnvRows 自定义键（模板未声明）排在声明键之后并标记为非声明", () => {
  const rows = buildEnvRows(["DECLARED"], { ZZZ: "3", AAA: "1", DECLARED: "d" });
  assert.deepEqual(
    rows.map((r) => [r.key, r.declared]),
    [
      ["DECLARED", true],
      ["AAA", false],
      ["ZZZ", false],
    ]
  );
});

test("buildEnvRows 行 id 唯一（React key 稳定，改键名不重建行）", () => {
  const rows = buildEnvRows(["A", "B"], { C: "1" });
  assert.equal(new Set(rows.map((r) => r.id)).size, 3);
  assert.equal(new Set([...rows, newEnvRow()].map((r) => r.id)).size, 4);
});

// --------------------------------------------------------------------------
// 全量替换语义（PUT 缺键即删）
// --------------------------------------------------------------------------

function rowsOf(...pairs: Array<[string, string]>): EnvRow[] {
  return pairs.map(([key, value]) => ({ ...newEnvRow(key, value) }));
}

test("buildEnvPayload 删掉一行就是删掉那个变量（PUT 全量替换）", () => {
  const loaded = { A: "1", B: "2" };
  const rows = buildEnvRows(["A", "B"], loaded).filter((r) => r.key !== "B");
  assert.deepEqual(buildEnvPayload(rows).env, { A: "1" });
});

test("buildEnvPayload 值清空等同于删除（不提交空值）", () => {
  const rows = buildEnvRows(["A", "B"], { A: "1", B: "2" }).map((r) =>
    r.key === "B" ? { ...r, value: "" } : r
  );
  assert.deepEqual(buildEnvPayload(rows).env, { A: "1" });
});

test("buildEnvPayload 全部清空提交 {}（后端据此清空整份配置）", () => {
  assert.deepEqual(buildEnvPayload([]).env, {});
  assert.deepEqual(buildEnvPayload(rowsOf(["A", ""], ["", "orphan"])).env, {});
});

test("buildEnvPayload 键名去首尾空白，值原样保留", () => {
  const payload = buildEnvPayload(rowsOf(["  TOKEN  ", " secret "]));
  assert.deepEqual(payload.env, { TOKEN: " secret " });
});

test("hasEnvChanges 只在提交形状与服务端现值不同时为真", () => {
  const loaded = { A: "1", B: "2" };
  const rows = buildEnvRows(["A", "B"], loaded);
  assert.equal(hasEnvChanges(rows, loaded), false);
  assert.equal(
    hasEnvChanges(
      rows.map((r) => (r.key === "A" ? { ...r, value: "9" } : r)),
      loaded
    ),
    true
  );
  assert.equal(
    hasEnvChanges(
      rows.filter((r) => r.key !== "B"),
      loaded
    ),
    true
  );
  assert.equal(hasEnvChanges([...rows, newEnvRow("C", "3")], loaded), true);
  // 只添了一个空行不算改动（它不会进请求体）
  assert.equal(hasEnvChanges([...rows, newEnvRow()], loaded), false);
});

// --------------------------------------------------------------------------
// 整表校验
// --------------------------------------------------------------------------

test("validateEnvRows 标出保留名并阻止保存", () => {
  const rows = rowsOf(["OK_KEY", "v"], ["SKILL_WORK_DIR", "/evil"]);
  const result = validateEnvRows(rows);
  assert.equal(result.valid, false);
  assert.equal(result.keyErrors[rows[1].id], "reserved");
  assert.equal(rows[0].id in result.keyErrors, false);
});

test("validateEnvRows 重复键名两行都标 duplicate", () => {
  const rows = rowsOf(["DUP", "1"], ["DUP", "2"]);
  const result = validateEnvRows(rows);
  assert.equal(result.keyErrors[rows[0].id], "duplicate");
  assert.equal(result.keyErrors[rows[1].id], "duplicate");
});

test("validateEnvRows 非法键名优先于重复（先说清名字本身不合法）", () => {
  const rows = rowsOf(["1BAD", "a"], ["1BAD", "b"]);
  const result = validateEnvRows(rows);
  assert.equal(result.keyErrors[rows[0].id], "invalid");
  assert.equal(result.keyErrors[rows[1].id], "invalid");
});

test("validateEnvRows 空键名的行不算错（还没填的声明键，提交时被丢掉）", () => {
  const rows = buildEnvRows(["A", "B"], { A: "1" });
  const result = validateEnvRows(rows);
  assert.equal(result.valid, true);
  assert.deepEqual(result.keyErrors, {});
});

test("validateEnvRows 项数与总体积上限（后端 50 项 / 64KB）", () => {
  const many = rowsOf(
    ...Array.from({ length: MAX_ENV_KEYS + 1 }, (_, i): [string, string] => [`K${i}`, "v"])
  );
  assert.equal(validateEnvRows(many).formError, "tooManyKeys");

  const big = rowsOf(["A", "x".repeat(8192)], ["B", "y".repeat(8192)]);
  assert.equal(validateEnvRows(big).formError, null);
  const tooBig = rowsOf(
    ...Array.from({ length: 9 }, (_, i): [string, string] => [`K${i}`, "x".repeat(8192)])
  );
  assert.equal(validateEnvRows(tooBig).formError, "tooLarge");
});

test("envPayloadBytes 按 UTF-8 计（中文值 3 字节/字）", () => {
  assert.equal(envPayloadBytes({ A: "b" }), 2);
  assert.equal(envPayloadBytes({ A: "中" }), 4);
  assert.equal(envPayloadBytes({}), 0);
});

// --------------------------------------------------------------------------
// meta 汇总（管理员视角只看得到计数与键名）
// --------------------------------------------------------------------------

test("summarizeEnvConfig 给出「已配置 N/M 项」所需的计数与缺口", () => {
  const summary = summarizeEnvConfig({
    configurable: true,
    template_path: ".env.example",
    template_stage: "published",
    declared_keys: ["A", "B", "C"],
    configured_keys: ["A", "EXTRA"],
  });
  assert.equal(summary.declaredCount, 3);
  assert.equal(summary.configuredCount, 2);
  assert.deepEqual(summary.missingKeys, ["B", "C"]);
  assert.deepEqual(summary.extraKeys, ["EXTRA"]);
});

test("summarizeEnvConfig 未配置任何键时缺口 = 全部声明键", () => {
  const summary = summarizeEnvConfig({
    configurable: true,
    template_path: ".env.template",
    template_stage: "draft",
    declared_keys: ["A", "B"],
    configured_keys: [],
  });
  assert.equal(summary.configuredCount, 0);
  assert.deepEqual(summary.missingKeys, ["A", "B"]);
  assert.deepEqual(summary.extraKeys, []);
});


test("isSecretEnvKey 遮住凭据类", () => {
  for (const k of [
    "DeepSeek_ApiKey", "OPENAI_API_KEY", "ChatGPT_ApiKey",
    "BZZ_COOKIE", "GITHUB_TOKEN", "DB_PASSWORD", "my_secret", "PRIVATE_PEM",
  ]) {
    assert.equal(isSecretEnvKey(k), true, k);
  }
});

test("isSecretEnvKey 不遮配置类", () => {
  // 把模型名/地址遮成一排圆点没有安全收益，只让人看不清自己填了什么
  for (const k of [
    "Providers", "DeepSeek_BaseURL", "DeepSeek_Deployment",
    "ChatGPT_ApiVersion", "REGION", "TIMEOUT_SEC", "ENDPOINT",
  ]) {
    assert.equal(isSecretEnvKey(k), false, k);
  }
});

test("isSecretEnvKey 大小写无关且容忍空值", () => {
  assert.equal(isSecretEnvKey("apikey"), true);
  assert.equal(isSecretEnvKey("APIKEY"), true);
  assert.equal(isSecretEnvKey(""), false);
});
