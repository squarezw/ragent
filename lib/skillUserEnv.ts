/**
 * 个人环境变量（skill → env → user）的纯数据整形与校验。
 *
 * 与后端 app/services/skill_user_env.py 逐条对齐；**值只在内存与请求体里流动**，
 * 本模块不做任何日志/埋点，调用方也不得把值写进 console。
 *
 * 语义要点（决定了 UI 怎么说话）：
 * - PUT 是**全量替换**：请求体里没有的键就是删除，`{}` 就是清空。
 * - `declared_keys` 来自库内 `.env.example` / `.env.template`，是"这个 skill 会读
 *   哪些变量"的提示，**不是白名单**——用户可以自己加键。
 * - `SKILL_*` 前缀是平台保留名，前端先挡（后端也会 422，detail 已是中文）。
 */

import type { SkillUserEnv, SkillUserEnvMeta, SkillUserEnvPayload } from "@/types/skill";

/** 平台保留前缀（后端 RESERVED_ENV_PREFIX） */
export const RESERVED_ENV_PREFIX = "SKILL_";

/** POSIX 环境变量名（后端 ENV_KEY_RE） */
const ENV_KEY_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;

export const MAX_ENV_KEYS = 50;
export const MAX_ENV_KEY_LENGTH = 128;
export const MAX_ENV_VALUE_LENGTH = 8192;
export const MAX_ENV_TOTAL_BYTES = 64 * 1024;

/**
 * 平台保留名判定（后端 is_reserved_env_key 的镜像，大小写不敏感——
 * 后端用 key.upper()，`skill_work_dir` 同样被拒）。
 */
/**
 * 名字里出现这些词，就当作凭据，默认打码。
 *
 * 全部小写后做子串匹配。宁可多遮几个（用户点眼睛就能看），也不要漏遮一个真凭据。
 * 反过来 BaseURL / Deployment / ApiVersion / Providers 这类不含这些词，照常明文
 * ——把一个模型名遮成一排圆点没有任何安全收益，只是让人看不清自己填了什么。
 */
const SECRET_KEY_HINTS = [
  "key",        // ApiKey / API_KEY / SECRET_KEY
  "secret",
  "token",
  "password",
  "passwd",
  "pwd",
  "credential",
  "cookie",     // 招标 skill 的 BZZ_COOKIE 是登录态，等同凭据
  "signature",
  "private",
] as const;

/** 这个变量该不该默认打码。眼睛按钮对所有行都可用，这只决定初始状态。 */
export function isSecretEnvKey(key: string): boolean {
  const lower = (key || "").toLowerCase();
  return SECRET_KEY_HINTS.some((hint) => lower.includes(hint));
}

export function isReservedEnvKey(key: string): boolean {
  return typeof key === "string" && key.toUpperCase().startsWith(RESERVED_ENV_PREFIX);
}

/** 键名校验失败原因（i18n key 后缀），合法返回 null */
export type EnvKeyError = "empty" | "tooLong" | "invalid" | "reserved" | "duplicate";

/** 值校验失败原因，合法返回 null */
export type EnvValueError = "tooLong" | "nul";

/** 单个键名校验（不含重复判定——那要看整张表，见 validateEnvRows） */
export function validateEnvKey(key: string): EnvKeyError | null {
  const value = (key ?? "").trim();
  if (!value) return "empty";
  if (value.length > MAX_ENV_KEY_LENGTH) return "tooLong";
  if (!ENV_KEY_RE.test(value)) return "invalid";
  if (isReservedEnvKey(value)) return "reserved";
  return null;
}

/** 单个值校验；值原样不 strip（尾随空格可能是凭据的一部分） */
export function validateEnvValue(value: string): EnvValueError | null {
  if (typeof value !== "string") return null;
  if (value.includes("\u0000")) return "nul";
  if (value.length > MAX_ENV_VALUE_LENGTH) return "tooLong";
  return null;
}

/** 错误码 → skills 命名空间的 i18n key（next-intl 的 key 是字面量联合，不能拼字符串） */
export const ENV_KEY_ERROR_MESSAGE_KEY = {
  empty: "envKeyErrorEmpty",
  tooLong: "envKeyErrorTooLong",
  invalid: "envKeyErrorInvalid",
  reserved: "envKeyErrorReserved",
  duplicate: "envKeyErrorDuplicate",
} as const satisfies Record<EnvKeyError, string>;

