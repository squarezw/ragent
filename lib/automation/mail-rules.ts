/**
 * 邮件触发规则匹配的唯一实现（模块 D.6）。
 *
 * 服务端调度器（lib/cron/automation-scheduler.ts）与前端向导页
 * （app/automation/page.tsx，"use client"）都从这里取规则逻辑，因此
 * 「向导里预览的命中结果」与「调度器实际执行的结果」不可能分叉。
 *
 * 同构约束：本模块会被打进客户端 bundle，只允许纯 TypeScript 与纯函数，
 * 禁止引入 lib/env、pg、node:* 等仅服务端可用的依赖。
 */

export type MailRuleMode = "all" | "any";

/** 规范化字段清单：前端下拉与规则取值共用同一份。 */
export const MAIL_RULE_FIELDS = [
  "发件人",
  "发件人域名",
  "收件人",
  "邮件主题",
  "邮件正文",
  "是否包含附件",
  "附件名称",
  "附件类型",
] as const;

export type MailRuleField = (typeof MAIL_RULE_FIELDS)[number];

/** 规范化操作符清单。 */
export const MAIL_RULE_OPERATORS = [
  "等于",
  "包含",
  "不包含",
  "开头是",
  "结尾是",
  "是否存在",
] as const;

export type MailRuleOperator = (typeof MAIL_RULE_OPERATORS)[number];

/**
 * 单条规则。字段与操作符来自 JSON 配置，落库前未做运行时校验，
 * 因此类型上保持宽松（string），可选值由上面的两个清单约束。
 */
export type MailTriggerRule = {
  id?: string;
  field: string;
  operator: string;
  value?: string;
};

/** 参与匹配的邮件视图：调度器的 InboxMessage 与前端的测试邮件都是它的超集。 */
export type MailRuleMessage = {
  from?: string;
  to?: string;
  subject?: string;
  body?: string;
  attachments?: string[];
};

/**
 * 规范化后的规则集输入：调度器从 task.trigger_config 取，前端从 Automation 取，
 * 字段名不同但语义一致，各调用点自行组装，规则逻辑本身只有这一份。
 */
export type MailRuleSet = {
  rules?: readonly MailTriggerRule[] | null;
  mode?: MailRuleMode;
};

/** 规则列表兜底：配置来自 JSON，可能不是数组。 */
function mailRuleList(set: MailRuleSet): readonly MailTriggerRule[] {
  return Array.isArray(set.rules) ? set.rules : [];
}

/** 模式兜底：只认 "any"，其余（含缺省）一律按 "all" 处理。 */
function normalizeMailRuleMode(mode?: MailRuleMode): MailRuleMode {
  return mode === "any" ? "any" : "all";
}

/** 取发件人域名：第一个 @ 之后、到 > 空格 逗号 分号 为止，统一小写。 */
export function extractMailSenderDomain(value?: string) {
  const match = String(value || "").match(/@([^>\s,;]+)/);
  return match?.[1]?.toLowerCase() || "";
}

/** 取附件扩展名：逐个取末尾 .ext 并小写，无扩展名的忽略，空格连接。 */
export function mailAttachmentExtensions(names?: string[]) {
  return (Array.isArray(names) ? names : [])
    .map((name) => {
      const match = String(name)
        .toLowerCase()
        .match(/(\.[a-z0-9]+)$/i);
      return match?.[1] || "";
    })
    .filter(Boolean)
    .join(" ");
}

/** 按字段取出规则要比对的原始文本（保持原大小写，比较时统一小写）。 */
export function mailRuleSource(rule: MailTriggerRule, message: MailRuleMessage) {
  const attachments = Array.isArray(message.attachments) ? message.attachments : [];
  switch (rule.field) {
    case "发件人":
      return String(message.from || "");
    case "发件人域名":
      return extractMailSenderDomain(message.from);
    case "收件人":
      return String(message.to || "");
    case "邮件主题":
      return String(message.subject || "");
    case "邮件正文":
      return String(message.body || "");
    case "是否包含附件":
      return attachments.length > 0 ? "是" : "否";
    case "附件名称":
      return attachments.join(" ");
    case "附件类型":
      return mailAttachmentExtensions(attachments);
    default:
      return "";
  }
}

/**
 * 单条规则是否命中。
 *
 * 「是否存在」与「是否包含附件」走存在性判断：值为 否/false/0/no（或空缺省为是）
 * 表示期望不存在；其余操作符按文本比较，大小写不敏感，空值直接不命中。
 */
