// P8a 可执行 skill 资产清单数据整形（纯函数，SkillDiffDialog / 页面共用，可单测）

import type {
  SkillAssetChange,
  SkillAssetDiffItem,
  SkillDiff,
  SkillExecConfigSummary,
} from "@/types/review";
import type {
  SandboxImage,
  SkillAssetItem,
  SkillAssetKind,
  SkillAssetList,
  SkillExecConfig,
  SkillExecConfigPayload,
} from "@/types/skill";

const KNOWN_CHANGES: ReadonlySet<string> = new Set(["added", "removed", "modified", "unchanged"]);

function asString(v: unknown): string | null {
  return typeof v === "string" ? v : null;
}

function asSize(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : null;
}

/** 单条资产对照容错归一化；path 缺失视为坏行返回 null */
function toAssetDiffItem(value: unknown): SkillAssetDiffItem | null {
  if (typeof value !== "object" || value === null) return null;
  const obj = value as Record<string, unknown>;
  const path = asString(obj.path);
  if (!path) return null;
  const rawChange = asString(obj.change) ?? "";
  // 未知 change 按 modified 保守标注（宁可提醒审核人多看一眼）
  const change: SkillAssetChange = KNOWN_CHANGES.has(rawChange)
    ? (rawChange as SkillAssetChange)
    : "modified";
  return {
    path,
    kind: asString(obj.kind) ?? "asset",
    change,
    draft_sha256: asString(obj.draft_sha256),
    published_sha256: asString(obj.published_sha256),
    draft_size: asSize(obj.draft_size),
    published_size: asSize(obj.published_size),
    draft_text: asString(obj.draft_text),
    published_text: asString(obj.published_text),
  };
}

/** assets 数组容错归一化：非数组 → []，坏行剔除 */
export function normalizeAssetDiff(value: unknown): SkillAssetDiffItem[] {
  if (!Array.isArray(value)) return [];
  return value.map(toAssetDiffItem).filter((item): item is SkillAssetDiffItem => item !== null);
}

/** exec 配置容错归一化：image 缺失视为无配置（沙箱镜像是可执行 skill 的唯一必填项） */
export function normalizeExecConfig(value: unknown): SkillExecConfigSummary | null {
  if (typeof value !== "object" || value === null) return null;
  const obj = value as Record<string, unknown>;
  const image = asString(obj.image);
  if (!image) return null;
  return {
    stage: asString(obj.stage) ?? "draft",
    image,
    image_enabled: obj.image_enabled !== false,
    timeout_sec: asSize(obj.timeout_sec) ?? 120,
    writable_subdirs: Array.isArray(obj.writable_subdirs)
      ? obj.writable_subdirs.filter((s): s is string => typeof s === "string")
      : [],
    needs_network: obj.needs_network === true,
    warm_pool: obj.warm_pool === true,
    artifact_exclude: Array.isArray(obj.artifact_exclude)
      ? obj.artifact_exclude.filter((s): s is string => typeof s === "string")
      : [],
    updated_at: asString(obj.updated_at),
  };
}

/**
 * GET /api/v1/skills/{id}/diff 响应整体容错解包。
 * 旧后端（P8a 之前）无 assets/exec_config_* 字段时降级为空清单/null。
 */
export function parseSkillDiff(data: unknown): SkillDiff {
  const obj = (data ?? {}) as Record<string, unknown>;
  return {
    draft: asString(obj.draft) ?? "",
    published: asString(obj.published),
    assets: normalizeAssetDiff(obj.assets),
    exec_config_draft: normalizeExecConfig(obj.exec_config_draft),
    exec_config_published: normalizeExecConfig(obj.exec_config_published),
  };
}

export interface AssetDiffSummary {
  /** draft stage 文件数（removed 行不算在草稿清单内） */
  total: number;
  /** draft stage 合计字节数 */
  totalBytes: number;
  added: number;
  removed: number;
  modified: number;
  /** 是否存在任何 draft vs published 差异 */
  hasChanges: boolean;
}

/** 资产对照汇总：草稿清单规模 + 变更计数 */
export function summarizeAssetDiff(items: SkillAssetDiffItem[]): AssetDiffSummary {
  let total = 0;
  let totalBytes = 0;
  let added = 0;
  let removed = 0;
  let modified = 0;
  for (const item of items) {
    if (item.change !== "removed") {
      total += 1;
      totalBytes += item.draft_size ?? 0;
    }
    if (item.change === "added") added += 1;
    else if (item.change === "removed") removed += 1;
    else if (item.change === "modified") modified += 1;
  }
  return {
    total,
    totalBytes,
    added,
    removed,
    modified,
    hasChanges: added + removed + modified > 0,
  };
}