export const ENV_VALUE_ERROR_MESSAGE_KEY = {
  tooLong: "envValueErrorTooLong",
  nul: "envValueErrorNul",
} as const satisfies Record<EnvValueError, string>;

function asString(v: unknown): string | null {
  return typeof v === "string" ? v : null;
}

function asStringList(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((s): s is string => typeof s === "string") : [];
}

/** {key: value} 容错归一：非字符串值丢弃（后端只存字符串），键去首尾空白 */
function asEnvMap(v: unknown): Record<string, string> {
  if (typeof v !== "object" || v === null || Array.isArray(v)) return {};
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(v as Record<string, unknown>)) {
    const name = key.trim();
    if (name && typeof value === "string") out[name] = value;
  }
  return out;
}

/** GET|PUT /api/v1/skills/{id}/user-env 响应容错解包（**含值，仅属主拿得到**） */
export function parseUserEnv(data: unknown): SkillUserEnv {
  const obj = (data ?? {}) as Record<string, unknown>;
  return {
    env: asEnvMap(obj.env),
    declared_keys: asStringList(obj.declared_keys),
    updated_at: asString(obj.updated_at),
  };
}

/**
 * GET /api/v1/skills/{id}/user-env/meta 响应容错解包（**永不含值**）。
 *
 * 解析不出来（端点缺失 / 403 / 坏响应）时 configurable 为 false，
 * 调用方据此整块不渲染——没有 env 模板的 skill 不该出现这个入口。
 */
export function parseUserEnvMeta(data: unknown): SkillUserEnvMeta {
  const obj = (data ?? {}) as Record<string, unknown>;
  const templatePath = asString(obj.template_path);
  return {
    // template_path 是 configurable 的真源：后端 configurable=bool(path)
    configurable: obj.configurable === true && Boolean(templatePath),
    template_path: templatePath,
    template_stage: asString(obj.template_stage),
    declared_keys: asStringList(obj.declared_keys),
    configured_keys: asStringList(obj.configured_keys),
  };
}

/** 表单一行；declared = 来自模板声明（不可改名），否则是用户自定义键 */
export interface EnvRow {
  /** 行标识，随行不随键名——改键名不该让 React 丢掉输入焦点 */
  id: string;
  key: string;
  value: string;
  declared: boolean;
}

let envRowSeq = 0;
function nextRowId(): string {
  envRowSeq += 1;
  return `env-${envRowSeq}`;
}

/** 新建一行自定义键（UI「添加变量」按钮用） */
export function newEnvRow(key = "", value = ""): EnvRow {
  return { id: nextRowId(), key, value, declared: false };
}

/**
 * 已存 env + 模板声明键 → 表单行。
 * 声明键按模板顺序在前（未配置的留空值），用户自己加的键按字典序在后。
 */
export function buildEnvRows(
  declaredKeys: readonly string[],
  env: Readonly<Record<string, string>>
): EnvRow[] {
  const seen = new Set<string>();
  const rows: EnvRow[] = [];
  for (const key of declaredKeys) {
    if (seen.has(key)) continue;
    seen.add(key);
    rows.push({ id: nextRowId(), key, value: env[key] ?? "", declared: true });
  }
  for (const key of Object.keys(env).sort()) {
    if (seen.has(key)) continue;
    seen.add(key);
    rows.push({ id: nextRowId(), key, value: env[key], declared: false });
  }
  return rows;
}

/** 逐行校验结果：行 id → 错误码；另给整表级错误 */
export interface EnvRowsValidation {
  keyErrors: Record<string, EnvKeyError>;
  valueErrors: Record<string, EnvValueError>;
  /** 整表超限（项数 / 总体积），null = 无 */
  formError: "tooManyKeys" | "tooLarge" | null;
  valid: boolean;
}

/**
 * 整表校验。空键名的行**不算错**——它是"还没填的声明键"，提交时会被丢掉；
 * 只有填了名字才校验合法性。重复键名两行都标。
 */
