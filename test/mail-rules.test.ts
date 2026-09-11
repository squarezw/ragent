import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import {
  MAIL_RULE_FIELDS,
  MAIL_RULE_OPERATORS,
  doesMailRuleMatch,
  doesMailRuleSetMatch,
  extractMailSenderDomain,
  mailAttachmentExtensions,
  mailConflictLevel,
  mailRuleSetsEqual,
  mailRuleSource,
  mailRulesBriefSummary,
  mailRulesSummary,
  mailRuleText,
  normalizedMailRule,
  type MailRuleMessage,
  type MailTriggerRule,
} from "../lib/automation/mail-rules.ts";

const message: MailRuleMessage = {
  from: "张三 <Zhang.San@Example.COM>",
  to: "sales@ragent.com",
  subject: "【询价】服务器采购 2026 Q3",
  body: "请报 10 台服务器的价格，详见附件。",
  attachments: ["报价单.XLSX", "清单", "readme.md"],
};

const emptyMessage: MailRuleMessage = {};

function rule(field: string, operator: string, value?: string): MailTriggerRule {
  return { field, operator, value };
}

// 除「是否包含附件」外的 7 个字段：它们的 source 由测试用例自行推导。
const VALUE_FIELDS = [
  "发件人",
  "发件人域名",
  "收件人",
  "邮件主题",
  "邮件正文",
  "附件名称",
  "附件类型",
] as const;

function sourceOf(field: string) {
  return mailRuleSource(rule(field, "包含"), message).toLowerCase();
}

test("MAIL_RULE_FIELDS / MAIL_RULE_OPERATORS: 规范化清单", () => {
  assert.deepEqual(
    [...MAIL_RULE_FIELDS],
    [
      "发件人",
      "发件人域名",
      "收件人",
      "邮件主题",
      "邮件正文",
      "是否包含附件",
      "附件名称",
      "附件类型",
    ]
  );
  assert.deepEqual(
    [...MAIL_RULE_OPERATORS],
    ["等于", "包含", "不包含", "开头是", "结尾是", "是否存在"]
  );
});

test("服务端白名单与向导下拉同源：store.ts 从本模块的清单派生，不再内联一份", () => {
  // 向导的下拉、提交、落库三处必须认同一份清单。store.ts 若再写一份字面量清单，新增字段就会
  // "向导里能选、能提交、写库时被 normalizeEmailRules 静默丢弃"——这正是 spec §十一
  // 「规则匹配逻辑单一来源，前后端行为不可能分叉」要防的分叉，而且没有任何报错入口。
  const source = readFileSync(join(process.cwd(), "lib/automation/store.ts"), "utf8");

  assert.match(
    source,
    /new Set<string>\(MAIL_RULE_FIELDS\)/,
    "字段白名单应当直接取自 MAIL_RULE_FIELDS"
  );
  assert.match(
    source,
    /new Set<string>\(MAIL_RULE_OPERATORS\)/,
    "操作符白名单应当直接取自 MAIL_RULE_OPERATORS"
  );
  assert.doesNotMatch(
    source,
    /new Set\([^)]*"发件人"/,
    "白名单里又出现了内联的字段字面量：它必然与向导下拉分叉"
  );
  assert.doesNotMatch(
    source,
    /new Set\([^)]*"等于"/,
    "白名单里又出现了内联的操作符字面量：它必然与向导下拉分叉"
  );
});

test("mailRuleSource: 各字段取值", () => {
  assert.equal(mailRuleSource(rule("发件人", "包含"), message), "张三 <Zhang.San@Example.COM>");
  assert.equal(mailRuleSource(rule("发件人域名", "包含"), message), "example.com");
  assert.equal(mailRuleSource(rule("收件人", "包含"), message), "sales@ragent.com");
  assert.equal(mailRuleSource(rule("邮件主题", "包含"), message), "【询价】服务器采购 2026 Q3");
  assert.equal(
    mailRuleSource(rule("邮件正文", "包含"), message),
    "请报 10 台服务器的价格，详见附件。"
  );
  assert.equal(mailRuleSource(rule("是否包含附件", "包含"), message), "是");
  assert.equal(mailRuleSource(rule("附件名称", "包含"), message), "报价单.XLSX 清单 readme.md");
  assert.equal(mailRuleSource(rule("附件类型", "包含"), message), ".xlsx .md");
});