/** exec 配置 diff 视图要标注的字段 */
export type ExecConfigField =
  | "image"
  | "timeout_sec"
  | "writable_subdirs"
  | "needs_network"
  | "warm_pool"
  | "artifact_exclude";

/**
 * draft vs published exec 配置逐字段对比，返回有差异的字段名。
 * 任一侧缺失（从未发布 / 配置被移除）返回 []——整块本身就是新增/移除，不逐字段标。
 */
export function diffExecConfig(
  draft: SkillExecConfigSummary | null,
  published: SkillExecConfigSummary | null
): ExecConfigField[] {
  if (!draft || !published) return [];
  const changed: ExecConfigField[] = [];
  if (draft.image !== published.image) changed.push("image");
  if (draft.timeout_sec !== published.timeout_sec) changed.push("timeout_sec");
  if (draft.writable_subdirs.join("\n") !== published.writable_subdirs.join("\n")) {
    changed.push("writable_subdirs");
  }
  if (draft.needs_network !== published.needs_network) changed.push("needs_network");
  if (draft.warm_pool !== published.warm_pool) changed.push("warm_pool");
  // 这项决定用户能拿到哪些产物，发布前必须看得见它变了
  if (draft.artifact_exclude.join("\n") !== published.artifact_exclude.join("\n")) {
    changed.push("artifact_exclude");
  }
  return changed;
}

// ---------------------------------------------------------------------------
// P8 资产管理（上传 / 删除 / exec 配置）——与后端 skills.py 资产端点逐条对齐
// ---------------------------------------------------------------------------

/** 单文件上限（后端 ASSET_MAX_BYTES） */
export const ASSET_MAX_FILE_BYTES = 20 * 1024 * 1024;
/** 单 skill 单 stage 合计上限（后端 SKILL_ASSETS_MAX_TOTAL_BYTES） */
export const ASSET_MAX_TOTAL_BYTES = 100 * 1024 * 1024;
/** 后端 MAX_ASSET_PATH_LENGTH */
export const ASSET_MAX_PATH_LENGTH = 500;

/**
 * 顶层目录 → kind 推断表。与后端 scripts/import_skill_assets.py 的 KIND_BY_TOP_DIR
 * 逐条对齐：**不含 references**——`references/` 下混着 .docx/.pdf 的真实数据表明
 * 目录名不足以定 kind，落到扩展名分流（见 inferAssetKind）。
 */
const TOP_DIR_KIND: Readonly<Record<string, SkillAssetKind>> = {
  scripts: "script",
  data: "data",
  assets: "asset",
};

/** 分组展示顺序：约定目录在前，其余目录字典序，根文件最后 */
const GROUP_ORDER = ["scripts", "data", "assets", "references"];

export const ASSET_KINDS: readonly SkillAssetKind[] = ["script", "reference", "asset", "data"];

/**
 * 路径规范化：去首尾空白、去掉 `./` 与前导 `/`、折叠重复 `/`、去尾部 `/`。
 * 拖拽/手填常见的写法差异在这里抹平，剩下的非法形态交给 validateAssetPath 报错。
 */
export function normalizeAssetPath(input: string): string {
  if (typeof input !== "string") return "";
  let path = input.trim();
  while (path.startsWith("./")) path = path.slice(2);
  path = path.replace(/\/+/g, "/").replace(/^\/+/, "").replace(/\/+$/, "");
  return path;
}

/** 路径校验失败原因（i18n key 后缀），合法返回 null */
export type AssetPathError =
  | "empty"
  | "tooLong"
  | "backslash"
  | "absolute"
  | "emptySegment"
  | "dotSegment"
  | "hiddenSegment";

/**
 * 根级 env 模板：per-user 环境变量的键名 schema 就从它们解析（迁移 041）。
 * 与后端 `app/services/skill_user_env.ENV_TEMPLATE_NAMES` 逐字对齐。
 */
export const ENV_TEMPLATE_NAMES: readonly string[] = [".env.example", ".env.template"];

/** 隐藏段规则的唯一例外：**根级**的这两个文件名（子目录里的同名文件不算） */
export function isEnvTemplatePath(path: string): boolean {
  return ENV_TEMPLATE_NAMES.includes(path);
}

/**
 * 镜像后端 validate_asset_path：拒绝空/超长/反斜杠或 NUL/绝对路径/空段/`.`|`..` 段/隐藏段。
 * 隐藏段（`.report_state` 之类）只能走 exec-config 的 writable_subdirs，不作为资产入库。
 *
 * **唯一例外是根级 `.env.example` / `.env.template`**。这条以前漏了：后端
 * `validate_asset_path` 有 `is_env_template_path` 放行，前端没有，于是一个合法资产
 * 在界面上传不进去，报错还说它是"隐藏目录"（它是文件）。CRP 的 `.env.example`
 * 本来就在库里——是导入脚本放进去的，从界面反而补不回来。
 */