export function validateEnvRows(rows: readonly EnvRow[]): EnvRowsValidation {
  const keyErrors: Record<string, EnvKeyError> = {};
  const valueErrors: Record<string, EnvValueError> = {};
  const byKey = new Map<string, string[]>();

  for (const row of rows) {
    const key = row.key.trim();
    if (key) {
      const error = validateEnvKey(key);
      if (error) keyErrors[row.id] = error;
      const bucket = byKey.get(key);
      if (bucket) bucket.push(row.id);
      else byKey.set(key, [row.id]);
    }
    const valueError = validateEnvValue(row.value);
    if (valueError) valueErrors[row.id] = valueError;
  }
  for (const ids of byKey.values()) {
    if (ids.length > 1) {
      for (const id of ids) keyErrors[id] = keyErrors[id] ?? "duplicate";
    }
  }

  const submitted = buildEnvPayload(rows).env;
  const count = Object.keys(submitted).length;
  let formError: EnvRowsValidation["formError"] = null;
  if (count > MAX_ENV_KEYS) formError = "tooManyKeys";
  else if (envPayloadBytes(submitted) > MAX_ENV_TOTAL_BYTES) formError = "tooLarge";

  return {
    keyErrors,
    valueErrors,
    formError,
    valid:
      Object.keys(keyErrors).length === 0 &&
      Object.keys(valueErrors).length === 0 &&
      formError === null,
  };
}

/** 整份 env 的 UTF-8 字节数（后端 MAX_ENV_TOTAL_BYTES 口径：键+值） */
export function envPayloadBytes(env: Readonly<Record<string, string>>): number {
  let total = 0;
  for (const [key, value] of Object.entries(env)) {
    total += new TextEncoder().encode(key + value).length;
  }
  return total;
}

/**
 * 表单行 → PUT 请求体。**这是全量替换的落点**：
 * 只有"键名非空且值非空"的行进请求体，因此
 * - 删掉一行 = 那个变量被删除；
 * - 把某行的值清空 = 同样是删除（"配了一个空值"与"没配"对使用者没有区别，
 *   而后者能让 configured_keys 与「已配置 N/M」如实反映现状）。
 * 重复键名后者覆盖前者（校验已标红，这里只保证形状合法）。
 */
export function buildEnvPayload(rows: readonly EnvRow[]): SkillUserEnvPayload {
  const env: Record<string, string> = {};
  for (const row of rows) {
    const key = row.key.trim();
    if (!key || row.value === "") continue;
    env[key] = row.value;
  }
  return { env };
}

/** 表单是否有未保存改动（键集合或任一值与服务端现值不同） */
export function hasEnvChanges(
  rows: readonly EnvRow[],
  loaded: Readonly<Record<string, string>>
): boolean {
  const next = buildEnvPayload(rows).env;
  const nextKeys = Object.keys(next);
  const loadedKeys = Object.keys(loaded);
  if (nextKeys.length !== loadedKeys.length) return true;
  return nextKeys.some((key) => loaded[key] !== next[key]);
}

export interface EnvConfigSummary {
  declaredCount: number;
  /** 已配置的键数（**只是计数，永不含值**——管理员视角也只看这个） */
  configuredCount: number;
  /** 模板声明了但该用户还没配的键名 */
  missingKeys: string[];
  /** 用户自己加的、模板没声明的键名 */
  extraKeys: string[];
}

/**
 * meta 汇总，供「已配置 3/5 项」这类展示。
 * 用 meta 而非 env 是刻意的：meta 不含值，所以同一段展示逻辑对
 * 「看自己」与「管理员看别人配了哪些键」都成立。
 */
export function summarizeEnvConfig(meta: SkillUserEnvMeta): EnvConfigSummary {
  const declared = meta.declared_keys;
  const configured = new Set(meta.configured_keys);
  const declaredSet = new Set(declared);
  return {
    declaredCount: declared.length,
    configuredCount: meta.configured_keys.length,
    missingKeys: declared.filter((key) => !configured.has(key)),
    extraKeys: meta.configured_keys.filter((key) => !declaredSet.has(key)),
  };
}