test("mailRuleSource: 未知字段返回空串（默认值保持原逻辑）", () => {
  assert.equal(mailRuleSource(rule("未知字段", "包含"), message), "");
});

test("mailRuleSource: 空邮件与缺字段均取空值或否定值", () => {
  assert.equal(mailRuleSource(rule("发件人", "包含"), emptyMessage), "");
  assert.equal(mailRuleSource(rule("收件人", "包含"), emptyMessage), "");
  assert.equal(mailRuleSource(rule("邮件主题", "包含"), emptyMessage), "");
  assert.equal(mailRuleSource(rule("邮件正文", "包含"), emptyMessage), "");
  assert.equal(mailRuleSource(rule("是否包含附件", "包含"), emptyMessage), "否");
  assert.equal(mailRuleSource(rule("附件名称", "包含"), emptyMessage), "");
  assert.equal(mailRuleSource(rule("附件类型", "包含"), emptyMessage), "");
  assert.equal(mailRuleSource(rule("是否包含附件", "包含"), { attachments: [] }), "否");
  assert.equal(mailRuleSource(rule("附件名称", "包含"), { attachments: undefined }), "");
});

test("extractMailSenderDomain: 取第一个 @ 之后的域名并小写", () => {
  assert.equal(extractMailSenderDomain("a@b.com"), "b.com");
  assert.equal(extractMailSenderDomain("张三 <Zhang.San@Example.COM>"), "example.com");
  assert.equal(extractMailSenderDomain("A@B.com; C@D.com"), "b.com");
  assert.equal(extractMailSenderDomain("A@B.com,"), "b.com");
  assert.equal(extractMailSenderDomain("A@B.com>"), "b.com");
});

test("extractMailSenderDomain: 无 @ 或空值返回空串", () => {
  assert.equal(extractMailSenderDomain("没有邮箱"), "");
  assert.equal(extractMailSenderDomain(""), "");
  assert.equal(extractMailSenderDomain(undefined), "");
});

test("mailAttachmentExtensions: 逐个小写提取末尾扩展名", () => {
  assert.equal(mailAttachmentExtensions(["报价单.XLSX", "清单", "readme.md"]), ".xlsx .md");
  assert.equal(mailAttachmentExtensions(["A.PDF", "B.DocX"]), ".pdf .docx");
  assert.equal(mailAttachmentExtensions(["无扩展名", "尾部是点."]), "");
  assert.equal(mailAttachmentExtensions([]), "");
  assert.equal(mailAttachmentExtensions(undefined), "");
});

test("doesMailRuleMatch: 各字段 × 各操作符 —— 命中", () => {
  for (const field of VALUE_FIELDS) {
    const source = sourceOf(field);
    assert.equal(
      doesMailRuleMatch(rule(field, "等于", source), message),
      true,
      `${field} 等于 应命中`
    );
    assert.equal(
      doesMailRuleMatch(rule(field, "包含", source.slice(0, 4)), message),
      true,
      `${field} 包含 应命中`
    );
    assert.equal(
      doesMailRuleMatch(rule(field, "不包含", "zzz-不存在-zzz"), message),
      true,
      `${field} 不包含 应命中`
    );
    assert.equal(
      doesMailRuleMatch(rule(field, "开头是", source.slice(0, 4)), message),
      true,
      `${field} 开头是 应命中`
    );
    assert.equal(
      doesMailRuleMatch(rule(field, "结尾是", source.slice(-4)), message),
      true,
      `${field} 结尾是 应命中`
    );
    assert.equal(
      doesMailRuleMatch(rule(field, "是否存在", ""), message),
      true,
      `${field} 是否存在 应命中`
    );
  }
});

test("doesMailRuleMatch: 各字段 × 各操作符 —— 未命中", () => {
  for (const field of VALUE_FIELDS) {
    const source = sourceOf(field);
    for (const operator of ["等于", "包含", "开头是", "结尾是"] as const) {
      assert.equal(
        doesMailRuleMatch(rule(field, operator, "绝不匹配的内容zzz"), message),
        false,
        `${field} ${operator} 不应命中`
      );
    }
    assert.equal(
      doesMailRuleMatch(rule(field, "不包含", source.slice(0, 4)), message),
      false,
      `${field} 不包含 不应命中`
    );
    assert.equal(
      doesMailRuleMatch(rule(field, "是否存在", "否"), message),
      false,
      `${field} 是否存在 否 不应命中`
    );
  }
});

