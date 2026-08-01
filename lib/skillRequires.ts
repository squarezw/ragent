// requires 受控选项与「Skill 生效状态」诊断的纯数据整形
// 对齐 ragent-service feature/skills-p8：
//   GET /api/v1/skills/requires-options
//   GET /api/v1/apps/{app_id}/skills/diagnostics

import type {
  AppSkillDiagnosticItem,
  AppSkillDiagnostics,
  RequiresKind,
  RequiresOptions,
  RequiresToolOption,
  RequiresWorkflowOption,
  SkillRequiresGap,
} from "@/types/skill";

export type {
  AppSkillDiagnosticItem,
  AppSkillDiagnostics,
  RequiresKind,
  RequiresOptions,
  RequiresToolOption,
  RequiresWorkflowOption,
  SkillRequiresGap,
};

const EMPTY_OPTIONS: RequiresOptions = { tools: [], workflows: [] };

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function asCount(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : fallback;
}

/** requires.tools / requires.workflows 的宽松归一：去空白、去空串、去重、保序 */
export function normalizeRequiresList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const result: string[] = [];
  for (const raw of value) {
    if (typeof raw !== "string") continue;
    const name = raw.trim();
    if (name && !seen.has(name)) {
      seen.add(name);
      result.push(name);
    }
  }
  return result;
}

/** GET /skills/requires-options 响应 → 选项集合（拿不到时退化为空，UI 回落手工输入） */
export function parseRequiresOptions(data: unknown): RequiresOptions {
  const root = asRecord(data);
  if (!root) return EMPTY_OPTIONS;

  const toolRows = Array.isArray(root.tools) ? root.tools : [];
  const tools: RequiresToolOption[] = [];
  for (const row of toolRows) {
    const item = asRecord(row);
    const name = item && asString(item.name);
    if (!name) continue;
    tools.push({
      name,
      display_name: (item && asString(item.display_name)) || name,
      tool_type: (item && asString(item.tool_type)) || "",
      category: (item && asString(item.category)) ?? null,
      description: (item && asString(item.description)) ?? null,
    });
  }

  const workflowRows = Array.isArray(root.workflows) ? root.workflows : [];
  const workflows: RequiresWorkflowOption[] = [];
  for (const row of workflowRows) {
    const item = asRecord(row);
    const kind = item && asString(item.kind);
    if (!kind) continue;
    workflows.push({
      kind,
      display_name: (item && asString(item.display_name)) ?? null,
      description: (item && asString(item.description)) ?? null,
      // 字段缺失按「启用」处理：宁可不置灰，也不要把可用 kind 误标成会导致不注入
      is_enabled: item && typeof item.is_enabled === "boolean" ? item.is_enabled : true,
    });
  }

  return { tools, workflows };
}

function parseGap(row: unknown): SkillRequiresGap | null {
  const item = asRecord(row);
  const name = item && asString(item.name);
  if (!name) return null;
  return {
    name,
    kind: item && item.kind === "workflow" ? "workflow" : "tool",
    available: item?.available === true,
    tool_type: (item && asString(item.tool_type)) ?? null,
    globally_enabled: item?.globally_enabled === true,
  };
}

/** GET /apps/{id}/skills/diagnostics 响应 → 诊断数据；形状不认识时返 null（区块整体不渲染） */
export function parseSkillDiagnostics(data: unknown): AppSkillDiagnostics | null {
  const root = asRecord(data);
  if (!root || !Array.isArray(root.items)) return null;

  const items: AppSkillDiagnosticItem[] = [];
  for (const row of root.items) {
    const item = asRecord(row);
    if (!item) continue;
    const skillId = typeof item.skill_id === "number" ? item.skill_id : Number(item.skill_id);
    if (!Number.isFinite(skillId)) continue;
    items.push({
      skill_id: skillId,
      skill_name: asString(item.skill_name) || "",
      display_name: asString(item.display_name) ?? null,
      // effective 缺失时按「无缺口即生效」推断，避免旧后端把全部 skill 标红
      effective: typeof item.effective === "boolean" ? item.effective : true,
      reason: asString(item.reason) ?? null,
      missing: Array.isArray(item.missing)
        ? item.missing.map(parseGap).filter((g): g is SkillRequiresGap => g !== null)
        : [],
    });
  }

  const derivedBlocked = items.filter((i) => !i.effective).length;
  return {
    app_id: asCount(root.app_id, 0),
    items,
    total: asCount(root.total, items.length),
    effective_count: asCount(root.effective_count, items.length - derivedBlocked),
    blocked_count: asCount(root.blocked_count, derivedBlocked),
  };
}

/** POST/PUT /skills 响应里的 warnings（不阻断保存，但必须显眼展示） */
export function parseSaveWarnings(data: unknown): string[] {
  const root = asRecord(data);
  if (!root || !Array.isArray(root.warnings)) return [];
  return root.warnings
    .map((w) => (typeof w === "string" ? w.trim() : ""))
    .filter((w) => w.length > 0);
}

const SAVE_WARNINGS_KEY = "ragent:skill-save-warnings";