export function validateAssetPath(path: string): AssetPathError | null {
  if (typeof path !== "string" || path.length === 0) return "empty";
  if (path.length > ASSET_MAX_PATH_LENGTH) return "tooLong";
  // 空格与中文合法（现有资产就有「（模版）新建元一期…docx」），只拒后端拒的反斜杠 / NUL
  if (path.includes("\\") || path.includes("\u0000")) return "backslash";
  if (path.startsWith("/")) return "absolute";
  if (isEnvTemplatePath(path)) return null;
  for (const part of path.split("/")) {
    if (!part) return "emptySegment";
    if (part === "." || part === "..") return "dotSegment";
    if (part.startsWith(".")) return "hiddenSegment";
  }
  return null;
}

/** 路径错误码 → skills 命名空间的 i18n key（next-intl 的 key 是字面量联合，不能拼字符串） */
export const PATH_ERROR_MESSAGE_KEY = {
  empty: "pathErrorEmpty",
  tooLong: "pathErrorTooLong",
  backslash: "pathErrorBackslash",
  absolute: "pathErrorAbsolute",
  emptySegment: "pathErrorEmptySegment",
  dotSegment: "pathErrorDotSegment",
  hiddenSegment: "pathErrorHiddenSegment",
} as const satisfies Record<AssetPathError, string>;

/** writable_subdirs 校验：相对路径、无 `..`，但允许隐藏段（持久状态目录惯例） */
export function validateWritableSubdir(input: string): AssetPathError | null {
  const value = normalizeAssetPath(input);
  if (!value) return "empty";
  if (value.length > ASSET_MAX_PATH_LENGTH) return "tooLong";
  for (const part of value.split("/")) {
    if (!part) return "emptySegment";
    if (part === "." || part === "..") return "dotSegment";
  }
  return null;
}

/**
 * 后端 skill_view.BINARY_EXTENSIONS 的镜像。**两处必须同值**：后端据此
 * 决定资产能否被 skill_view 解码、以及注入块 references footer 列不列它，
 * 前端据此标注可读性并提示 kind 选错——漂移会让界面说"可读"而实际读不到。
 */
export const BINARY_ASSET_EXTENSIONS: ReadonlySet<string> = new Set([
  ".doc",
  ".docx",
  ".xls",
  ".xlsx",
  ".ppt",
  ".pptx",
  ".pdf",
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".bmp",
  ".webp",
  ".ico",
  ".tif",
  ".tiff",
  ".zip",
  ".gz",
  ".tgz",
  ".bz2",
  ".xz",
  ".7z",
  ".rar",
  ".tar",
  ".whl",
  ".so",
  ".dylib",
  ".dll",
  ".exe",
  ".bin",
  ".pyc",
  ".pyd",
  ".woff",
  ".woff2",
  ".ttf",
  ".otf",
  ".eot",
  ".mp3",
  ".mp4",
  ".wav",
  ".avi",
  ".mov",
  ".mkv",
  ".flac",
  ".parquet",
  ".db",
  ".sqlite",
  ".npy",
  ".npz",
  ".pkl",
  ".jar",
  ".class",
]);

/** 后端 is_viewable_path 的镜像：扩展名不像二进制 = 模型有可能读得动 */
export function isViewableAssetPath(path: string): boolean {
  const normalized = normalizeAssetPath(path);
  const dot = normalized.lastIndexOf(".");
  const slash = normalized.lastIndexOf("/");
  if (dot <= 0 || dot < slash + 1) return true;
  return !BINARY_ASSET_EXTENSIONS.has(normalized.slice(dot).toLowerCase());
}

/** 交给 kkFileView 预览的类型：平台本来就有这个模块，不在前端自己造轮子 */
export const OFFICE_PREVIEW_EXTENSIONS: ReadonlySet<string> = new Set([
  ".doc",
  ".docx",
  ".xls",
  ".xlsx",
  ".ppt",
  ".pptx",
  ".pdf",
]);

export const IMAGE_PREVIEW_EXTENSIONS: ReadonlySet<string> = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".bmp",
  ".webp",
  ".svg",
]);

/** 路径的小写扩展名；无扩展名返回空串 */
export function assetExtname(path: string): string {
  const name = normalizeAssetPath(path).split("/").pop() || "";
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(dot).toLowerCase() : "";
}

/**
 * 这个资产能不能预览。
 *
 * 文本与代码直接读；office 与图片各自渲染。剩下的（.zip/.so/.pyc…）不给按钮——
 * 点开只有一屏乱码，那比没有按钮更让人困惑。
 *
 * 放在 lib 而不是组件里：Node 的类型剥离只处理 .ts，从 .tsx 导入跑不了测试，
 * 而这条判定正是需要拿真实资产清单去验的那种规则。
 */
