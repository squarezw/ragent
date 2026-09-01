/**
 * 计费系数表的合并与筛选（2026-09-01）。
 *
 * 原先界面把「已显式设置」和「在吃默认值」分成两块，用户得先弄懂后一个说法
 * 才知道为什么某个条目在这块而不在那块。合成一张表之后，这些判断从组件里
 * 挪到纯函数里 —— 排序或标记错了，表现是「界面显示的钱和实际扣的对不上」。
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  countByType,
  describeCoefficient,
  filterRates,
  mergeRates,
} from "../lib/billingRates.ts";

const DEFAULTS = { model: 1, skill: 1, tool: 2 };

const explicit = [
  { rate_type: "tool", ref_key: "10", coefficient: "1.2000", note: "手写备注", name: "mcp-search-tavily", updated_at: null },
  { rate_type: "skill", ref_key: "31", coefficient: "0", note: null, name: "pdf-to-dxf", updated_at: null },
];
const usingDefault = [
  { rate_type: "skill", ref_key: "30", name: "weather-query" },
  { rate_type: "skill", ref_key: "12", name: "alpha-skill" },
];

test("两份数据合成一张表，条数不多不少", () => {
  const rows = mergeRates(explicit, usingDefault, DEFAULTS);
  assert.equal(rows.length, 4);
});

test("模型排最前，且不会被继承行挤到后面", () => {
  // 生产数据就是这个形状：模型行全是显式设置的，skill/tool 大多在吃默认值。
  // 若「继承优先」压过「类型优先」，模型会被十几个 skill 顶到列表底部。
  const rows = mergeRates(
    [{ rate_type: "model", ref_key: "minimax-m3", coefficient: "0.7", note: null, name: null, updated_at: null }],
    usingDefault,
    DEFAULTS
  );
  assert.equal(rows[0].rateType, "model", "模型没排在最前");
});

test("类型顺序是 模型 → Skill → 工具", () => {
  const rows = mergeRates(
    [{ rate_type: "model", ref_key: "m", coefficient: "1", note: null, name: null, updated_at: null }],
    [{ rate_type: "tool", ref_key: "9", name: "t" }, { rate_type: "skill", ref_key: "8", name: "s" }],
    DEFAULTS
  );
  assert.deepEqual(rows.map((r) => r.rateType), ["model", "skill", "tool"]);
});

test("同一类型之内，继承默认的排前面", () => {
  const rows = mergeRates(
    [{ rate_type: "skill", ref_key: "31", coefficient: "2", note: null, name: "z-explicit", updated_at: null }],
    [{ rate_type: "skill", ref_key: "30", name: "weather-query" }],
    DEFAULTS
  );
  assert.deepEqual(
    rows.map((r) => r.isExplicit),
    [false, true],
    "组内把待办排到后面等于藏起来"
  );
});

test("继承行显示的是它此刻实际生效的值，不是写死的 1", () => {
  const rows = mergeRates([], [{ rate_type: "tool", ref_key: "9", name: "t" }], DEFAULTS);
  assert.equal(rows[0].coefficient, 2, "tool 的默认是 2，显示 1 就是在骗人");
});

test("翻不出实体名时回退显示 ref_key，不编造名字", () => {
  const rows = mergeRates(
    [{ rate_type: "model", ref_key: "minimax-m3", coefficient: "0.7", note: null, name: null, updated_at: null }],
    [], DEFAULTS
  );
  assert.equal(rows[0].label, "minimax-m3");
});

test("同档内先按类型、再按名称，顺序稳定", () => {
  const rows = mergeRates(explicit, usingDefault, DEFAULTS).filter((r) => !r.isExplicit);
  assert.deepEqual(rows.map((r) => r.label), ["alpha-skill", "weather-query"]);
});

test("0 标成「免费」而不是留白——它和「没设置」在库里是两回事", () => {
  const rows = mergeRates(explicit, usingDefault, DEFAULTS);
  const free = rows.find((r) => r.label === "pdf-to-dxf")!;
  assert.deepEqual(describeCoefficient(free), { value: "0", tag: "免费" });
});

test("继承行标「默认」，显式非零行不加标记", () => {
  const rows = mergeRates(explicit, usingDefault, DEFAULTS);
  assert.equal(describeCoefficient(rows.find((r) => r.label === "weather-query")!).tag, "默认");
  assert.equal(describeCoefficient(rows.find((r) => r.label === "mcp-search-tavily")!).tag, null);
});

test("显式设成 0 与继承到 0 的默认值，标记必须不同", () => {
  const zeroDefaults = { skill: 0 };
  const rows = mergeRates(
    [{ rate_type: "skill", ref_key: "1", coefficient: "0", note: null, name: "explicit-free", updated_at: null }],
    [{ rate_type: "skill", ref_key: "2", name: "just-unset" }],
    zeroDefaults
  );
  const a = describeCoefficient(rows.find((r) => r.label === "explicit-free")!);
  const b = describeCoefficient(rows.find((r) => r.label === "just-unset")!);
  assert.equal(a.value, b.value, "两者算出来的钱一样");
  assert.notEqual(a.tag, b.tag, "但含义相反，界面上必须分得开");
});

test("人写的备注保留，继承行没有备注", () => {
  const rows = mergeRates(explicit, usingDefault, DEFAULTS);
  assert.equal(rows.find((r) => r.label === "mcp-search-tavily")!.note, "手写备注");
  assert.equal(rows.find((r) => r.label === "weather-query")!.note, null);
});

test("类型筛选", () => {
  const rows = mergeRates(explicit, usingDefault, DEFAULTS);
  assert.equal(filterRates(rows, "all", "").length, 4);
  assert.equal(filterRates(rows, "skill", "").length, 3);
  assert.equal(filterRates(rows, "tool", "").length, 1);
});

test("搜索匹配名称，也匹配 ref_key——翻不出名字的行只能靠 key 找到", () => {
  const rows = mergeRates(explicit, usingDefault, DEFAULTS);
  assert.equal(filterRates(rows, "all", "weather")[0].label, "weather-query");
  assert.equal(filterRates(rows, "all", "WEATHER").length, 1, "搜索应忽略大小写");
  assert.equal(filterRates(rows, "all", "10")[0].label, "mcp-search-tavily");
});

test("筛选与搜索叠加时互不覆盖", () => {
  const rows = mergeRates(explicit, usingDefault, DEFAULTS);
  assert.equal(filterRates(rows, "tool", "weather").length, 0, "类型不符就该被排除");
});

test("计数覆盖全部类型，all 等于总数", () => {
  const c = countByType(mergeRates(explicit, usingDefault, DEFAULTS));
  assert.equal(c.all, 4);
  assert.equal(c.skill, 3);
  assert.equal(c.tool, 1);
});

test("空数据不炸", () => {
  assert.deepEqual(mergeRates([], [], {}), []);
  assert.deepEqual(countByType([]), { all: 0 });
});