/**
 * 新建页 POST 完就跳转到详情页，warnings 会随卸载丢掉——跨这一跳把它们带过去。
 * sessionStorage 在无痕/禁用存储下会抛，静默吞掉即可（大不了少一次提示）。
 */
export function stashSaveWarnings(skillId: number, warnings: string[]): void {
  if (typeof sessionStorage === "undefined" || warnings.length === 0) return;
  try {
    sessionStorage.setItem(SAVE_WARNINGS_KEY, JSON.stringify({ skillId, warnings }));
  } catch {
    /* 存不下就算了 */
  }
}

/** 读取并清除；skillId 对不上说明是别的 skill 的残留，一并清掉 */
export function takeSaveWarnings(skillId: number): string[] {
  if (typeof sessionStorage === "undefined") return [];
  try {
    const raw = sessionStorage.getItem(SAVE_WARNINGS_KEY);
    if (!raw) return [];
    sessionStorage.removeItem(SAVE_WARNINGS_KEY);
    const parsed = asRecord(JSON.parse(raw));
    if (!parsed || parsed.skillId !== skillId) return [];
    return parseSaveWarnings(parsed);
  } catch {
    return [];
  }
}

// ==================== 缺口分类 ====================

export type RequiresGapCategory = "unknown-name" | "globally-disabled" | "not-bound-to-app";

/** 修复入口：none = 只给文案（当前用户无权处理） */
export type RequiresGapAction = "none" | "edit-skill" | "bind-tools" | "manage-tools";

/** skills 命名空间下的 i18n 键（字面量联合，next-intl 的键校验要求可静态判定） */
export type RequiresGapMessageKey =
  | "gapToolNotFound"
  | "gapToolGloballyDisabled"
  | "gapToolNotBound"
  | "gapWorkflowNotRegistered"
  | "gapWorkflowDisabled";

export interface RequiresGapGuidance {
  category: RequiresGapCategory;
  kind: RequiresKind;
  messageKey: RequiresGapMessageKey;
  action: RequiresGapAction;
}

/**
 * 三种缺口靠两个 bool 区分：
 * available=false → 系统里查无此名（多半拼错）；
 * available=true 且 globally_enabled=false → 存在但被超管全局停用；
 * 两者都 true → 工具可用，只是没绑给这个应用。
 *
 * workflow 缺口的 globally_enabled 恒 false（进 missing 就说明不在启用集里），
 * 所以只会落到前两类。
 */
export function classifyRequiresGap(gap: SkillRequiresGap): RequiresGapCategory {
  if (!gap.available) return "unknown-name";
  if (!gap.globally_enabled) return "globally-disabled";
  return "not-bound-to-app";
}

export function resolveRequiresGapGuidance(
  gap: SkillRequiresGap,
  options: { isSuperAdmin?: boolean } = {}
): RequiresGapGuidance {
  const category = classifyRequiresGap(gap);
  const superAdmin = options.isSuperAdmin === true;

  if (gap.kind === "workflow") {
    if (category === "unknown-name") {
      return {
        category,
        kind: "workflow",
        messageKey: "gapWorkflowNotRegistered",
        action: "edit-skill",
      };
    }
    // not-bound-to-app 在 workflow 上不可达（globally_enabled 恒 false）；
    // 真出现就当「已注册但被关」处理，别给用户一个绑定应用工具的错误指引
    return {
      category,
      kind: "workflow",
      messageKey: "gapWorkflowDisabled",
      action: superAdmin ? "manage-tools" : "none",
    };
  }

  if (category === "unknown-name") {
    return { category, kind: "tool", messageKey: "gapToolNotFound", action: "edit-skill" };
  }
  if (category === "globally-disabled") {
    return {
      category,
      kind: "tool",
      messageKey: "gapToolGloballyDisabled",
      action: superAdmin ? "manage-tools" : "none",
    };
  }
  return { category, kind: "tool", messageKey: "gapToolNotBound", action: "bind-tools" };
}

export interface RenderableGap extends SkillRequiresGap {
  guidance: RequiresGapGuidance;
}

export interface RenderableGapGroup {
  kind: RequiresKind;
  gaps: RenderableGap[];
}

/** 混合 missing（工具 + workflow）→ 分组渲染数据；空组不返回，工具组恒在前 */
export function buildGapGroups(
  missing: SkillRequiresGap[],
  options: { isSuperAdmin?: boolean } = {}
): RenderableGapGroup[] {
  const buckets: Record<RequiresKind, RenderableGap[]> = { tool: [], workflow: [] };
  for (const gap of missing) {
    buckets[gap.kind].push({ ...gap, guidance: resolveRequiresGapGuidance(gap, options) });
  }
  const groups: RenderableGapGroup[] = [];
  for (const kind of ["tool", "workflow"] as const) {
    if (buckets[kind].length > 0) groups.push({ kind, gaps: buckets[kind] });
  }
  return groups;
}