export function isPreviewableAsset(path: string): boolean {
  const ext = assetExtname(path);
  if (!ext) return true; // 无扩展名的按文本试（LICENSE、Makefile 之类）
  if (OFFICE_PREVIEW_EXTENSIONS.has(ext) || IMAGE_PREVIEW_EXTENSIONS.has(ext)) return true;
  return !BINARY_ASSET_EXTENSIONS.has(ext);
}

/**
 * 按顶层目录推断 kind；references/、根文件与未知目录按扩展名分流
 * （文本 → reference，二进制 → asset），与后端 classify_kind 同口径。
 */
export function inferAssetKind(path: string): SkillAssetKind {
  const normalized = normalizeAssetPath(path);
  const slash = normalized.indexOf("/");
  const mapped = slash > 0 ? TOP_DIR_KIND[normalized.slice(0, slash).toLowerCase()] : undefined;
  if (mapped) return mapped;
  return isViewableAssetPath(normalized) ? "reference" : "asset";
}

/** 技能正文本体的固定路径。根目录的 SKILL.md 不是资产。 */
export const SKILL_MD_PATH = "SKILL.md";

/**
 * 这个路径是不是「技能正文」而非资产。
 *
 * 只认**根目录**的 SKILL.md：`references/SKILL.md` 是一份正当的参考文档。
 * 平台在两个地方已经定了这条约定 —— scripts/sync_builtin_skills.py 的
 * NOT_ASSETS，和后端 skill_import 导入时对 SKILL.md 的排除（正文进
 * skills.content）。而 isModelReadableAsset 也明确把根目录 SKILL.md 排除在
 * 模型可读资产之外（正文已全量注入），所以它作为资产存在纯属死重。
 */
export function isSkillBodyPath(path: string): boolean {
  return normalizeAssetPath(path) === SKILL_MD_PATH;
}

/**
 * 把待上传队列分成「正文」和「资产」两摊。
 *
 * 同一路径被加了两次时取**后加的那个**，与重复选文件时"后来的覆盖先前的"直觉一致。
 */
export function partitionStagedUploads<T extends { path: string }>(
  staged: readonly T[]
): { body: T | null; assets: T[] } {
  const assets: T[] = [];
  let body: T | null = null;
  for (const item of staged) {
    if (isSkillBodyPath(item.path)) body = item;
    else assets.push(item);
  }
  return { body, assets };
}

/**
 * 切出 SKILL.md 的正文（去掉 frontmatter）。
 *
 * **只做边界切分，不解析 frontmatter 里的值。** 值解析要处理折叠标量（`>-` `|`）、
 * 缩进续行、引号剥离、CRLF —— 那套规则在后端 skill_import.parse_skill_md 里，
 * 是唯一真源。在前端再实现一份，两边迟早对同一个 description 给出不同结果，
 * 而分叉的表现是"传上去的和显示的不一样"，很难往解析器上想。
 *
 * 所以 frontmatter 里的 description / name 一律**不应用**，UI 必须明说这件事，
 * 而不是默默只更新一半。
 *
 * 边界规则与后端逐字对齐：先统一换行，必须以 `---` 开头，再匹配闭合的 `---`。
 * 报错文案也照抄 —— 同一份文件在两个入口得到两种说法，用户会以为是两个问题。
 */
export function splitSkillMd(text: string): {
  body: string;
  hasFrontmatter: boolean;
  error: string | null;
} {
  // CRLF/CR 都规整成 LF：Windows 上生成的 SKILL.md 很常见，而它对
  // frontmatter 的边界匹配是致命的（后端踩过）。
  const normalized = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");

  if (!normalized.startsWith("---")) {
    return {
      body: "",
      hasFrontmatter: false,
      error: "SKILL.md 必须以 `---` 开头的 frontmatter 起始",
    };
  }

  const m = normalized.match(/^---[ \t]*\n([\s\S]*?)\n---[ \t]*\n?([\s\S]*)$/);
  if (!m) {
    return {
      body: "",
      hasFrontmatter: true,
      error: "SKILL.md 的 frontmatter 没有闭合的 `---`",
    };
  }

  return { body: m[2], hasFrontmatter: true, error: null };
}