test("doesMailRuleMatch: 未知操作符一律不命中", () => {
  assert.equal(doesMailRuleMatch(rule("邮件主题", "正则匹配", "询价"), message), false);
});

test("doesMailRuleMatch: 是否包含附件强制按存在性判断，忽略操作符", () => {
  for (const operator of MAIL_RULE_OPERATORS) {
    assert.equal(
      doesMailRuleMatch(rule("是否包含附件", operator, "是"), message),
      true,
      `${operator} + 是 应命中`
    );
    assert.equal(
      doesMailRuleMatch(rule("是否包含附件", operator, ""), message),
      true,
      `${operator} + 空值（默认是）应命中`
    );
    assert.equal(
      doesMailRuleMatch(rule("是否包含附件", operator, "否"), message),
      false,
      `${operator} + 否 不应命中`
    );
  }
});

test("是否存在: 否定取值判定为「不期望存在」", () => {
  for (const value of ["否", "false", "0", "no", "NO", "False"]) {
    assert.equal(
      doesMailRuleMatch(rule("邮件主题", "是否存在", value), message),
      false,
      `${value} 应判定为不期望存在`
    );
  }
  for (const value of ["是", "true", "1", "yes", "任意其他"]) {
    assert.equal(
      doesMailRuleMatch(rule("邮件主题", "是否存在", value), message),
      true,
      `${value} 应判定为期望存在`
    );
  }
});

test("是否存在: 空值字段（邮箱缺失）判定为不存在", () => {
  assert.equal(doesMailRuleMatch(rule("发件人域名", "是否存在", "是"), emptyMessage), false);
  assert.equal(doesMailRuleMatch(rule("发件人域名", "是否存在", "否"), emptyMessage), true);
});

test("是否包含附件: 无附件时按不存在处理", () => {
  assert.equal(doesMailRuleMatch(rule("是否包含附件", "是否存在", "是"), emptyMessage), false);
  assert.equal(doesMailRuleMatch(rule("是否包含附件", "是否存在", "否"), emptyMessage), true);
});

test("边界值: 空值/缺失值的规则一律不命中", () => {
  assert.equal(doesMailRuleMatch(rule("邮件主题", "包含", ""), message), false);
  assert.equal(doesMailRuleMatch(rule("邮件主题", "包含", "   "), message), false);
  assert.equal(doesMailRuleMatch(rule("邮件主题", "包含"), message), false);
  // 空值在「不包含」上同样直接判定为不命中（守卫先于操作符分派，保持原逻辑）。
  assert.equal(doesMailRuleMatch(rule("邮件主题", "不包含", ""), message), false);
  assert.equal(doesMailRuleMatch(rule("邮件主题", "等于", ""), message), false);
  assert.equal(doesMailRuleMatch(rule("邮件主题", "开头是", "   "), message), false);
});

test("大小写: 字段值与规则值均按小写比较", () => {
  assert.equal(doesMailRuleMatch(rule("发件人", "包含", "ZHANG.SAN"), message), true);
  assert.equal(
    doesMailRuleMatch(rule("发件人", "等于", "张三 <ZHANG.SAN@EXAMPLE.COM>"), message),
    true
  );
  assert.equal(doesMailRuleMatch(rule("邮件主题", "结尾是", "q3"), message), true);
  assert.equal(doesMailRuleMatch(rule("附件名称", "包含", ".XLSX"), message), true);
  assert.equal(doesMailRuleMatch(rule("发件人", "包含", "zhang.san@example.org"), message), false);
});

test("附件类型: 通过扩展名匹配", () => {
  assert.equal(doesMailRuleMatch(rule("附件类型", "包含", ".md"), message), true);
  assert.equal(doesMailRuleMatch(rule("附件类型", "等于", ".xlsx .md"), message), true);
  assert.equal(doesMailRuleMatch(rule("附件类型", "包含", ".docx"), message), false);
});

test("doesMailRuleSetMatch: 空规则集恒命中（与模式无关）", () => {
  assert.equal(doesMailRuleSetMatch({ rules: [] }, message), true);
  assert.equal(doesMailRuleSetMatch({ rules: [], mode: "any" }, message), true);
  assert.equal(doesMailRuleSetMatch({ rules: null }, message), true);
  assert.equal(doesMailRuleSetMatch({}, message), true);
});