export interface DiagnosticsSummary {
  total: number;
  effectiveCount: number;
  blockedCount: number;
  /** empty = 没有可诊断的 skill；quiet = 全部生效（低调展示）；alert = 有未生效 */
  tone: "empty" | "quiet" | "alert";
  blocked: AppSkillDiagnosticItem[];
}

export function summarizeDiagnostics(data: AppSkillDiagnostics | null): DiagnosticsSummary {
  if (!data || data.items.length === 0) {
    return { total: 0, effectiveCount: 0, blockedCount: 0, tone: "empty", blocked: [] };
  }
  const blocked = data.items.filter((item) => !item.effective);
  return {
    total: data.total,
    effectiveCount: data.effective_count,
    blockedCount: data.blocked_count,
    tone: blocked.length > 0 ? "alert" : "quiet",
    blocked,
  };
}

// ==================== 受控多选的选项整形 ====================

/** 工具分区顺序：MCP 在前、Native 次之，其余按出现顺序兜底 */
const TOOL_TYPE_ORDER = ["mcp", "native"];

export interface ToolOptionGroup {
  toolType: string;
  items: RequiresToolOption[];
}

export function groupToolOptions(options: RequiresToolOption[]): ToolOptionGroup[] {
  const groups: ToolOptionGroup[] = [];
  const index = new Map<string, ToolOptionGroup>();
  for (const type of TOOL_TYPE_ORDER) {
    const group: ToolOptionGroup = { toolType: type, items: [] };
    index.set(type, group);
    groups.push(group);
  }
  for (const option of options) {
    const type = option.tool_type || "other";
    let group = index.get(type);
    if (!group) {
      group = { toolType: type, items: [] };
      index.set(type, group);
      groups.push(group);
    }
    group.items.push(option);
  }
  return groups.filter((group) => group.items.length > 0);
}

function matches(query: string, ...fields: (string | null | undefined)[]): boolean {
  if (!query) return true;
  const needle = query.trim().toLowerCase();
  if (!needle) return true;
  return fields.some((field) => (field || "").toLowerCase().includes(needle));
}

export function filterToolOptions(
  options: RequiresToolOption[],
  query: string
): RequiresToolOption[] {
  return options.filter((o) => matches(query, o.name, o.display_name, o.category, o.description));
}

export function filterWorkflowOptions(
  options: RequiresWorkflowOption[],
  query: string
): RequiresWorkflowOption[] {
  return options.filter((o) => matches(query, o.kind, o.display_name, o.description));
}

/**
 * 候选清单里该出现哪些长任务。
 *
 * 已被全局停用的不出现：勾了只会让这个 Skill 不被注入，摆出来是在邀请用户犯错
 * （生产上 8 个 cad.* 全停用时，整张清单都是红字警告）。
 *
 * **但已经选中的必须留下。** 一个 skill 可能在 kind 还启用时就声明了依赖，之后那个
 * kind 被全局停用；此时若把它从清单里抹掉，用户一编辑保存就静默丢了这条依赖——连
 * "为什么这个 skill 不被注入"的线索都跟着没了。留着（带停用标注）才能让人看见、
 * 自己决定要不要去掉。
 */
export function selectableWorkflowOptions(
  options: RequiresWorkflowOption[],
  selected: string[]
): RequiresWorkflowOption[] {
  const picked = new Set(selected);
  return options.filter((o) => o.is_enabled || picked.has(o.kind));
}

/** 已选条目的展示信息；known=false 表示选项里没有这个名字（手工兜底输入），要打警示样式 */
export interface RequiresSelectionEntry {
  name: string;
  known: boolean;
  displayName: string | null;
  /** tool: native|mcp；workflow: null */
  toolType: string | null;
  /** workflow 专用：已注册但被全局停用 */
  disabled: boolean;
}

export function resolveToolSelection(
  selected: string[],
  options: RequiresToolOption[]
): RequiresSelectionEntry[] {
  const index = new Map(options.map((o) => [o.name, o]));
  return selected.map((name) => {
    const option = index.get(name);
    return {
      name,
      known: option !== undefined,
      displayName: option ? option.display_name : null,
      toolType: option ? option.tool_type : null,
      disabled: false,
    };
  });
}

export function resolveWorkflowSelection(
  selected: string[],
  options: RequiresWorkflowOption[]
): RequiresSelectionEntry[] {
  const index = new Map(options.map((o) => [o.kind, o]));
  return selected.map((name) => {
    const option = index.get(name);
    return {
      name,
      known: option !== undefined,
      displayName: option ? option.display_name : null,
      toolType: null,
      disabled: option ? !option.is_enabled : false,
    };
  });
}

export function toggleRequiresName(selected: string[], name: string): string[] {
  return selected.includes(name) ? selected.filter((n) => n !== name) : [...selected, name];
}

export function removeRequiresName(selected: string[], name: string): string[] {
  return selected.filter((n) => n !== name);
}

/** 手工兜底输入：后端允许先写 skill 再上线工具，所以选项外的名字必须能加进来 */
export function addRequiresName(selected: string[], raw: string): string[] {
  const name = raw.trim();
  if (!name || selected.includes(name)) return selected;
  return [...selected, name];
}