/**
 * 选（或拖入）文件夹上传时，剥掉那层多余的顶层目录。
 *
 * 用户选 `drawing-tolerance-extractor-draft/` 是想传**它里面的东西** ——
 * scripts/、agents/、SKILL.md —— 而不是造一个同名目录把资产埋进去一层。
 * 这是批量覆盖的主要用法，与「导入 skill」同一个意图（后端
 * skill_import.strip_redundant_root）。
 *
 * 但判据不同：后端能靠「剥完必须出现根级 SKILL.md」兜底，而资产文件夹通常
 * 没有 SKILL.md，那个阀在这里用不上。这里的阀是**剥完必须仍有目录层级**：
 *
 *   drawing-.../scripts/a.py + drawing-.../SKILL.md
 *     → 剥 → scripts/a.py + SKILL.md          ✅ 仍有目录，剥
 *   scripts/a.py + scripts/b.py（用户直接选了 scripts 文件夹）
 *     → 剥 → a.py + b.py                       ❌ 只剩散文件，不剥
 *
 * 第二种必须不剥：kind 是按顶层目录推断的（TOP_DIR_KIND），`.py` 落到根级会
 * 按扩展名判成 reference —— 脚本就此不再被执行，而上传照样成功、列表照样显示，
 * 没有任何报错。宁可多留一层让用户自己改路径，也不能静默改判 kind。
 *
 * 同时选中多个文件夹时不剥：顶层不唯一，无法判断哪一层是多余的。
 */
export function stripRedundantRoot(paths: readonly string[]): {
  paths: string[];
  stripped: string | null;
} {
  const normalized = paths.map((p) => normalizeAssetPath(p));
  const unchanged = { paths: normalized, stripped: null as string | null };
  if (normalized.length === 0) return unchanged;

  // 最外层有散文件 → 不是"多包了一层"的形态，原样保留。
  //
  // 这个判断必须显式写：`["scripts", "scripts/a.py"]` 的首段都是 scripts，
  // 唯一性检查放不出它，而剥它会把那个叫 scripts 的**文件**原样留下、
  // 同时把 scripts/a.py 剥成 a.py，得到一份自相矛盾的清单。
  if (!normalized.every((p) => p.includes("/"))) return unchanged;

  // 取首段用 split，不用 `slice(0, indexOf("/"))` —— 后者在没有斜杠时是
  // slice(0, -1)，会把 "a.py" 算成 "a.p"，于是靠"顶层碰巧不唯一"来兜正确结果。
  const tops = new Set(normalized.map((p) => p.split("/", 1)[0]));
  if (tops.size !== 1) return unchanged;

  const root = [...tops][0];
  if (!root) return unchanged;

  const stripped = normalized.map((p) => p.slice(p.indexOf("/") + 1));
  // 剥完只剩散文件 → 见上面第二种反例。
  // （不再检查"剥出空路径"：normalizeAssetPath 已去掉尾部斜杠，`my-skill/` 会
  //   变成不含斜杠的 `my-skill`，在上面那个 every 就被拦下，走不到这里。
  //   留一条测不到的分支，比没有这条分支更糟。）
  if (!stripped.some((p) => p.includes("/"))) return unchanged;

  return { paths: stripped, stripped: root };
}

/**
 * 模型可否经 skill_view 按需读取该资产（**忽略 stage**，调用方负责只对
 * published 行下结论）。三条判据逐条对齐后端 query_reference_assets：
 * kind='reference' + 扩展名非二进制 + 不是根目录 SKILL.md（正文本体已全量注入）。
 */
export function isModelReadableAsset(asset: { kind: string; path: string }): boolean {
  if (asset.kind !== "reference") return false;
  const path = normalizeAssetPath(asset.path);
  if (path === "SKILL.md") return false;
  return isViewableAssetPath(path);
}

/** 已发布资产清单 → 模型可读路径集合（草稿清单据此打标） */
export function readableAssetPaths(published: readonly SkillAssetItem[]): Set<string> {
  const paths = new Set<string>();
  for (const item of published) {
    if (isModelReadableAsset(item)) paths.add(item.path);
  }
  return paths;
}

/** kind 选择的轻提示码；null = 没什么好提醒的 */
export type AssetKindWarning = "binaryAsReference";

/**
 * 按扩展名提醒 kind 选错：二进制标成 reference 会被列进注入块 footer，却
 * 必然读失败（真实库里 .docx/.pdf 被标 reference 的错分类就是这么来的）。
 * 只提示不拦——后端接受任意 kind，判断权留给作者。
 */
export function assetKindWarning(path: string, kind: SkillAssetKind): AssetKindWarning | null {
  if (kind === "reference" && !isViewableAssetPath(path)) return "binaryAsReference";
  return null;
}

/**
 * 逐段 encodeURIComponent 后用 `/` 拼回——路径里的中文、空格、`#`、`?`、`（）`
 * 都要编码，但分隔符 `/` 必须保留（后端是 `{asset_path:path}` 通配段）。
 */
export function encodeAssetPath(path: string): string {
  return path.split("/").map(encodeURIComponent).join("/");
}

/**
 * BFF catch-all 反向：Next.js 已把 `[...path]` 各段解码，转发给后端前必须逐段重新编码。
 * 直接 join 会让含空格/中文的路径在 axios 组 URL 时错位。
 */