test("doesMailRuleSetMatch: AND 模式（all）", () => {
  const hit = rule("邮件主题", "包含", "询价");
  const hit2 = rule("发件人域名", "等于", "example.com");
  const miss = rule("收件人", "包含", "不存在的收件人");

  assert.equal(doesMailRuleSetMatch({ rules: [hit, hit2], mode: "all" }, message), true);
  assert.equal(doesMailRuleSetMatch({ rules: [hit, hit2] }, message), true);
  assert.equal(doesMailRuleSetMatch({ rules: [hit, miss], mode: "all" }, message), false);
  assert.equal(doesMailRuleSetMatch({ rules: [hit, miss] }, message), false);
});

test("doesMailRuleSetMatch: OR 模式（any）", () => {
  const hit = rule("邮件主题", "包含", "询价");
  const miss = rule("收件人", "包含", "不存在的收件人");
  const miss2 = rule("附件类型", "包含", ".docx");

  assert.equal(doesMailRuleSetMatch({ rules: [hit, miss], mode: "any" }, message), true);
  assert.equal(doesMailRuleSetMatch({ rules: [miss, miss2], mode: "any" }, message), false);
});

test("doesMailRuleSetMatch: 规则集缺失/非数组时视为无规则", () => {
  assert.equal(doesMailRuleSetMatch({ rules: undefined, mode: "any" }, message), true);
  assert.equal(
    doesMailRuleSetMatch({ rules: "not-an-array" as unknown as MailTriggerRule[] }, message),
    true
  );
});

test("mailRuleText: 普通操作符带引号，存在性判断不加引号", () => {
  assert.equal(
    mailRuleText(rule("发件人域名", "等于", "example.com")),
    "发件人域名等于“example.com”"
  );
  assert.equal(mailRuleText(rule("邮件主题", "包含", "询价")), "邮件主题包含“询价”");
  assert.equal(mailRuleText(rule("邮件主题", "是否存在", "否")), "邮件主题否");
  assert.equal(mailRuleText(rule("邮件主题", "是否存在", "")), "邮件主题是");
});

test("mailRuleText: 是否包含附件字段同样按存在性文案渲染", () => {
  assert.equal(mailRuleText(rule("是否包含附件", "包含", "是")), "是否包含附件是");
  assert.equal(mailRuleText(rule("是否包含附件", "包含", "否")), "是否包含附件否");
  assert.equal(mailRuleText(rule("是否包含附件", "包含")), "是否包含附件是");
});

test("mailRuleText: 值缺失时渲染为空串而非 undefined", () => {
  assert.equal(mailRuleText(rule("邮件主题", "包含")), "邮件主题包含“”");
  assert.equal(mailRuleText(rule("邮件主题", "包含", "")), "邮件主题包含“”");
});

test("mailRulesSummary: 无规则时提示收到即触发", () => {
  assert.equal(mailRulesSummary({ rules: [] }), "收到新邮件即触发");
  assert.equal(mailRulesSummary({ rules: [], mode: "any" }), "收到新邮件即触发");
  assert.equal(mailRulesSummary({}), "收到新邮件即触发");
});

test("mailRulesSummary: 全部/任一前缀与多条规则的连接", () => {
  const first = rule("邮件主题", "包含", "询价");
  const second = rule("发件人域名", "等于", "example.com");

  assert.equal(mailRulesSummary({ rules: [first], mode: "all" }), "全部：邮件主题包含“询价”");
  assert.equal(mailRulesSummary({ rules: [first] }), "全部：邮件主题包含“询价”");
  assert.equal(mailRulesSummary({ rules: [first], mode: "any" }), "任一：邮件主题包含“询价”");
  assert.equal(
    mailRulesSummary({ rules: [first, second], mode: "all" }),
    "全部：邮件主题包含“询价”；发件人域名等于“example.com”"
  );
  assert.equal(
    mailRulesSummary({ rules: [first, second], mode: "any" }),
    "任一：邮件主题包含“询价”；发件人域名等于“example.com”"
  );
});

test("mailRulesBriefSummary: 列表接口 triggerDetail 用的精简摘要（保留原有格式）", () => {
  // 该格式与 mailRulesSummary 不同（只展示首条 + 条数），是重构前 store.ts
  // 既有行为，本次原样迁移、未统一，避免改变接口返回文案。
  const first = rule("邮件主题", "包含", "询价");
  const second = rule("发件人域名", "等于", "example.com");

  assert.equal(mailRulesBriefSummary([]), "收到新邮件即触发");
  assert.equal(mailRulesBriefSummary(null), "收到新邮件即触发");
  assert.equal(mailRulesBriefSummary(undefined), "收到新邮件即触发");
  assert.equal(mailRulesBriefSummary([first]), "邮件主题包含“询价”");
  assert.equal(mailRulesBriefSummary([first, second]), "邮件主题包含“询价” 等 2 条");
});

