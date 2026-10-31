import assert from "node:assert/strict";
import { test } from "node:test";
import {
  addRequiresName,
  buildGapGroups,
  classifyRequiresGap,
  filterToolOptions,
  groupToolOptions,
  normalizeRequiresList,
  parseRequiresOptions,
  parseSaveWarnings,
  parseSkillDiagnostics,
  removeRequiresName,
  resolveRequiresGapGuidance,
  resolveToolSelection,
  summarizeDiagnostics,
  toggleRequiresName,
  type SkillRequiresGap,
} from "../lib/skillRequires.ts";

function gap(partial: Partial<SkillRequiresGap>): SkillRequiresGap {
  return {
    name: "qcc-company",
    kind: "tool",
    available: true,
    tool_type: "mcp",
    globally_enabled: true,
    ...partial,
  };
}

test("tool requirements preserve fallback input and exclude unsupported registry rows", () => {
  const parsed = parseRequiresOptions({ tools: [
    { name: "bare" },
    { name: "mcp-company", tool_type: "mcp" },
    { name: "obsolete-kind", tool_type: "unsupported-registry" },
  ] });
  assert.deepEqual(parsed.tools.map(tool => tool.name), ["bare", "mcp-company"]);
  assert.deepEqual(parseRequiresOptions(undefined), { tools: [] });
  assert.deepEqual(parseRequiresOptions("bad response"), { tools: [] });
});

test("tool diagnostics retain known gaps and ignore unsupported dependency kinds", () => {
  const parsed = parseSkillDiagnostics({ items: [{
    skill_id: 1, skill_name: "test-skill", effective: false,
    missing: [gap({}), { name: "old-kind", kind: "unsupported-registry" }],
  }] });
  assert.equal(parsed?.items[0].missing.length, 1);
  assert.equal(parsed?.items[0].missing[0].kind, "tool");
  assert.deepEqual(buildGapGroups([gap({})]).map(group => group.kind), ["tool"]);
});

// ==================== 三种缺口分类 ====================

test("classifyRequiresGap: available=false → 名字可能拼错", () => {
  assert.equal(
    classifyRequiresGap(gap({ available: false, tool_type: null, globally_enabled: false })),
    "unknown-name"
  );
});

test("classifyRequiresGap: 存在但全局停用", () => {
  assert.equal(
    classifyRequiresGap(gap({ available: true, globally_enabled: false })),
    "globally-disabled"
  );
});

test("classifyRequiresGap: 存在且启用 → 只是没绑给这个应用", () => {
  assert.equal(
    classifyRequiresGap(gap({ available: true, globally_enabled: true })),
    "not-bound-to-app"
  );
});

test("resolveRequiresGapGuidance: 工具三种缺口给三种修复动作", () => {
  const notFound = resolveRequiresGapGuidance(
    gap({ available: false, tool_type: null, globally_enabled: false })
  );
  assert.deepEqual(notFound, {
    category: "unknown-name",
    kind: "tool",
    messageKey: "gapToolNotFound",
    action: "edit-skill",
  });

  const disabled = resolveRequiresGapGuidance(gap({ globally_enabled: false }));
  assert.deepEqual(disabled, {
    category: "globally-disabled",
    kind: "tool",
    messageKey: "gapToolGloballyDisabled",
    action: "none",
  });

  const notBound = resolveRequiresGapGuidance(gap({}));
  assert.deepEqual(notBound, {
    category: "not-bound-to-app",
    kind: "tool",
    messageKey: "gapToolNotBound",
    action: "bind-tools",
  });
});

test("resolveRequiresGapGuidance: 全局停用对超管才给工具管理入口", () => {
  const asUser = resolveRequiresGapGuidance(gap({ globally_enabled: false }));
  const asAdmin = resolveRequiresGapGuidance(gap({ globally_enabled: false }), {
    isSuperAdmin: true,
  });
  assert.equal(asUser.action, "none");
  assert.equal(asAdmin.action, "manage-tools");
  // 文案不随权限变，只有可点入口变
  assert.equal(asUser.messageKey, asAdmin.messageKey);
});