export function joinEncodedSegments(segments: string[] | string | undefined): string {
  if (!segments) return "";
  const parts = Array.isArray(segments) ? segments : [segments];
  return parts
    .filter((s) => s.length > 0)
    .map(encodeURIComponent)
    .join("/");
}

/** sha256 前 8 位（清单展示用）；缺失返回 "-" */
export function shortSha(sha: string | null | undefined): string {
  if (typeof sha !== "string" || sha.length === 0) return "-";
  return sha.slice(0, 8);
}

/** 单条资产容错归一化；path 缺失视为坏行返回 null */
function toAssetItem(value: unknown): SkillAssetItem | null {
  if (typeof value !== "object" || value === null) return null;
  const obj = value as Record<string, unknown>;
  const path = asString(obj.path);
  if (!path) return null;
  return {
    path,
    kind: asString(obj.kind) ?? "asset",
    size_bytes: asSize(obj.size_bytes) ?? 0,
    sha256: (asString(obj.sha256) ?? "").trim(),
    source_repo: asString(obj.source_repo),
    source_commit: asString(obj.source_commit),
    created_by_agent: obj.created_by_agent === true,
    updated_at: asString(obj.updated_at),
  };
}

/**
 * GET /api/v1/skills/{id}/assets 响应容错解包。
 * total / total_bytes 缺失时按 items 现算，避免 UI 的配额提示读到 undefined。
 */
export function parseAssetList(data: unknown): SkillAssetList {
  const obj = (data ?? {}) as Record<string, unknown>;
  const items = Array.isArray(obj.items)
    ? obj.items.map(toAssetItem).filter((i): i is SkillAssetItem => i !== null)
    : [];
  return {
    stage: asString(obj.stage) ?? "draft",
    items,
    total: asSize(obj.total) ?? items.length,
    total_bytes: asSize(obj.total_bytes) ?? items.reduce((sum, i) => sum + i.size_bytes, 0),
  };
}

/** GET|PUT /api/v1/skills/{id}/exec-config 响应容错解包；image 缺失视为无配置 */
export function parseExecConfig(data: unknown): SkillExecConfig | null {
  const summary = normalizeExecConfig(data);
  if (!summary) return null;
  return {
    stage: summary.stage,
    image: summary.image,
    image_enabled: summary.image_enabled,
    timeout_sec: summary.timeout_sec,
    writable_subdirs: summary.writable_subdirs,
    needs_network: summary.needs_network,
    warm_pool: summary.warm_pool,
    artifact_exclude: summary.artifact_exclude,
    updated_at: summary.updated_at ?? null,
  };
}

/** exec 配置表单里真正可编辑的字段（writable_subdirs 不在其中，见 buildExecConfigPayload） */
export interface ExecConfigEdits {
  image: string;
  timeout_sec: number;
  needs_network: boolean;
  warm_pool: boolean;
  /** 表单里可编辑；不传则沿用服务端现值（见 buildExecConfigPayload） */
  artifact_exclude?: string[];
  /** 同上。2026-08-23 起表单里可编辑（此前只能改库） */
  writable_subdirs?: string[];
}

/**
 * 组装 PUT /api/v1/skills/{id}/exec-config 请求体。
 *
 * writable_subdirs 与 artifact_exclude 两个列表字段，**表单里都可编辑**
 * （writable_subdirs 从 2026-08-23 起；此前只能改库，结果是全平台只有 1 个 skill
 * 用了它 —— 不是没人需要跨对话持久化，是没有入口）。
 *
 * 但 `edits` 里没给时**必须把 GET 拿到的现值原样带回**：后端对这两个字段是
 * 全量覆盖（skills.py 的 `cfg.writable_subdirs = payload.writable_subdirs`，
 * 且 payload 侧 default_factory=list），不带回则任何一次保存都会把 fund skill 的
 * [".report_state"] 静默清空，其增量调研的持久状态从此无处可写。
 *
 * 兜底保留的场景是「表单没渲染出这个字段」：GET 失败、或调用方只想改超时。
 * loaded 为 null（把一个非可执行 skill 首次配成可执行）时才是真正的空清单。
 */
export function buildExecConfigPayload(
  edits: ExecConfigEdits,
  loaded: Pick<SkillExecConfig, "writable_subdirs" | "artifact_exclude"> | null
): SkillExecConfigPayload {
  return {
    image: edits.image,
    timeout_sec: edits.timeout_sec,
    writable_subdirs: edits.writable_subdirs ?? loaded?.writable_subdirs ?? [],
    needs_network: edits.needs_network,
    warm_pool: edits.warm_pool,
    // 与 writable_subdirs 同一个坑：后端全量覆盖，不带回则任何一次保存都会把
    // CRP 的 ["**/findings.json"] 静默清空，中间产物又开始发链接给用户
    artifact_exclude: edits.artifact_exclude ?? loaded?.artifact_exclude ?? [],
  };
}