export function doesMailRuleMatch(rule: MailTriggerRule, message: MailRuleMessage) {
  const source = mailRuleSource(rule, message).toLowerCase();
  const wanted = String(rule.value || "")
    .trim()
    .toLowerCase();

  if (rule.operator === "是否存在" || rule.field === "是否包含附件") {
    const exists = rule.field === "是否包含附件" ? source === "是" : source.trim().length > 0;
    const wantExists = !["否", "false", "0", "no"].includes(wanted || "是");
    return exists === wantExists;
  }

  if (!wanted) return false;
  if (rule.operator === "等于") return source.trim() === wanted;
  if (rule.operator === "包含") return source.includes(wanted);
  if (rule.operator === "不包含") return !source.includes(wanted);
  if (rule.operator === "开头是") return source.startsWith(wanted);
  if (rule.operator === "结尾是") return source.endsWith(wanted);
  return false;
}

/** 规则集是否命中：无规则视为「收到新邮件即触发」；any 为任一命中，否则全部命中。 */
export function doesMailRuleSetMatch(set: MailRuleSet, message: MailRuleMessage) {
  const rules = mailRuleList(set);
  if (rules.length === 0) return true;
  const results = rules.map((rule) => doesMailRuleMatch(rule, message));
  const mode = normalizeMailRuleMode(set.mode);
  return mode === "any" ? results.some(Boolean) : results.every(Boolean);
}

/** 规则文案：存在性判断不带引号，其余带引号。 */
export function mailRuleText(rule: MailTriggerRule) {
  if (rule.operator === "是否存在" || rule.field === "是否包含附件") {
    return `${rule.field}${rule.value || "是"}`;
  }
  return `${rule.field}${rule.operator}“${rule.value || ""}”`;
}

/** 规则集摘要：向导与运行详情共用。 */
export function mailRulesSummary(set: MailRuleSet) {
  const rules = mailRuleList(set);
  if (rules.length === 0) return "收到新邮件即触发";
  const prefix = normalizeMailRuleMode(set.mode) === "any" ? "任一" : "全部";
  return `${prefix}：${rules.map(mailRuleText).join("；")}`;
}

/**
 * 规则集精简摘要：自动化**列表接口** triggerDetail 用的文案。
 *
 * 注意：它与 mailRulesSummary 的输出格式不同（只显示首条 + 条数，且不区分
 * 存在性判断），这是重构前 store.ts 里既有的行为，本次原样迁移、未做统一——
 * 统一会改变接口返回文案，属于行为变更，需另行决策。前端列表页不使用该字段，
 * 它由 localizedTriggerDetail 用 mailRulesSummary 重新生成。
 */
export function mailRulesBriefSummary(rules?: readonly Partial<MailTriggerRule>[] | null) {
  const list = Array.isArray(rules) ? rules : [];
  if (list.length === 0) return "收到新邮件即触发";

  const first: Partial<MailTriggerRule> = list[0] || {};
  const firstText = `${first.field || "邮件"}${first.operator || "包含"}${first.value ? `“${first.value}”` : ""}`;
  if (list.length === 1) return firstText;
  return `${firstText} 等 ${list.length} 条`;
}

/** 规则归一化键：字段|操作符|值（去空格 + 小写），用于比较两组规则是否等价。 */
export function normalizedMailRule(rule: MailTriggerRule) {
  return `${rule.field}|${rule.operator}|${String(rule.value || "")
    .trim()
    .toLowerCase()}`;
}

/** 两组规则是否等价：模式与条数相同，且归一化后逐条相同（与顺序无关）。 */
export function mailRuleSetsEqual(left: MailRuleSet, right: MailRuleSet) {
  const leftRules = mailRuleList(left);
  const rightRules = mailRuleList(right);

  if (
    normalizeMailRuleMode(left.mode) !== normalizeMailRuleMode(right.mode) ||
    leftRules.length !== rightRules.length
  ) {
    return false;
  }

  const leftKeys = leftRules.map(normalizedMailRule).sort();
  const rightKeys = rightRules.map(normalizedMailRule).sort();
  return leftKeys.every((value, index) => value === rightKeys[index]);
}

/** 前端冲突提示等级：任一侧没有规则、或规则完全相同，都视为高风险。 */
export function mailConflictLevel(current: MailRuleSet, other: MailRuleSet) {
  if (mailRuleList(current).length === 0 || mailRuleList(other).length === 0) return "high";
  if (mailRuleSetsEqual(current, other)) return "high";
  return "possible";
}