test("resolveRequiresGapGuidance: 未绑定给绑定入口，与是否超管无关", () => {
  assert.equal(resolveRequiresGapGuidance(gap({}), { isSuperAdmin: true }).action, "bind-tools");
  assert.equal(resolveRequiresGapGuidance(gap({}), { isSuperAdmin: false }).action, "bind-tools");
});

// ==================== 诊断响应解析与摘要 ====================

const DIAGNOSTICS_FIXTURE = {
  app_id: 4,
  items: [
    {
      skill_id: 6,
      skill_name: "fund-quarterly-report",
      display_name: "基金季报生成器",
      effective: true,
      reason: null,
      missing: [],
    },
    {
      skill_id: 5,
      skill_name: "qcc-tool-selection",
      display_name: null,
      effective: false,
      reason: "missing_tools",
      missing: [
        {
          name: "qcc-company",
          kind: "tool",
          available: true,
          tool_type: "mcp",
          globally_enabled: true,
        },
      ],
    },
  ],
  total: 2,
  effective_count: 1,
  blocked_count: 1,
};

test("parseSkillDiagnostics: 计数缺失时从 items 推导", () => {
  const parsed = parseSkillDiagnostics({ items: DIAGNOSTICS_FIXTURE.items });
  assert.ok(parsed);
  assert.equal(parsed.total, 2);
  assert.equal(parsed.effective_count, 1);
  assert.equal(parsed.blocked_count, 1);
});

test("parseSkillDiagnostics: 不认识的形状返回 null", () => {
  assert.equal(parseSkillDiagnostics(null), null);
  assert.equal(parseSkillDiagnostics([]), null);
  assert.equal(parseSkillDiagnostics({ detail: "Forbidden" }), null);
});

test("parseSkillDiagnostics: 丢弃缺 skill_id 的行与缺 name 的缺口", () => {
  const parsed = parseSkillDiagnostics({
    app_id: 1,
    items: [
      { skill_name: "no-id", effective: false },
      {
        skill_id: 9,
        skill_name: "ok",
        effective: false,
        missing: [{ kind: "tool" }, { name: "t" }],
      },
    ],
  });
  assert.ok(parsed);
  assert.equal(parsed.items.length, 1);
  assert.deepEqual(parsed.items[0].missing, [
    { name: "t", kind: "tool", available: false, tool_type: null, globally_enabled: false },
  ]);
});

test("summarizeDiagnostics: 全部生效 quiet / 有未生效 alert / 空 empty", () => {
  const alert = summarizeDiagnostics(parseSkillDiagnostics(DIAGNOSTICS_FIXTURE));
  assert.equal(alert.tone, "alert");
  assert.equal(alert.blocked.length, 1);
  assert.equal(alert.blocked[0].skill_name, "qcc-tool-selection");

  const quiet = summarizeDiagnostics(
    parseSkillDiagnostics({ ...DIAGNOSTICS_FIXTURE, items: [DIAGNOSTICS_FIXTURE.items[0]] })
  );
  assert.equal(quiet.tone, "quiet");
  assert.equal(quiet.blocked.length, 0);

  assert.equal(summarizeDiagnostics(null).tone, "empty");
  assert.equal(summarizeDiagnostics(parseSkillDiagnostics({ items: [] })).tone, "empty");
});

// ==================== 选项解析与筛选 ====================

const OPTIONS_FIXTURE = {
  tools: [
    {
      name: "qcc-company",
      display_name: "企查查-企业信息",
      tool_type: "mcp",
      category: "query",
      description: "查企业",
    },
    {
      name: "qcc-risk",
      display_name: "企查查-风险",
      tool_type: "mcp",
      category: "query",
      description: null,
    },
    {
      name: "sql_query",
      display_name: "SQL 查询",
      tool_type: "native",
      category: "data",
      description: null,
    },
  ],
};