test("mailRulesBriefSummary: 空值规则与缺省字段的兜底", () => {
  assert.equal(mailRulesBriefSummary([rule("邮件主题", "包含", "")]), "邮件主题包含");
  assert.equal(mailRulesBriefSummary([rule("", "")]), "邮件包含");
});

test("mailRulesBriefSummary 与 mailRulesSummary 的差异（存在性字段）", () => {
  const exists = rule("是否包含附件", "是否存在", "是");
  assert.equal(mailRulesBriefSummary([exists]), "是否包含附件是否存在“是”");
  assert.equal(mailRulesSummary({ rules: [exists], mode: "all" }), "全部：是否包含附件是");
});

test("normalizedMailRule: 字段|操作符|值（去空格 + 小写）", () => {
  assert.equal(normalizedMailRule(rule("邮件主题", "包含", "  询价  ")), "邮件主题|包含|询价");
  assert.equal(
    normalizedMailRule(rule("发件人域名", "等于", "Example.COM")),
    "发件人域名|等于|example.com"
  );
  assert.equal(normalizedMailRule(rule("邮件主题", "包含")), "邮件主题|包含|");
});

test("mailRuleSetsEqual: 规则顺序无关，值的大小写与空格无关", () => {
  const left = rule("邮件主题", "包含", "询价");
  const right = rule("发件人域名", "等于", "example.com");

  assert.equal(
    mailRuleSetsEqual({ rules: [left, right], mode: "all" }, { rules: [right, left], mode: "all" }),
    true
  );
  assert.equal(
    mailRuleSetsEqual(
      { rules: [rule("邮件主题", "包含", " 询价 ")], mode: "all" },
      { rules: [rule("邮件主题", "包含", "询价")], mode: "all" }
    ),
    true
  );
});

test("mailRuleSetsEqual: 模式、条数、内容不同均判定为不相等", () => {
  const left = rule("邮件主题", "包含", "询价");
  const right = rule("发件人域名", "等于", "example.com");

  assert.equal(
    mailRuleSetsEqual({ rules: [left], mode: "all" }, { rules: [left], mode: "any" }),
    false
  );
  assert.equal(
    mailRuleSetsEqual({ rules: [left], mode: "all" }, { rules: [left, right], mode: "all" }),
    false
  );
  assert.equal(
    mailRuleSetsEqual({ rules: [left], mode: "all" }, { rules: [right], mode: "all" }),
    false
  );
  assert.equal(mailRuleSetsEqual({ rules: [], mode: "all" }, { rules: [], mode: "all" }), true);
});

test("mailRuleSetsEqual: 模式缺省按 all 处理", () => {
  const left = rule("邮件主题", "包含", "询价");
  assert.equal(mailRuleSetsEqual({ rules: [left] }, { rules: [left], mode: "all" }), true);
  assert.equal(mailRuleSetsEqual({ rules: [left] }, { rules: [left], mode: "any" }), false);
});

test("mailConflictLevel: 任一侧无规则视为高风险冲突", () => {
  const left = rule("邮件主题", "包含", "询价");
  assert.equal(
    mailConflictLevel({ rules: [], mode: "all" }, { rules: [left], mode: "all" }),
    "high"
  );
  assert.equal(
    mailConflictLevel({ rules: [left], mode: "all" }, { rules: [], mode: "all" }),
    "high"
  );
  assert.equal(mailConflictLevel({ rules: [] }, {}), "high");
});

test("mailConflictLevel: 规则集完全相同为高风险，否则为可能冲突", () => {
  const left = rule("邮件主题", "包含", "询价");
  const other = rule("发件人域名", "等于", "example.com");

  assert.equal(
    mailConflictLevel({ rules: [left], mode: "all" }, { rules: [left], mode: "all" }),
    "high"
  );
  assert.equal(
    mailConflictLevel({ rules: [left], mode: "all" }, { rules: [other], mode: "all" }),
    "possible"
  );
  assert.equal(
    mailConflictLevel({ rules: [left], mode: "all" }, { rules: [left], mode: "any" }),
    "possible"
  );
});