/** GET /api/v1/sandbox-images 响应容错解包；端点缺失（404）时调用方降级为手工输入 */
export function parseSandboxImages(data: unknown): SandboxImage[] {
  const obj = (data ?? {}) as Record<string, unknown>;
  const raw = Array.isArray(obj.items) ? obj.items : Array.isArray(data) ? data : [];
  const images: SandboxImage[] = [];
  for (const value of raw) {
    if (typeof value !== "object" || value === null) continue;
    const item = value as Record<string, unknown>;
    const name = asString(item.name);
    if (!name) continue;
    const tag = asString(item.tag) ?? "latest";
    const digest = asString(item.digest);
    images.push({
      id: asSize(item.id) ?? 0,
      name,
      tag,
      digest,
      is_enabled: item.is_enabled !== false,
      description: asString(item.description),
      ref: asString(item.ref) || (digest ? `${name}@${digest}` : `${name}:${tag}`),
      // 显式区分三态：字段缺失（老后端）与 null（docker 不可达）都归为 null，
      // 只有布尔值才当作确定的判断
      present: typeof item.present === "boolean" ? item.present : null,
    });
  }
  return images;
}

/**
 * 提交给 PUT exec-config 的镜像值：**必须是 name:tag**。
 * 后端用 `rsplit(":", 1)` 拆 image，digest 形态的 ref（`name@sha256:…`）会被拆成
 * `name@sha256` + 十六进制串，查不到白名单直接 422——所以 ref 只用于展示。
 */
export function sandboxImageValue(image: SandboxImage): string {
  return `${image.name}:${image.tag}`;
}

/**
 * 把 exec-config 返回的 image（可能是 digest 形态 ref）映射回下拉框可提交的 name:tag。
 * 匹配不上（镜像已下架/被删）时原样回退，UI 走手工输入避免静默改镜像。
 */
export function resolveImageSelection(
  configImage: string | null | undefined,
  images: SandboxImage[]
): { value: string; matched: SandboxImage | null } {
  const raw = (configImage ?? "").trim();
  if (!raw) return { value: "", matched: null };
  const matched =
    images.find((img) => img.ref === raw) ??
    images.find((img) => sandboxImageValue(img) === raw) ??
    null;
  return { value: matched ? sandboxImageValue(matched) : raw, matched };
}

export interface AssetGroup {
  /** 顶层目录名；空串 = skill 根目录下的散文件 */
  dir: string;
  items: SkillAssetItem[];
  totalBytes: number;
}

/** 按顶层目录分组：约定目录（scripts/data/assets/references）在前，其余字典序，根文件最后 */
export function groupAssetsByDir(items: SkillAssetItem[]): AssetGroup[] {
  const groups = new Map<string, SkillAssetItem[]>();
  for (const item of items) {
    const slash = item.path.indexOf("/");
    const dir = slash > 0 ? item.path.slice(0, slash) : "";
    const bucket = groups.get(dir);
    if (bucket) bucket.push(item);
    else groups.set(dir, [item]);
  }
  const dirs = [...groups.keys()].sort((a, b) => {
    if (a === b) return 0;
    if (a === "") return 1;
    if (b === "") return -1;
    const ai = GROUP_ORDER.indexOf(a);
    const bi = GROUP_ORDER.indexOf(b);
    if (ai !== -1 || bi !== -1) {
      if (ai === -1) return 1;
      if (bi === -1) return -1;
      return ai - bi;
    }
    return a.localeCompare(b);
  });
  return dirs.map((dir) => {
    const bucket = (groups.get(dir) ?? []).sort((a, b) => a.path.localeCompare(b.path));
    return {
      dir,
      items: bucket,
      totalBytes: bucket.reduce((sum, i) => sum + i.size_bytes, 0),
    };
  });
}

/** 上传候选被拒原因；`quota` 携带的是剩余可用字节 */
export type AssetUploadError =
  | { type: "path"; code: AssetPathError }
  | { type: "tooLarge"; limit: number }
  | { type: "quota"; limit: number };

export interface UploadCandidate {
  /** 原始相对路径（webkitRelativePath 或用户手填） */
  path: string;
  size: number;
  /** 用户手工指定 kind；缺省按顶层目录推断 */
  kind?: SkillAssetKind;
}

export interface UploadPlanEntry {
  /** 规范化后的目标路径（实际 PUT 用这个） */
  path: string;
  kind: SkillAssetKind;
  size: number;
  /** null = 可上传 */
  error: AssetUploadError | null;
}