test("groupToolOptions: MCP 分区在 Native 之前，未知类型兜底 other", () => {
  const groups = groupToolOptions([
    ...parseRequiresOptions(OPTIONS_FIXTURE).tools,
    { name: "weird", display_name: "weird", tool_type: "", category: null, description: null },
  ]);
  assert.deepEqual(
    groups.map((g) => [g.toolType, g.items.length]),
    [
      ["mcp", 2],
      ["native", 1],
      ["other", 1],
    ]
  );
});

test("groupToolOptions: 只有 native 时不返回空的 mcp 分区", () => {
  const groups = groupToolOptions([
    {
      name: "sql_query",
      display_name: "SQL",
      tool_type: "native",
      category: null,
      description: null,
    },
  ]);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].toolType, "native");
});

test("filterToolOptions: 命中 name / display_name / category / description，大小写无关", () => {
  const { tools } = parseRequiresOptions(OPTIONS_FIXTURE);
  assert.deepEqual(
    filterToolOptions(tools, "QCC").map((t) => t.name),
    ["qcc-company", "qcc-risk"]
  );
  assert.deepEqual(
    filterToolOptions(tools, "风险").map((t) => t.name),
    ["qcc-risk"]
  );
  assert.deepEqual(
    filterToolOptions(tools, "data").map((t) => t.name),
    ["sql_query"]
  );
  assert.deepEqual(
    filterToolOptions(tools, "查企业").map((t) => t.name),
    ["qcc-company"]
  );
  assert.equal(filterToolOptions(tools, "   ").length, 3);
});

// ==================== 已选条目整形 ====================

test("resolveToolSelection: 选项外的名字标 known=false（手工兜底要警示）", () => {
  const { tools } = parseRequiresOptions(OPTIONS_FIXTURE);
  const entries = resolveToolSelection(["qcc-company", "not-yet-online"], tools);
  assert.deepEqual(entries, [
    {
      name: "qcc-company",
      known: true,
      displayName: "企查查-企业信息",
      toolType: "mcp",
      disabled: false,
    },
    { name: "not-yet-online", known: false, displayName: null, toolType: null, disabled: false },
  ]);
});

test("resolveToolSelection: 选项为空时全部按未知处理，不丢已选值", () => {
  const entries = resolveToolSelection(["a", "b"], []);
  assert.deepEqual(
    entries.map((e) => [e.name, e.known]),
    [
      ["a", false],
      ["b", false],
    ]
  );
});

// ==================== 选择状态变更 ====================

test("toggleRequiresName 保序添加 / 移除", () => {
  assert.deepEqual(toggleRequiresName(["a"], "b"), ["a", "b"]);
  assert.deepEqual(toggleRequiresName(["a", "b"], "a"), ["b"]);
});

test("addRequiresName: trim、去重、拒空", () => {
  assert.deepEqual(addRequiresName(["a"], "  b  "), ["a", "b"]);
  assert.deepEqual(addRequiresName(["a"], "a"), ["a"]);
  assert.deepEqual(addRequiresName(["a"], "   "), ["a"]);
});

test("removeRequiresName 移除指定项", () => {
  assert.deepEqual(removeRequiresName(["a", "b"], "a"), ["b"]);
  assert.deepEqual(removeRequiresName(["a"], "zz"), ["a"]);
});

test("normalizeRequiresList: 去空白去重保序，非数组归一为空", () => {
  assert.deepEqual(normalizeRequiresList([" a ", "b", "a", "", 3, null]), ["a", "b"]);
  assert.deepEqual(normalizeRequiresList(undefined), []);
  assert.deepEqual(normalizeRequiresList("a,b"), []);
});

// ==================== 保存 warnings ====================

test("parseSaveWarnings: 抽出非空字符串，缺失返回空数组", () => {
  assert.deepEqual(
    parseSaveWarnings({
      id: 1,
      warnings: ["'qcc-compnay' 不存在（可能拼错…）；是否想写 qcc-company？", "  ", 5],
    }),
    ["'qcc-compnay' 不存在（可能拼错…）；是否想写 qcc-company？"]
  );
  assert.deepEqual(parseSaveWarnings({ id: 1, warnings: null }), []);
  assert.deepEqual(parseSaveWarnings(null), []);
});