export interface UploadPlan {
  entries: UploadPlanEntry[];
  /** 全部可上传项落库后的合计字节数 */
  totalBytesAfter: number;
  acceptedCount: number;
  rejectedCount: number;
}

/**
 * 上传前的纯校验：逐个候选算路径合法性、单文件 20MB、以及「替换同名后」的 100MB 总量。
 * 同名覆盖不重复计入配额；批内同名多次出现按最后一次计。
 * 超限的候选不占用配额，后面的小文件仍可通过——与后端逐个 PUT 的语义一致。
 */
export function planUploads(existing: SkillAssetItem[], candidates: UploadCandidate[]): UploadPlan {
  const sizeByPath = new Map<string, number>();
  for (const item of existing) sizeByPath.set(item.path, item.size_bytes);
  let running = [...sizeByPath.values()].reduce((sum, n) => sum + n, 0);

  const entries: UploadPlanEntry[] = [];
  for (const candidate of candidates) {
    const path = normalizeAssetPath(candidate.path);
    const kind = candidate.kind ?? inferAssetKind(path);
    const size = Number.isFinite(candidate.size) && candidate.size >= 0 ? candidate.size : 0;

    const pathError = validateAssetPath(path);
    if (pathError) {
      entries.push({ path, kind, size, error: { type: "path", code: pathError } });
      continue;
    }
    if (size > ASSET_MAX_FILE_BYTES) {
      entries.push({ path, kind, size, error: { type: "tooLarge", limit: ASSET_MAX_FILE_BYTES } });
      continue;
    }
    const prospective = running - (sizeByPath.get(path) ?? 0) + size;
    if (prospective > ASSET_MAX_TOTAL_BYTES) {
      entries.push({ path, kind, size, error: { type: "quota", limit: ASSET_MAX_TOTAL_BYTES } });
      continue;
    }
    running = prospective;
    sizeByPath.set(path, size);
    entries.push({ path, kind, size, error: null });
  }

  const acceptedCount = entries.filter((e) => e.error === null).length;
  return {
    entries,
    totalBytesAfter: running,
    acceptedCount,
    rejectedCount: entries.length - acceptedCount,
  };
}

/**
 * 资产/配置变更属实质编辑：后端会把 published / rejected 打回 draft。
 * 发请求前据此决定是否弹二次确认。
 */
export function willRevertToDraft(status: string | null | undefined): boolean {
  return status === "published" || status === "rejected";
}

/** ArrayBuffer → base64（分块避免 String.fromCharCode 参数过多爆栈） */
export function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x8000;
  let binary = "";
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

/** 字节数人类可读格式（1024 进制，B/KB/MB/GB，保留 1 位小数） */
export function formatBytes(bytes: number | null | undefined): string {
  if (typeof bytes !== "number" || !Number.isFinite(bytes) || bytes < 0) return "-";
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB"] as const;
  let value = bytes;
  let unit: (typeof units)[number] = "KB";
  for (const u of units) {
    value /= 1024;
    unit = u;
    if (value < 1024) break;
  }
  return `${value.toFixed(1)} ${unit}`;
}

/** 取消可执行时，两个 stage 各自删不删 */
export interface ExecCancelPlan {
  /** 撤草稿的运行配置 */
  deleteDraft: boolean;
  /** 停掉线上正在跑的那份 */
  deleteLive: boolean;
  /** 界面上要不要给「同时停线上」的勾选框 */
  offerChoice: boolean;
}

/**
 * 取消可执行的动作规划。
 *
 * 三条不变量：
 * - 不存在的 stage 不发删除请求。后端对不存在的行是幂等成功，发了会拿回一句
 *   success，前端据此报「已取消」——一次什么都没做的成功，比失败更难查。
 * - 草稿已经不可执行、只剩线上那份时，「停线上」就是本次操作的全部内容，
 *   不给选择（可以取消勾选的话，按钮就成了空操作）。
 * - 草稿和线上都在时才给勾选框：撤草稿要等重新过审发布才生效
 *   （publish = 先删 published 再从 draft 复制），中间线上照跑。
 */
export function planExecCancel(input: {
  hasDraftExec: boolean;
  hasLiveExec: boolean;
  alsoStopLive: boolean;
}): ExecCancelPlan {
  const { hasDraftExec, hasLiveExec, alsoStopLive } = input;
  const offerChoice = hasDraftExec && hasLiveExec;
  return {
    deleteDraft: hasDraftExec,
    deleteLive: hasLiveExec && (!hasDraftExec || alsoStopLive),
    offerChoice,
  };
}

/** 这次操作是不是完全没事可做——没事可做就不该弹确认框，更不该报成功 */
export function isExecCancelNoop(plan: ExecCancelPlan): boolean {
  return !plan.deleteDraft && !plan.deleteLive;
}
