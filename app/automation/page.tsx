"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import axios from "@/lib/axios";
import { toast } from "sonner";
import { useLocale } from "next-intl";
import {
  Bell,
  Clock3,
  Mail,
  Webhook,
  GitBranch,
  LayoutGrid,
  List,
  Play,
  Pencil,
  Search,
  Trash2,
  X,
} from "lucide-react";

type AutomationStatus = "running" | "paused" | "error";
type RunStatus =
  | "success"
  | "failed"
  | "running"
  | "pending"
  | "regenerating"
  | "action_running"
  | "rejected"
  | "timed_out";
type TriggerType = "定时触发" | "邮件触发" | "Webhook / API" | "自动化完成触发";
type StrategyType = "仅生成结果" | "需要确认后执行" | "自动执行";
type MailRuleMode = "all" | "any";
type MailRuleField =
  | "发件人"
  | "发件人域名"
  | "收件人"
  | "邮件主题"
  | "邮件正文"
  | "是否包含附件"
  | "附件名称"
  | "附件类型";
type MailRuleOperator = "等于" | "包含" | "不包含" | "开头是" | "结尾是" | "是否存在";
interface MailTriggerRule {
  id: string;
  field: MailRuleField;
  operator: MailRuleOperator;
  value: string;
}

type MailRuleTestMessage = {
  from: string;
  to: string;
  subject: string;
  body: string;
  attachments: string[];
};

interface AppOption {
  id: number;
  name: string;
}

interface ConnectedMailbox {
  id: number;
  key: string;
  name: string;
  email: string;
  username: string;
  imapHost: string;
  imapPort: number;
  imapSecure: boolean;
  folder: string;
  status: string;
  label: string;
}

interface Automation {
  id: number;
  name: string;
  trigger: TriggerType;
  triggerDetail: string;
  appId: number | null;
  agent: string;
  strategy: StrategyType;
  status: AutomationStatus;
  statusText: string;
  time: string;
  task: string;
  returnDetail: string;
  resultEmail?: string;
  resultEmailIncludeAttachments?: boolean;
  callbackUrl?: string;
  callbackTiming?: string;
  callbackAuth?: string;
  callbackCredential?: string;
  schedulePeriod?: string;
  scheduleTime?: string;
  scheduleTimezone?: string;
  scheduleWeekdays?: number[];
  scheduleMonthlyMode?: "fixed_day" | "last_day";
  scheduleDayOfMonth?: number;
  scheduleMissingDayPolicy?: "last_day" | "skip";
  scheduleDate?: string;
  mailboxKey?: string;
  mailboxLabel?: string;
  mailFolder?: string;
  mailRuleMode?: MailRuleMode;
  mailRules?: MailTriggerRule[];
  mailPriority?: number;
  upstreamAutomationId?: number | null;
  upstreamCondition?: string;
  passPreviousResult?: boolean;
}

interface AutomationTemplate {
  id: string;
  name: string;
  description: string;
  trigger: TriggerType;
  strategy: StrategyType;
  task: string;
}

interface RunRecord {
  id: number;
  time: string;
  name: string;
  trigger: string;
  agent: string;
  status: RunStatus;
  statusText: string;
  duration: string;
  result?: string;
  error?: string;
  automationId?: number;
  aiResult?: string;
  reviewContent?: string;
  finalResult?: string;
  resultAttachments?: Array<{ filename: string; object_key?: string; content_type?: string; size?: number }>;
  aiVersion?: number;
  reviewStatus?: "not_required" | "not_started" | "pending" | "approved" | "rejected";
  reviewerUserId?: number;
  reviewedAt?: string;
  rejectionReason?: string;
  actionStatus?: string;
  strategy?: StrategyType;
  taskSnapshot?: string;
  resultConfigSnapshot?: Record<string, any>;
  triggerContext?: Record<string, any>;
  createdAt?: string;
  updatedAt?: string;
}

interface ReviewHistoryItem {
  id: number;
  eventType: string;
  aiVersion?: number;
  content?: string;
  note?: string;
  actorUserId?: number;
  createdAt: string;
}

interface RunActionItem {
  id: number;
  runId: number;
  key: string;
  type: "email" | "result_url" | string;
  status: "pending" | "running" | "success" | "failed" | string;
  attemptCount?: number;
  config?: Record<string, any>;
  result?: Record<string, any>;
  error?: string;
  startedAt?: string;
  finishedAt?: string;
}

interface AutomationNotification {
  eventKey: string;
  kind:
    | "pending_review"
    | "run_failed"
    | "run_timed_out"
    | "run_success"
    | "email_failed"
    | "result_url_failed";
  level: "strong" | "normal";
  title: string;
  message: string;
  automationId?: number | null;
  runId: number;
  createdAt: string;
  read: boolean;
  readAt?: string;
}

type EmailRoutingOutcome = "triggered" | "suppressed_by_priority" | "not_matched" | "duplicate";

interface EmailRoutingEvent {
  id: number;
  mailboxKey?: string;
  messageKey?: string;
  messageUid?: number;
  automationId: number;
  outcome: EmailRoutingOutcome;
  winnerAutomationId?: number;
  matchedRule?: string;
  priority?: number;
  from?: string;
  to?: string;
  subject?: string;
  date?: string;
  createdAt?: string;
}

interface EmailRoutingStats {
  scanned: number;
  matched: number;
  triggered: number;
  suppressed: number;
  notMatched: number;
  duplicate: number;
  recent: EmailRoutingEvent[];
}

const emptyEmailRoutingStats: EmailRoutingStats = {
  scanned: 0,
  matched: 0,
  triggered: 0,
  suppressed: 0,
  notMatched: 0,
  duplicate: 0,
  recent: [],
};

const CHAIN_PROCESSED_STORAGE_KEY = "ragent_chain_processed_runs_v1";
const WEBHOOK_POLL_INTERVAL_MS = 5000;

function defaultImapHost(email: string) {
  const domain = String(email || "").trim().toLowerCase().split("@")[1] || "";
  if (domain === "qq.com") return "imap.qq.com";
  if (domain === "163.com") return "imap.163.com";
  if (domain === "126.com") return "imap.126.com";
  if (domain === "gmail.com") return "imap.gmail.com";
  if (domain === "outlook.com" || domain === "hotmail.com") return "outlook.office365.com";
  return domain ? `imap.${domain}` : "";
}

const MAIL_RULE_FIELDS: MailRuleField[] = [
  "发件人",
  "发件人域名",
  "收件人",
  "邮件主题",
  "邮件正文",
  "是否包含附件",
  "附件名称",
  "附件类型",
];
const MAIL_RULE_OPERATORS: MailRuleOperator[] = ["等于", "包含", "不包含", "开头是", "结尾是", "是否存在"];

function newMailRule(): MailTriggerRule {
  return {
    id: `mail-rule-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    field: "邮件主题",
    operator: "包含",
    value: "",
  };
}

function mailRuleText(rule: MailTriggerRule) {
  if (rule.operator === "是否存在" || rule.field === "是否包含附件") {
    return `${rule.field}${rule.value || "是"}`;
  }
  return `${rule.field}${rule.operator}“${rule.value}”`;
}

function mailRulesSummary(item: Automation) {
  const rules = Array.isArray(item.mailRules) ? item.mailRules : [];
  if (rules.length === 0) return "收到新邮件即触发";
  const prefix = item.mailRuleMode === "any" ? "任一" : "全部";
  return `${prefix}：${rules.map(mailRuleText).join("；")}`;
}

function normalizedMailRule(rule: MailTriggerRule) {
  return `${rule.field}|${rule.operator}|${String(rule.value || "").trim().toLowerCase()}`;
}

function mailRuleSetsEqual(
  leftRules: MailTriggerRule[],
  leftMode: MailRuleMode,
  rightRules: MailTriggerRule[],
  rightMode: MailRuleMode,
) {
  if (leftMode !== rightMode || leftRules.length !== rightRules.length) return false;
  const left = leftRules.map(normalizedMailRule).sort();
  const right = rightRules.map(normalizedMailRule).sort();
  return left.every((value, index) => value === right[index]);
}

function mailConflictLevel(
  currentRules: MailTriggerRule[],
  currentMode: MailRuleMode,
  other: Automation,
): "high" | "possible" {
  const otherRules = Array.isArray(other.mailRules) ? other.mailRules : [];
  const otherMode = other.mailRuleMode === "any" ? "any" : "all";

  if (currentRules.length === 0 || otherRules.length === 0) return "high";
  if (mailRuleSetsEqual(currentRules, currentMode, otherRules, otherMode)) return "high";
  return "possible";
}

function mailFolderDisplay(value: unknown) {
  const folder = String(value || "INBOX").trim() || "INBOX";
  return folder.toUpperCase() === "INBOX" ? "收件箱（INBOX）" : folder;
}

function emailSourceDisplay(value: unknown) {
  return String(value || "") === "email-server" ? "服务端邮件监听" : "邮件触发";
}

function emailContextText(value: unknown, fallback = "-") {
  const text = String(value ?? "").trim();
  return text || fallback;
}

function extractMailSenderDomain(value?: string) {
  const match = String(value || "").match(/@([^>\s,;]+)/);
  return match?.[1]?.toLowerCase() || "";
}

function mailAttachmentExtensions(names?: string[]) {
  return (Array.isArray(names) ? names : [])
    .map((item) => {
      const match = String(item).toLowerCase().match(/(\.[a-z0-9]+)$/i);
      return match?.[1] || "";
    })
    .filter(Boolean)
    .join(" ");
}

function mailRuleTestSource(rule: MailTriggerRule, message: MailRuleTestMessage) {
  const attachments = Array.isArray(message.attachments) ? message.attachments : [];
  switch (rule.field) {
    case "发件人": return String(message.from || "");
    case "发件人域名": return extractMailSenderDomain(message.from);
    case "收件人": return String(message.to || "");
    case "邮件主题": return String(message.subject || "");
    case "邮件正文": return String(message.body || "");
    case "是否包含附件": return attachments.length > 0 ? "是" : "否";
    case "附件名称": return attachments.join(" ");
    case "附件类型": return mailAttachmentExtensions(attachments);
    default: return "";
  }
}

function doesMailRuleTestMatch(rule: MailTriggerRule, message: MailRuleTestMessage) {
  const source = mailRuleTestSource(rule, message).toLowerCase();
  const wanted = String(rule.value || "").trim().toLowerCase();

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

function doMailRulesTestMatch(
  rules: MailTriggerRule[],
  mode: MailRuleMode,
  message: MailRuleTestMessage,
) {
  if (rules.length === 0) return true;
  const results = rules.map((rule) => doesMailRuleTestMatch(rule, message));
  return mode === "any" ? results.some(Boolean) : results.every(Boolean);
}

function splitMailTestAttachments(value: string) {
  return String(value || "")
    .split(/[\n,，]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

const initialAutomations: Automation[] = [];

const automationTemplates: AutomationTemplate[] = [
  {
    id: "daily-operation-report",
    name: "每日经营日报",
    description: "按固定时间汇总经营数据，识别异常指标并生成管理摘要。",
    trigger: "定时触发",
    strategy: "自动执行",
    task: "汇总前一日经营数据，识别异常指标并生成经营摘要。",
  },
  {
    id: "customer-inquiry-mail",
    name: "客户询价处理",
    description: "系统邮箱收到新邮件后，由数字员工提取客户需求并生成处理建议。",
    trigger: "邮件触发",
    strategy: "自动执行",
    task: "读取新邮件中的发件人、主题、正文和附件信息，提取客户需求、产品、数量与交期，并生成清晰的处理建议。",
  },
  {
    id: "order-risk-check",
    name: "订单风险检测",
    description: "由 ERP、CRM 等业务系统通过 Webhook/API 触发订单风险检查。",
    trigger: "Webhook / API",
    strategy: "仅生成结果",
    task: "对新订单进行客户风险和订单异常检查，输出风险等级、风险原因和建议处理方式。",
  },
  {
    id: "sales-result-analysis",
    name: "销售日报分析",
    description: "在上游自动化完成后继续分析结果，形成进一步的管理摘要。",
    trigger: "自动化完成触发",
    strategy: "自动执行",
    task: "接收上一自动化的执行结果，对销售表现进行进一步分析并形成管理摘要。",
  },
  {
    id: "complaint-processing",
    name: "售后投诉处理",
    description: "系统邮箱收到售后邮件后自动分析投诉内容并输出处理建议。",
    trigger: "邮件触发",
    strategy: "需要确认后执行",
    task: "分析新收到的售后邮件，识别投诉类型、紧急程度和核心诉求，并生成建议处理方案。",
  },
  {
    id: "inventory-check",
    name: "库存异常检查",
    description: "定时检查库存异常与低库存商品，并输出需要关注的 SKU。",
    trigger: "定时触发",
    strategy: "自动执行",
    task: "检查库存异常与低库存商品，输出需要关注的 SKU、异常原因和建议处理动作。",
  },
];

const AUTOMATION_TEMPLATE_EN: Record<
  string,
  { name: string; description: string; task: string }
> = {
  "daily-operation-report": {
    name: "Daily Operations Report",
    description: "Summarize operational data on a schedule, identify anomalies, and generate a management brief.",
    task: "Summarize the previous day's operational data, identify anomalies, and generate an operations brief.",
  },
  "customer-inquiry-mail": {
    name: "Customer Inquiry Processing",
    description: "When the system mailbox receives a new email, a digital employee extracts customer needs and generates handling suggestions.",
    task: "Read the sender, subject, body, and attachment information from the new email. Extract customer needs, products, quantity, and delivery date, then generate clear handling suggestions.",
  },
  "order-risk-check": {
    name: "Order Risk Check",
    description: "Trigger an order risk check from ERP, CRM, or other business systems through Webhook/API.",
    task: "Check the new order for customer risk and order anomalies. Output the risk level, reasons, and recommended actions.",
  },
  "sales-result-analysis": {
    name: "Sales Report Analysis",
    description: "Continue analyzing the result after an upstream automation completes and generate a management summary.",
    task: "Receive the result of the previous automation, analyze sales performance further, and generate a management summary.",
  },
  "complaint-processing": {
    name: "After-sales Complaint Processing",
    description: "Automatically analyze after-sales emails received by the system mailbox and generate handling suggestions.",
    task: "Analyze the newly received after-sales email, identify the complaint type, urgency, and core request, and generate a recommended handling plan.",
  },
  "inventory-check": {
    name: "Inventory Exception Check",
    description: "Check inventory exceptions and low-stock items on a schedule and list the SKUs that need attention.",
    task: "Check inventory exceptions and low-stock items. Output the relevant SKUs, causes, and recommended actions.",
  },
};

const LEGACY_DEMO_AUTOMATION_NAMES = new Set([
  "每日经营日报",
  "客户询价处理",
  "订单风险检测",
  "销售日报分析",
  "售后投诉分级",
  "库存异常检查",
]);

const initialRunRecords: RunRecord[] = [];
function StatusBadge({ status, text }: { status: AutomationStatus | RunStatus; text: string }) {
  const cls =
    status === "running" || status === "success"
      ? "bg-emerald-50 text-emerald-700"
      : status === "paused"
        ? "bg-slate-100 text-slate-600"
        : status === "pending" || status === "regenerating" || status === "action_running"
          ? "bg-amber-50 text-amber-700"
          : "bg-red-50 text-red-700";

  return <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${cls}`}>{text}</span>;
}

function TriggerIcon({ trigger }: { trigger: TriggerType }) {
  const cls = "h-4 w-4";
  if (trigger === "定时触发") return <Clock3 className={cls} />;
  if (trigger === "邮件触发") return <Mail className={cls} />;
  if (trigger === "Webhook / API") return <Webhook className={cls} />;
  return <GitBranch className={cls} />;
}

export default function AutomationPage() {
  const locale = useLocale();
  const isEnglish = locale.toLowerCase().startsWith("en");
  const tt = (zh: string, en: string) => (isEnglish ? en : zh);

  const triggerLabel = (value: string) => {
    if (value === "定时触发") return tt("定时触发", "Scheduled");
    if (value === "邮件触发") return tt("邮件触发", "Email");
    if (value === "自动化完成触发") return tt("自动化完成触发", "Automation Completed");
    if (value === "手动触发") return tt("手动触发", "Manual");
    return value;
  };

  const strategyLabel = (value: string) => {
    if (value === "仅生成结果") return tt("仅生成结果", "Generate Result Only");
    if (value === "需要确认后执行") return tt("需要确认后执行", "Require Confirmation");
    if (value === "自动执行") return tt("自动执行", "Auto Execute");
    return value;
  };

  const statusLabel = (text: string, status?: AutomationStatus | RunStatus) => {
    const map: Record<string, string> = {
      "运行中": "Running",
      "已暂停": "Paused",
      "异常": "Error",
      "待审核": "Pending Review",
      "执行中": "Running",
      "重新生成中": "Regenerating",
      "执行后续操作": "Running Actions",
      "成功": "Success",
      "失败": "Failed",
      "已驳回": "Rejected",
      "已超时": "Timed Out",
    };
    if (isEnglish && map[text]) return map[text];
    if (!isEnglish) return text;
    if (status === "success") return "Success";
    if (status === "failed") return "Failed";
    if (status === "running") return "Running";
    if (status === "pending") return "Pending Review";
    if (status === "regenerating") return "Regenerating";
    if (status === "action_running") return "Running Actions";
    if (status === "rejected") return "Rejected";
    if (status === "timed_out") return "Timed Out";
    if (status === "paused") return "Paused";
    return text;
  };

  const periodLabel = (value?: string) => {
    if (value === "每天") return tt("每天", "Daily");
    if (value === "每周") return tt("每周", "Weekly");
    if (value === "每月") return tt("每月", "Monthly");
    if (value === "仅一次") return tt("仅一次", "Once");
    return value || "";
  };

  const weekdayOptions = [
    { value: 1, zh: "周一", en: "Mon" },
    { value: 2, zh: "周二", en: "Tue" },
    { value: 3, zh: "周三", en: "Wed" },
    { value: 4, zh: "周四", en: "Thu" },
    { value: 5, zh: "周五", en: "Fri" },
    { value: 6, zh: "周六", en: "Sat" },
    { value: 0, zh: "周日", en: "Sun" },
  ];

  const weekdayText = (value: number) => {
    const item = weekdayOptions.find((option) => option.value === value);
    return item ? tt(item.zh, item.en) : String(value);
  };

  const timeZoneLabel = (value?: string) => {
    if (value === "Asia/Shanghai") return "Asia/Shanghai (UTC+8)";
    if (value === "Asia/Tokyo") return "Asia/Tokyo (UTC+9)";
    if (value === "America/New_York") {
      return tt("America/New_York（自动适配夏令时）", "America/New_York (DST aware)");
    }
    return value || "UTC";
  };

  const conditionLabel = (value?: string) => {
    if (value === "执行成功") return tt("执行成功", "Succeeded");
    if (value === "执行失败") return tt("执行失败", "Failed");
    if (value === "执行结束（无论成功失败）") return tt("执行结束（无论成功失败）", "Completed (success or failure)");
    return value || "";
  };

  const templateText = (template: AutomationTemplate) =>
    isEnglish ? AUTOMATION_TEMPLATE_EN[template.id] || template : template;

  const [apps, setApps] = useState<AppOption[]>([]);
  const [appsLoading, setAppsLoading] = useState(true);

  const [automations, setAutomations] = useState<Automation[]>(initialAutomations);
  const [automationsLoaded, setAutomationsLoaded] = useState(false);
  const [runRecords, setRunRecords] = useState<RunRecord[]>(initialRunRecords);
  const [runRecordsLoaded, setRunRecordsLoaded] = useState(false);
  const [notifications, setNotifications] = useState<AutomationNotification[]>([]);
  const [notificationUnreadCount, setNotificationUnreadCount] = useState(0);
  const [notificationOpen, setNotificationOpen] = useState(false);
  const toastedNotificationKeysRef = useRef<Set<string>>(new Set());

  const [activeTab, setActiveTab] = useState<"automations" | "templates" | "runs">("automations");
  const [viewMode, setViewMode] = useState<"grid" | "list">("grid");
  const [autoFilter, setAutoFilter] = useState<"all" | AutomationStatus>("all");
  const [runFilter, setRunFilter] = useState<"all" | RunStatus>("all");
  const [search, setSearch] = useState("");
  const [runSearch, setRunSearch] = useState("");

  const [dialogOpen, setDialogOpen] = useState(false);
  const [step, setStep] = useState(1);
  const [name, setName] = useState("");
  const [selectedAppId, setSelectedAppId] = useState<number | null>(null);
  const [prompt, setPrompt] = useState("");
  const [callbackUrl, setCallbackUrl] = useState("");
  const [callbackTiming, setCallbackTiming] = useState("任务结束后（推荐）");
  const [callbackAuth, setCallbackAuth] = useState("无需验证");
  const [callbackCredential, setCallbackCredential] = useState("");

  const [trigger, setTrigger] = useState<TriggerType>("定时触发");
  const [strategy, setStrategy] = useState<StrategyType>("需要确认后执行");

  const [schedulePeriod, setSchedulePeriod] = useState("每天");
  const [scheduleTime, setScheduleTime] = useState("09:00");
  const [scheduleTimezone, setScheduleTimezone] = useState("Asia/Shanghai");
  const [scheduleWeekdays, setScheduleWeekdays] = useState<number[]>([]);
  const [scheduleMonthlyMode, setScheduleMonthlyMode] =
    useState<"fixed_day" | "last_day">("fixed_day");
  const [scheduleDayOfMonth, setScheduleDayOfMonth] = useState<number | null>(null);
  const [scheduleMissingDayPolicy, setScheduleMissingDayPolicy] =
    useState<"last_day" | "skip">("last_day");
  const [scheduleDate, setScheduleDate] = useState("");

  const [mailResultEmail, setMailResultEmail] = useState("");
  const [resultEmailIncludeAttachments, setResultEmailIncludeAttachments] = useState(true);
  const [mailboxKey, setMailboxKey] = useState("system");
  const [mailboxLabel, setMailboxLabel] = useState("系统邮箱");
  const [mailFolder, setMailFolder] = useState("INBOX");
  const [mailRuleMode, setMailRuleMode] = useState<MailRuleMode>("all");
  const [mailRules, setMailRules] = useState<MailTriggerRule[]>([]);
  const [mailPriority, setMailPriority] = useState(50);
  const [mailTesterOpen, setMailTesterOpen] = useState(false);
  const [mailTestFrom, setMailTestFrom] = useState("customer@example.com");
  const [mailTestTo, setMailTestTo] = useState("");
  const [mailTestSubject, setMailTestSubject] = useState("");
  const [mailTestBody, setMailTestBody] = useState("");
  const [mailTestAttachments, setMailTestAttachments] = useState("");

  const [connectedMailboxes, setConnectedMailboxes] = useState<ConnectedMailbox[]>([]);
  const [mailboxConnectOpen, setMailboxConnectOpen] = useState(false);
  const [mailboxSaving, setMailboxSaving] = useState(false);
  const [newMailboxName, setNewMailboxName] = useState("");
  const [newMailboxEmail, setNewMailboxEmail] = useState("");
  const [newMailboxUsername, setNewMailboxUsername] = useState("");
  const [newMailboxPassword, setNewMailboxPassword] = useState("");
  const [newMailboxImapHost, setNewMailboxImapHost] = useState("");
  const [newMailboxImapPort, setNewMailboxImapPort] = useState(993);
  const [newMailboxImapSecure, setNewMailboxImapSecure] = useState(true);

  const [upstreamAutomationId, setUpstreamAutomationId] = useState<number | null>(1);
  const [upstreamCondition, setUpstreamCondition] = useState("执行成功");
  const [passPreviousResult, setPassPreviousResult] = useState(true);

  const [notifyOnFailure, setNotifyOnFailure] = useState(true);
  const [retryCallback, setRetryCallback] = useState(true);

  const [drawerAutomationId, setDrawerAutomationId] = useState<number | null>(null);
  const [emailRoutingStats, setEmailRoutingStats] = useState<EmailRoutingStats>(emptyEmailRoutingStats);
  const [emailRoutingStatsLoading, setEmailRoutingStatsLoading] = useState(false);
  const [drawerRunId, setDrawerRunId] = useState<number | null>(null);
  const [editingAutomationId, setEditingAutomationId] = useState<number | null>(null);

  const [reviewDraft, setReviewDraft] = useState("");
  const [reviewHistory, setReviewHistory] = useState<ReviewHistoryItem[]>([]);
  const [runActions, setRunActions] = useState<RunActionItem[]>([]);
  const [reviewLoading, setReviewLoading] = useState(false);
  const [reviewActionBusy, setReviewActionBusy] = useState(false);
  const [regenerateDialogOpen, setRegenerateDialogOpen] = useState(false);
  const [regenerationAdvice, setRegenerationAdvice] = useState("");
  const [rejectDialogOpen, setRejectDialogOpen] = useState(false);
  const [rejectionReason, setRejectionReason] = useState("");

  const mailConflictCandidates = useMemo(() => {
    if (trigger !== "邮件触发") return [];

    const currentMailbox = String(mailboxKey || "system");
    const currentFolder = String(mailFolder || "INBOX").toUpperCase();

    return automations
      .filter((item) => {
        if (item.id === editingAutomationId) return false;
        if (item.trigger !== "邮件触发" || item.status !== "running") return false;

        const itemMailbox = String(item.mailboxKey || "system");
        const itemFolder = String(item.mailFolder || "INBOX").toUpperCase();

        return itemMailbox === currentMailbox && itemFolder === currentFolder;
      })
      .map((item) => ({
        item,
        level: mailConflictLevel(mailRules, mailRuleMode, item),
        priority: Number.isFinite(Number(item.mailPriority)) ? Number(item.mailPriority) : 50,
      }))
      .sort((a, b) => {
        if (a.level !== b.level) return a.level === "high" ? -1 : 1;
        if (a.priority !== b.priority) return b.priority - a.priority;
        return a.item.id - b.item.id;
      });
  }, [
    automations,
    editingAutomationId,
    mailFolder,
    mailboxKey,
    mailRuleMode,
    mailRules,
    trigger,
  ]);

  const mailRuleTestResult = useMemo(() => {
    if (trigger !== "邮件触发") return null;

    const message: MailRuleTestMessage = {
      from: mailTestFrom,
      to: mailTestTo,
      subject: mailTestSubject,
      body: mailTestBody,
      attachments: splitMailTestAttachments(mailTestAttachments),
    };
    const currentRuleResults = mailRules.map((rule) => ({
      rule,
      matched: doesMailRuleTestMatch(rule, message),
      source: mailRuleTestSource(rule, message),
    }));
    const currentMatched = doMailRulesTestMatch(mailRules, mailRuleMode, message);
    const currentMailbox = String(mailboxKey || "system");
    const currentFolder = String(mailFolder || "INBOX").toUpperCase();
    const currentId = editingAutomationId ?? Number.MAX_SAFE_INTEGER;

    const candidates = automations
      .filter((item) => {
        if (item.id === editingAutomationId) return false;
        if (item.trigger !== "邮件触发" || item.status !== "running") return false;
        return (
          String(item.mailboxKey || "system") === currentMailbox &&
          String(item.mailFolder || "INBOX").toUpperCase() === currentFolder
        );
      })
      .filter((item) =>
        doMailRulesTestMatch(
          Array.isArray(item.mailRules) ? item.mailRules : [],
          item.mailRuleMode === "any" ? "any" : "all",
          message,
        ),
      )
      .map((item) => ({
        id: item.id,
        name: item.name,
        priority: Number.isFinite(Number(item.mailPriority)) ? Number(item.mailPriority) : 50,
        current: false,
      }));

    if (currentMatched) {
      candidates.push({
        id: currentId,
        name: name.trim() || tt("当前自动化", "Current automation"),
        priority: mailPriority,
        current: true,
      });
    }

    candidates.sort((a, b) => {
      if (a.priority !== b.priority) return b.priority - a.priority;
      return a.id - b.id;
    });

    return {
      message,
      currentMatched,
      currentRuleResults,
      winner: candidates[0] || null,
      matchedCandidates: candidates,
    };
  }, [
    automations,
    editingAutomationId,
    mailFolder,
    mailboxKey,
    mailPriority,
    mailRuleMode,
    mailRules,
    mailTestAttachments,
    mailTestBody,
    mailTestFrom,
    mailTestSubject,
    mailTestTo,
    name,
    trigger,
  ]);

  const automationsRef = useRef<Automation[]>(initialAutomations);
  const webhookPollBusyRef = useRef(false);
  const chainPollBusyRef = useRef(false);

  useEffect(() => {
    automationsRef.current = automations;
  }, [automations]);

  function upsertRunRecord(nextRun: RunRecord) {
    setRunRecords((records) => {
      const exists = records.some((item) => item.id === nextRun.id);
      return exists
        ? records.map((item) => (item.id === nextRun.id ? nextRun : item))
        : [nextRun, ...records];
    });
  }

  async function loadConnectedMailboxes(options?: { silent?: boolean }) {
    try {
      const response = await axios.get("/api/v1/automation-mailboxes");
      const items = Array.isArray(response.data?.items) ? response.data.items : [];
      setConnectedMailboxes(items);
    } catch (error: any) {
      console.error("加载已连接邮箱失败:", error);
      if (!options?.silent) {
        toast.error(error?.response?.data?.detail || tt("已连接邮箱加载失败", "Failed to load connected mailboxes"));
      }
    }
  }

  async function connectMailbox() {
    const email = newMailboxEmail.trim();
    const username = newMailboxUsername.trim() || email;
    const imapHost = newMailboxImapHost.trim() || defaultImapHost(email);
    if (!email || !/^\S+@\S+\.\S+$/.test(email)) {
      toast.error(tt("请输入正确的邮箱地址", "Please enter a valid email address"));
      return;
    }
    if (!newMailboxPassword) {
      toast.error(tt("请填写邮箱授权码或密码", "Please enter the mailbox app password or password"));
      return;
    }
    if (!imapHost) {
      toast.error(tt("请填写 IMAP 服务器", "Please enter the IMAP server"));
      return;
    }

    try {
      setMailboxSaving(true);
      const response = await axios.post("/api/v1/automation-mailboxes", {
        name: newMailboxName.trim() || email,
        email,
        username,
        password: newMailboxPassword,
        imapHost,
        imapPort: newMailboxImapPort,
        imapSecure: newMailboxImapSecure,
        folder: "INBOX",
      });
      const mailbox = response.data as ConnectedMailbox;
      setConnectedMailboxes((items) => [mailbox, ...items.filter((item) => item.id !== mailbox.id)]);
      setMailboxKey(mailbox.key);
      setMailboxLabel(mailbox.label || mailbox.email);
      setMailFolder(mailbox.folder || "INBOX");
      setMailboxConnectOpen(false);
      setNewMailboxName("");
      setNewMailboxEmail("");
      setNewMailboxUsername("");
      setNewMailboxPassword("");
      setNewMailboxImapHost("");
      setNewMailboxImapPort(993);
      setNewMailboxImapSecure(true);
      toast.success(tt("邮箱连接成功", "Mailbox connected"));
    } catch (error: any) {
      toast.error(error?.response?.data?.detail || tt("邮箱连接失败", "Failed to connect mailbox"));
    } finally {
      setMailboxSaving(false);
    }
  }

  async function loadAutomations(options?: { silent?: boolean }) {
    try {
      const response = await axios.get("/api/v1/automations");
      const items = Array.isArray(response.data?.items) ? response.data.items : [];
      setAutomations(items);
    } catch (error: any) {
      console.error("加载自动化任务失败:", error);
      if (!options?.silent) {
        toast.error(error?.response?.data?.detail || tt("自动化任务加载失败", "Failed to load automations"));
      }
    } finally {
      setAutomationsLoaded(true);
    }
  }

  async function loadRunRecords(options?: { silent?: boolean }) {
    try {
      const response = await axios.get("/api/v1/automation-runs");
      const items = Array.isArray(response.data?.items) ? response.data.items : [];
      setRunRecords(items);
    } catch (error: any) {
      console.error("加载运行记录失败:", error);
      if (!options?.silent) {
        toast.error(error?.response?.data?.detail || tt("运行记录加载失败", "Failed to load run history"));
      }
    } finally {
      setRunRecordsLoaded(true);
    }
  }

  async function loadNotifications(options?: { silent?: boolean; showToast?: boolean }) {
    try {
      const response = await axios.get("/api/v1/automation-notifications");
      const items = Array.isArray(response.data?.items) ? response.data.items : [];
      setNotifications(items);
      setNotificationUnreadCount(Number(response.data?.unreadCount || 0));

      if (options?.showToast) {
        const freshUnread = items
          .filter((item: AutomationNotification) => !item.read && !toastedNotificationKeysRef.current.has(item.eventKey))
          .slice(0, 2);

        for (const item of freshUnread) {
          toastedNotificationKeysRef.current.add(item.eventKey);
          toast(item.title, {
            description: item.message,
            action: {
              label: tt("查看", "View"),
              onClick: () => {
                void openNotificationItem(item);
              },
            },
          });
        }
      }
    } catch (error: any) {
      console.error("加载自动化提醒失败:", error);
      if (!options?.silent) {
        toast.error(error?.response?.data?.detail || tt("自动化提醒加载失败", "Failed to load automation notifications"));
      }
    }
  }

  async function markNotificationsRead(eventKeys: string[]) {
    const keys = Array.from(new Set(eventKeys.filter(Boolean)));
    if (keys.length === 0) return;

    setNotifications((items) =>
      items.map((item) => (keys.includes(item.eventKey) ? { ...item, read: true } : item)),
    );
    setNotificationUnreadCount((count) => Math.max(0, count - keys.filter((key) => notifications.some((item) => item.eventKey === key && !item.read)).length));

    try {
      await axios.post("/api/v1/automation-notifications", { eventKeys: keys });
    } catch (error) {
      console.error("标记自动化提醒已读失败:", error);
      void loadNotifications({ silent: true });
    }
  }

  async function markAllNotificationsRead() {
    const keys = notifications.filter((item) => !item.read).map((item) => item.eventKey);
    if (keys.length === 0) return;
    await markNotificationsRead(keys);
  }

  async function openNotificationItem(item: AutomationNotification) {
    if (!item.read) await markNotificationsRead([item.eventKey]);
    setNotificationOpen(false);
    setRunFilter("all");
    setRunSearch("");
    setActiveTab("runs");
    setDrawerRunId(item.runId);
  }

  async function loadEmailRoutingStats(automationId: number) {
    try {
      setEmailRoutingStatsLoading(true);
      const response = await axios.get("/api/v1/automation-email/stats", {
        params: { automation_id: automationId },
      });
      setEmailRoutingStats({ ...emptyEmailRoutingStats, ...(response.data || {}) });
    } catch (error: any) {
      console.error("加载邮件路由统计失败:", error);
      setEmailRoutingStats(emptyEmailRoutingStats);
    } finally {
      setEmailRoutingStatsLoading(false);
    }
  }


  useEffect(() => {
    void loadAutomations();
    void loadRunRecords();
    void loadConnectedMailboxes();
    void loadNotifications({ silent: true, showToast: true });

    const runTimer = window.setInterval(() => {
      void loadRunRecords({ silent: true });
    }, 5000);

    const notificationTimer = window.setInterval(() => {
      void loadNotifications({ silent: true, showToast: true });
    }, 10000);

    return () => {
      window.clearInterval(runTimer);
      window.clearInterval(notificationTimer);
    };
  }, []);

  useEffect(() => {
    let alive = true;

    async function loadApps() {
      try {
        setAppsLoading(true);
        const response = await axios.get("/api/v1/apps");
        const items = Array.isArray(response.data?.items) ? response.data.items : [];
        const mapped = items
          .filter((item: any) => item && typeof item.id === "number" && typeof item.name === "string")
          .map((item: any) => ({ id: item.id, name: item.name }));

        if (!alive) return;
        setApps(mapped);
        if (mapped.length > 0) setSelectedAppId((current) => current ?? mapped[0].id);
      } catch (error: any) {
        if (!alive) return;
        toast.error(error?.response?.data?.detail || "数字员工加载失败");
      } finally {
        if (alive) setAppsLoading(false);
      }
    }

    loadApps();
    return () => {
      alive = false;
    };
  }, []);

  const selectedApp = useMemo(
    () => apps.find((item) => item.id === selectedAppId) ?? null,
    [apps, selectedAppId],
  );

  const filteredAutomations = useMemo(() => {
    const q = search.trim().toLowerCase();
    return automations.filter((item) => {
      const statusOk = autoFilter === "all" || item.status === autoFilter;
      const searchOk =
        !q ||
        `${item.name}${item.agent}${item.trigger}`.toLowerCase().includes(q);
      return statusOk && searchOk;
    });
  }, [automations, autoFilter, search]);

  const filteredRuns = useMemo(() => {
    const q = runSearch.trim().toLowerCase();
    return runRecords.filter((item) => {
      const statusOk = runFilter === "all" || item.status === runFilter;
      const searchOk =
        !q ||
        `${item.name}${item.agent}${item.trigger}${item.statusText}`.toLowerCase().includes(q);
      return statusOk && searchOk;
    });
  }, [runRecords, runFilter, runSearch]);

  const drawerAutomation = useMemo(
    () => automations.find((item) => item.id === drawerAutomationId) ?? null,
    [automations, drawerAutomationId],
  );

  const drawerRun = useMemo(
    () => runRecords.find((item) => item.id === drawerRunId) ?? null,
    [runRecords, drawerRunId],
  );

  const drawerAutomationRuns = useMemo(() => {
    if (drawerAutomationId == null) return [];
    return runRecords.filter((item) => item.automationId === drawerAutomationId);
  }, [runRecords, drawerAutomationId]);

  const drawerEmailRuns = useMemo(
    () =>
      drawerAutomationRuns.filter(
        (item) => item.triggerContext?.source === "email-server",
      ),
    [drawerAutomationRuns],
  );

  const drawerEmailStats = useMemo(() => {
    const success = drawerEmailRuns.filter((item) => item.status === "success").length;
    const failed = drawerEmailRuns.filter(
      (item) => item.status === "failed" || item.status === "timed_out",
    ).length;
    const pending = drawerEmailRuns.filter((item) =>
      ["running", "pending", "regenerating", "action_running"].includes(item.status),
    ).length;

    return {
      total: drawerEmailRuns.length,
      success,
      failed,
      pending,
    };
  }, [drawerEmailRuns]);

  useEffect(() => {
    if (!drawerAutomation || drawerAutomation.trigger !== "邮件触发") {
      setEmailRoutingStats(emptyEmailRoutingStats);
      return;
    }
    void loadEmailRoutingStats(drawerAutomation.id);
  }, [drawerAutomation?.id, drawerAutomation?.trigger]);


  useEffect(() => {
    if (!drawerRunId) {
      setReviewDraft("");
      setReviewHistory([]);
      setReviewLoading(false);
      return;
    }

    const run = runRecords.find((item) => item.id === drawerRunId);
    const isReviewRun =
      run?.strategy === "需要确认后执行" ||
      run?.reviewStatus === "pending" ||
      run?.reviewStatus === "approved" ||
      run?.reviewStatus === "rejected";

    if (!isReviewRun) {
      setReviewDraft(run?.finalResult || run?.reviewContent || run?.result || "");
      setReviewHistory([]);
      setRunActions([]);
      return;
    }

    let cancelled = false;

    async function loadReview() {
      try {
        setReviewLoading(true);
        const response = await axios.get(`/api/v1/automation-runs/${drawerRunId}/review`);
        if (cancelled) return;

        const nextRun = response.data?.run as RunRecord | undefined;
        if (nextRun) {
          upsertRunRecord(nextRun);
          setReviewDraft(nextRun.reviewContent || nextRun.finalResult || nextRun.result || "");
        }

        const history = Array.isArray(response.data?.history) ? response.data.history : [];
        const actions = Array.isArray(response.data?.actions) ? response.data.actions : [];
        setReviewHistory(history);
        setRunActions(actions);
      } catch (error: any) {
        if (!cancelled) {
          console.error("加载审核详情失败:", error);
          toast.error(error?.response?.data?.detail || tt("审核详情加载失败", "Failed to load review details"));
        }
      } finally {
        if (!cancelled) setReviewLoading(false);
      }
    }

    void loadReview();
    return () => {
      cancelled = true;
    };
  }, [drawerRunId]);

  const callbackEnabled = callbackUrl.trim().length > 0;

  const resultReturnParts = [tt("平台内保存", "Saved in platform")];
  if (mailResultEmail.trim()) {
    resultReturnParts.push(isEnglish ? `Send to ${mailResultEmail.trim()}` : `完成通知 ${mailResultEmail.trim()}`);
  }
  if (callbackEnabled) {
    resultReturnParts.push(tt("发送至接收 URL", "Send to callback URL"));
  }
  const resultReturnText = resultReturnParts.join(" + ");

  const variables =
    trigger === "邮件触发"
      ? [
          { value: "{{email.sender}}", label: tt("发件人", "Sender") },
          { value: "{{email.subject}}", label: tt("邮件主题", "Email subject") },
          { value: "{{email.body}}", label: tt("邮件正文", "Email body") },
          { value: "{{email.attachments}}", label: tt("附件信息", "Attachments") },
        ]
      : trigger === "Webhook / API"
        ? [
            { value: "{{event.payload}}", label: tt("请求内容", "Request payload") },
            { value: "{{event.id}}", label: tt("事件 ID", "Event ID") },
          ]
        : trigger === "自动化完成触发"
          ? [
              { value: "{{previous.result}}", label: tt("上游执行结果", "Previous result") },
              { value: "{{previous.status}}", label: tt("上游执行状态", "Previous status") },
              { value: "{{previous.run_id}}", label: tt("上游运行 ID", "Previous run ID") },
            ]
          : [
              { value: "{{trigger.time}}", label: tt("触发时间", "Trigger time") },
              { value: "{{trigger.timezone}}", label: tt("触发时区", "Trigger timezone") },
            ];

  function localizedTriggerDetail(item: Automation) {
    if (item.trigger === "邮件触发") {
      const mailbox = item.mailboxLabel || tt("系统邮箱", "System Mailbox");
      const ruleText = mailRulesSummary(item);
      const priority = Number.isFinite(Number(item.mailPriority)) ? Number(item.mailPriority) : 50;
      return `${mailbox} · ${ruleText} · ${tt("优先级", "Priority")} ${priority}`;
    }
    if (item.trigger === "Webhook / API") {
      return tt("由外部系统通过 Webhook / API 触发", "Triggered by an external system through Webhook / API");
    }
    if (item.trigger === "定时触发") {
      const period = item.schedulePeriod || "每天";
      const time = item.scheduleTime || "09:00";
      const timezone = timeZoneLabel(item.scheduleTimezone || "Asia/Shanghai");

      if (period === "每周") {
        const days = weekdayOptions
          .filter((option) => (item.scheduleWeekdays || []).includes(option.value))
          .map((option) => tt(option.zh, option.en))
          .join(tt("、", ", "));
        return `${periodLabel(period)} ${days || tt("未选择星期", "No weekday selected")} ${time} · ${timezone}`;
      }

      if (period === "每月") {
        const day = item.scheduleDayOfMonth;
        const missing =
          Number(day) >= 29
            ? item.scheduleMissingDayPolicy === "skip"
              ? tt(" · 当月无该日期时跳过", " · skip months without this date")
              : tt(" · 当月无该日期时按月末执行", " · use month end if unavailable")
            : "";
        return `${periodLabel(period)} ${day ? `${day}${tt("日", "")}` : tt("未选择日期", "No date selected")} ${time} · ${timezone}${missing}`;
      }

      if (period === "仅一次") {
        return `${periodLabel(period)} ${item.scheduleDate || tt("未选择日期", "No date selected")} ${time} · ${timezone}`;
      }

      return `${periodLabel(period)} ${time} · ${timezone}`;
    }

    const upstream = automations.find((automation) => automation.id === item.upstreamAutomationId);
    const upstreamName = upstream?.name || tt("上游自动化", "Upstream automation");
    const passText = item.passPreviousResult ? tt(" · 传入上游结果", " · Pass upstream result") : "";
    return `${upstreamName} · ${conditionLabel(item.upstreamCondition)}${passText}`;
  }

  function localizedReturnDetail(item: Automation) {
    const parts = [tt("平台内保存", "Saved in platform")];
    if (item.resultEmail) {
      parts.push(
        isEnglish
          ? `Send to ${item.resultEmail}${item.resultEmailIncludeAttachments ? " + generated files" : ""}`
          : `完成通知 ${item.resultEmail}${item.resultEmailIncludeAttachments ? "（含生成附件）" : ""}`,
      );
    }
    if (item.callbackUrl) {
      parts.push(tt("发送至接收 URL", "Send to callback URL"));
    }
    return parts.join(" + ");
  }

  function displayTime(value: string) {
    if (value === "刚刚创建") return tt("刚刚创建", "Just created");
    return value;
  }

  function resetWizard() {
    setStep(1);
    setName("");
    setPrompt("");
    setCallbackUrl("");
    setCallbackTiming("任务结束后（推荐）");
    setCallbackAuth("无需验证");
    setCallbackCredential("");
    setTrigger("定时触发");
    setStrategy("需要确认后执行");
    setSchedulePeriod("每天");
    setScheduleTime("09:00");
    setScheduleTimezone("Asia/Shanghai");
    setScheduleWeekdays([]);
    setScheduleMonthlyMode("fixed_day");
    setScheduleDayOfMonth(null);
    setScheduleMissingDayPolicy("last_day");
    setScheduleDate("");
    setMailResultEmail("");
    setResultEmailIncludeAttachments(true);
    setMailboxKey("system");
    setMailboxLabel("系统邮箱");
    setMailFolder("INBOX");
    setMailRuleMode("all");
    setMailRules([]);
    setMailPriority(50);
    setMailTesterOpen(false);
    setMailTestFrom("customer@example.com");
    setMailTestTo("");
    setMailTestSubject("");
    setMailTestBody("");
    setMailTestAttachments("");
    setUpstreamAutomationId(automations[0]?.id ?? null);
    setUpstreamCondition("执行成功");
    setPassPreviousResult(true);
    setNotifyOnFailure(true);
    setRetryCallback(true);
    if (apps.length > 0) setSelectedAppId(apps[0].id);
  }

  function openCreateDialog() {
    resetWizard();
    setEditingAutomationId(null);
    setDialogOpen(true);
  }

  function openEditDialog(item: Automation) {
    setEditingAutomationId(item.id);
    setStep(1);
    setName(item.name);
    setSelectedAppId(item.appId);
    setPrompt(item.task === "暂未填写任务说明" ? "" : item.task);
    setCallbackUrl(item.callbackUrl || "");
    setCallbackTiming(item.callbackTiming || "任务结束后（推荐）");
    setCallbackAuth(item.callbackAuth || "无需验证");
    setCallbackCredential(item.callbackCredential || "");
    setTrigger(item.trigger);
    setStrategy(item.strategy);
    setSchedulePeriod(item.schedulePeriod || "每天");
    setScheduleTime(item.scheduleTime || "09:00");
    setScheduleTimezone(item.scheduleTimezone || "Asia/Shanghai");
    setScheduleWeekdays(Array.isArray(item.scheduleWeekdays) ? item.scheduleWeekdays : []);
    setScheduleMonthlyMode(item.scheduleMonthlyMode === "last_day" ? "last_day" : "fixed_day");
    setScheduleDayOfMonth(
      Number.isInteger(Number(item.scheduleDayOfMonth))
        ? Number(item.scheduleDayOfMonth)
        : null,
    );
    setScheduleMissingDayPolicy(
      item.scheduleMissingDayPolicy === "skip" ? "skip" : "last_day",
    );
    setScheduleDate(item.scheduleDate || "");
    setMailResultEmail(item.resultEmail || "");
    setResultEmailIncludeAttachments(item.resultEmailIncludeAttachments === true);
    setMailboxKey(item.mailboxKey || "system");
    setMailboxLabel(item.mailboxLabel || "系统邮箱");
    setMailFolder(item.mailFolder || "INBOX");
    setMailRuleMode(item.mailRuleMode === "any" ? "any" : "all");
    setMailRules(Array.isArray(item.mailRules) ? item.mailRules : []);
    setMailPriority(Number.isFinite(Number(item.mailPriority)) ? Number(item.mailPriority) : 50);
    setUpstreamAutomationId(
      item.upstreamAutomationId ??
        automations.find((automation) => automation.id !== item.id)?.id ??
        null,
    );
    setUpstreamCondition(item.upstreamCondition || "执行成功");
    setPassPreviousResult(item.passPreviousResult !== false);
    setNotifyOnFailure(true);
    setRetryCallback(true);
    setDrawerAutomationId(null);
    setDialogOpen(true);
  }

  function useTemplate(template: AutomationTemplate) {
    resetWizard();
    setEditingAutomationId(null);
    const localizedTemplate = templateText(template);
    setName(localizedTemplate.name);
    setPrompt(localizedTemplate.task);
    setTrigger(template.trigger);
    setStrategy(template.strategy);
    setStep(1);
    setDialogOpen(true);
  }

  function triggerDetail(): string {
    if (trigger === "定时触发") {
      if (schedulePeriod === "每周") {
        const days = weekdayOptions
          .filter((option) => scheduleWeekdays.includes(option.value))
          .map((option) => option.zh)
          .join("、");
        return `每周 ${days || "未选择星期"} ${scheduleTime} · ${timeZoneLabel(scheduleTimezone)}`;
      }
      if (schedulePeriod === "每月") {
        if (scheduleMonthlyMode === "last_day") {
          return `每月最后一天 ${scheduleTime} · ${timeZoneLabel(scheduleTimezone)}`;
        }
        const missing =
          Number(scheduleDayOfMonth) >= 29
            ? scheduleMissingDayPolicy === "skip"
              ? " · 当月无该日期时跳过"
              : " · 当月无该日期时按月末执行"
            : "";
        return `每月 ${scheduleDayOfMonth ? `${scheduleDayOfMonth}日` : "未选择日期"} ${scheduleTime} · ${timeZoneLabel(scheduleTimezone)}${missing}`;
      }
      if (schedulePeriod === "仅一次") {
        return `仅一次 ${scheduleDate || "未选择日期"} ${scheduleTime} · ${timeZoneLabel(scheduleTimezone)}`;
      }
      return `每天 ${scheduleTime} · ${timeZoneLabel(scheduleTimezone)}`;
    }
    if (trigger === "邮件触发") {
      const temp: Automation = {
        id: 0, name: "", trigger: "邮件触发", triggerDetail: "", appId: null, agent: "",
        strategy, status: "running", statusText: "", time: "", task: "", returnDetail: "",
        mailboxLabel, mailRuleMode, mailRules, mailPriority,
      };
      return `${mailboxLabel} · ${mailRulesSummary(temp)} · 优先级 ${mailPriority}`;
    }
    if (trigger === "Webhook / API") {
      return "由外部系统通过 Webhook / API 触发";
    }

    const upstream = automations.find((item) => item.id === upstreamAutomationId);
    return `${upstream?.name || "上游自动化"} · ${upstreamCondition}${passPreviousResult ? " · 传入上游结果" : ""}`;
  }

  function buildAutomationPayload() {
    return {
      name: name.trim(),
      appId: selectedApp?.id,
      task: prompt.trim() || "暂未填写任务说明",
      trigger,
      strategy,
      resultEmail: mailResultEmail.trim() || undefined,
      resultEmailIncludeAttachments: mailResultEmail.trim() ? resultEmailIncludeAttachments : false,
      callbackUrl: callbackUrl.trim() || undefined,
      callbackTiming,
      callbackAuth,
      callbackCredential: callbackCredential.trim() || undefined,
      schedulePeriod: trigger === "定时触发" ? schedulePeriod : undefined,
      scheduleTime: trigger === "定时触发" ? scheduleTime : undefined,
      scheduleTimezone: trigger === "定时触发" ? scheduleTimezone : undefined,
      scheduleWeekdays:
        trigger === "定时触发" && schedulePeriod === "每周"
          ? scheduleWeekdays
          : undefined,
      scheduleMonthlyMode:
        trigger === "定时触发" && schedulePeriod === "每月"
          ? scheduleMonthlyMode
          : undefined,
      scheduleDayOfMonth:
        trigger === "定时触发" &&
        schedulePeriod === "每月" &&
        scheduleMonthlyMode === "fixed_day"
          ? scheduleDayOfMonth ?? undefined
          : undefined,
      scheduleMissingDayPolicy:
        trigger === "定时触发" &&
        schedulePeriod === "每月" &&
        scheduleMonthlyMode === "fixed_day" &&
        Number(scheduleDayOfMonth) >= 29
          ? scheduleMissingDayPolicy
          : undefined,
      scheduleDate:
        trigger === "定时触发" && schedulePeriod === "仅一次"
          ? scheduleDate || undefined
          : undefined,
      mailboxKey: trigger === "邮件触发" ? mailboxKey : undefined,
      mailboxLabel: trigger === "邮件触发" ? mailboxLabel : undefined,
      mailFolder: trigger === "邮件触发" ? mailFolder : undefined,
      mailRuleMode: trigger === "邮件触发" ? mailRuleMode : undefined,
      mailRules: trigger === "邮件触发" ? mailRules : undefined,
      mailPriority: trigger === "邮件触发" ? mailPriority : undefined,
      upstreamAutomationId:
        trigger === "自动化完成触发" ? upstreamAutomationId : undefined,
      upstreamCondition:
        trigger === "自动化完成触发" ? upstreamCondition : undefined,
      passPreviousResult:
        trigger === "自动化完成触发" ? passPreviousResult : undefined,
    };
  }

  function validateScheduleConfiguration() {
    if (trigger !== "定时触发") return true;

    if (!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(scheduleTime)) {
      toast.error(tt("请选择有效的执行时间", "Please choose a valid run time"));
      return false;
    }

    if (schedulePeriod === "每周" && scheduleWeekdays.length === 0) {
      toast.error(tt("请至少选择一个执行星期", "Please select at least one weekday"));
      return false;
    }

    if (schedulePeriod === "每月" && scheduleMonthlyMode === "fixed_day") {
      const day = Number(scheduleDayOfMonth);
      if (!Number.isInteger(day) || day < 1 || day > 31) {
        toast.error(tt("请选择每月执行日期", "Please choose a monthly run date"));
        return false;
      }
    }

    if (schedulePeriod === "仅一次" && !scheduleDate) {
      toast.error(tt("请选择一次性任务的执行日期", "Please choose a date for the one-time run"));
      return false;
    }

    return true;
  }

  async function createAutomation() {
    if (!name.trim()) {
      toast.error("请填写自动化名称");
      setStep(1);
      return;
    }
    if (!selectedApp) {
      toast.error("请选择数字员工");
      setStep(1);
      return;
    }

    if (!validateScheduleConfiguration()) {
      setStep(2);
      return;
    }

    {
      const email = mailResultEmail.trim();
      const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (email && !emailPattern.test(email)) {
        toast.error("请输入正确的完成通知邮箱");
        setStep(1);
        return;
      }
    }

    if (trigger === "邮件触发") {
      const invalidRule = mailRules.find((rule) => rule.field !== "是否包含附件" && rule.operator !== "是否存在" && !rule.value.trim());
      if (invalidRule) {
        toast.error(tt("请填写完整的邮件触发条件", "Please complete all email trigger conditions"));
        setStep(2);
        return;
      }
    }

    try {
      const response = await axios.post("/api/v1/automations", buildAutomationPayload());
      const item = response.data as Automation;
      setAutomations((items) => [item, ...items.filter((current) => current.id !== item.id)]);
      setDialogOpen(false);
      toast.success("自动化已创建");
    } catch (error: any) {
      console.error("创建自动化失败:", error);
      toast.error(error?.response?.data?.detail || "自动化创建失败");
    }
  }

  async function saveAutomation() {
    if (editingAutomationId == null) return;

    if (!name.trim()) {
      toast.error(tt("请填写自动化名称", "Please enter an automation name"));
      setStep(1);
      return;
    }
    if (!selectedApp) {
      toast.error(tt("请选择数字员工", "Please select a digital employee"));
      setStep(1);
      return;
    }

    if (!validateScheduleConfiguration()) {
      setStep(2);
      return;
    }

    {
      const email = mailResultEmail.trim();
      const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (email && !emailPattern.test(email)) {
        toast.error(tt("请输入正确的完成通知邮箱", "Please enter a valid completion notification email"));
        setStep(1);
        return;
      }
    }

    if (
      trigger === "自动化完成触发" &&
      (!upstreamAutomationId || upstreamAutomationId === editingAutomationId)
    ) {
      toast.error(
        tt(
          "请选择其他自动化作为上游任务",
          "Please select another automation as the upstream task",
        ),
      );
      setStep(2);
      return;
    }

    if (trigger === "邮件触发") {
      const invalidRule = mailRules.find((rule) => rule.field !== "是否包含附件" && rule.operator !== "是否存在" && !rule.value.trim());
      if (invalidRule) {
        toast.error(tt("请填写完整的邮件触发条件", "Please complete all email trigger conditions"));
        setStep(2);
        return;
      }
    }

    try {
      const response = await axios.put(
        `/api/v1/automations/${editingAutomationId}`,
        buildAutomationPayload(),
      );
      const updated = response.data as Automation;
      setAutomations((items) =>
        items.map((item) => (item.id === editingAutomationId ? updated : item)),
      );
      setDialogOpen(false);
      setEditingAutomationId(null);
      toast.success(tt("自动化已更新", "Automation updated"));
    } catch (error: any) {
      console.error("更新自动化失败:", error);
      toast.error(error?.response?.data?.detail || tt("自动化更新失败", "Failed to update automation"));
    }
  }

  async function toggleAutomation(id: number) {
    const item = automations.find((automation) => automation.id === id);
    if (!item) return;

    const nextStatus = item.status === "paused" ? "running" : "paused";

    try {
      const response = await axios.put(`/api/v1/automations/${id}`, {
        status: nextStatus,
      });
      const updated = response.data as Automation;
      setAutomations((items) =>
        items.map((automation) => (automation.id === id ? updated : automation)),
      );
      setDrawerAutomationId(null);
    } catch (error: any) {
      console.error("更新自动化状态失败:", error);
      toast.error(error?.response?.data?.detail || tt("状态更新失败", "Failed to update status"));
    }
  }

  async function deleteAutomation(item: Automation) {
    const dependents = automations.filter(
      (automation) =>
        automation.trigger === "自动化完成触发" &&
        automation.upstreamAutomationId === item.id,
    );

    if (dependents.length > 0) {
      const names = dependents.map((automation) => automation.name).join("、");
      toast.error(
        isEnglish
          ? `Cannot delete this automation because it is used as an upstream automation by: ${dependents
              .map((automation) => automation.name)
              .join(", ")}`
          : `暂时无法删除：以下自动化正在依赖它作为上游任务：${names}`,
      );
      return;
    }

    const confirmed = window.confirm(
      isEnglish
        ? `Delete automation "${item.name}"?\n\nThis will remove the automation configuration. Existing run history will be kept.`
        : `确定删除自动化「${item.name}」吗？\n\n删除后将移除该自动化配置，已有运行记录会继续保留。`,
    );

    if (!confirmed) return;

    try {
      await axios.delete(`/api/v1/automations/${item.id}`);
      setAutomations((items) =>
        items.filter((automation) => automation.id !== item.id),
      );
      setDrawerAutomationId(null);
      toast.success(
        isEnglish
          ? `Automation deleted: ${item.name}`
          : `自动化已删除：${item.name}`,
      );
    } catch (error: any) {
      const dependentsFromServer = Array.isArray(error?.response?.data?.dependents)
        ? error.response.data.dependents
        : [];
      const names = dependentsFromServer
        .map((dependent: any) => dependent?.name)
        .filter(Boolean)
        .join("、");

      console.error("删除自动化失败:", error);
      toast.error(
        names
          ? `暂时无法删除：以下自动化正在依赖它作为上游任务：${names}`
          : error?.response?.data?.detail || tt("自动化删除失败", "Failed to delete automation"),
      );
    }
  }

  async function sendAutomationCallback(
    item: Automation,
    status: "success" | "failed",
    result?: string,
    error?: string,
  ) {
    if (!item.callbackUrl) return;

    const timing = item.callbackTiming || "任务结束后（推荐）";
    if (timing === "仅任务成功后" && status !== "success") return;
    if (timing === "仅任务失败后" && status !== "failed") return;

    try {
      await axios.post("/api/automation/callback", {
        url: item.callbackUrl,
        auth: item.callbackAuth || "无需验证",
        credential: item.callbackCredential || "",
        payload: {
          event: "automation.completed",
          automation_id: item.id,
          automation_name: item.name,
          status,
          result: result || "",
          error: error || "",
          occurred_at: new Date().toISOString(),
        },
      });
    } catch (callbackError) {
      console.error("结果 URL 回传失败:", callbackError);
      toast.error(`结果 URL 回传失败：${item.name}`);
    }
  }

  async function runContextAutomation(
    item: Automation,
    triggerLabelValue: string,
    contextText: string,
  ) {
    if (!item.appId) {
      toast.error("该任务未绑定真实数字员工");
      return;
    }

    const question = [
      "【自动化任务】",
      item.task,
      "",
      contextText,
      "",
      "【执行要求】",
      "请根据本次触发上下文完成任务，只输出处理结果。",
    ].join("\n");

    try {
      const response = await axios.post(`/api/v1/automations/${item.id}/run`, {
        trigger: triggerLabelValue,
        question,
        triggerContext: {
          source: triggerLabelValue,
          contextText,
          firedAt: new Date().toISOString(),
        },
      });

      const run = response.data?.run as RunRecord | undefined;
      if (run) upsertRunRecord(run);

      if (run?.status === "pending") {
        toast.success(`AI 结果已生成，等待审核：${item.name}`);
        return;
      }

      if (run?.status === "failed") {
        toast.error(run.error || `自动化后续操作执行失败：${item.name}`);
        return;
      }

      if (run?.status === "timed_out") {
        toast.error(run.error || `自动化执行超时：${item.name}`);
        return;
      }

      if (run?.status === "success") {
        toast.success(`自动化执行成功：${item.name}`);
      }
    } catch (error: any) {
      const failedRun = error?.response?.data?.run as RunRecord | undefined;
      if (failedRun) upsertRunRecord(failedRun);

      const errorMessage =
        error?.response?.data?.detail ||
        error?.response?.data?.error ||
        error?.message ||
        "任务执行失败";

      if (item.strategy === "自动执行") {
        await sendAutomationCallback(item, "failed", undefined, String(errorMessage));
      }

      toast.error(`自动化执行失败：${item.name}`);
    }
  }

  async function saveCurrentReviewDraft(record: RunRecord) {
    if (record.status !== "pending") return;
    const content = reviewDraft.trim();
    if (!content) return;

    const current = (record.reviewContent || record.result || "").trim();
    if (content === current) return;

    try {
      const response = await axios.patch(
        `/api/v1/automation-runs/${record.id}/review`,
        { content },
      );
      const updated = response.data?.run as RunRecord | undefined;
      if (updated) upsertRunRecord(updated);
    } catch (error: any) {
      console.error("保存审核修改失败:", error);
      toast.error(error?.response?.data?.detail || tt("审核内容保存失败", "Failed to save review content"));
    }
  }

  async function approveRunReview(record: RunRecord) {
    if (record.status !== "pending" || reviewActionBusy) return;

    const content = reviewDraft.trim();
    if (!content) {
      toast.error(tt("审核内容不能为空", "Review content cannot be empty"));
      return;
    }

    try {
      setReviewActionBusy(true);
      const response = await axios.post(
        `/api/v1/automation-runs/${record.id}/review`,
        { action: "approve", content },
      );
      const updated = response.data?.run as RunRecord | undefined;
      const actions = Array.isArray(response.data?.actions) ? response.data.actions : [];
      if (updated) upsertRunRecord(updated);
      setRunActions(actions);
      await loadRunRecords({ silent: true });
      const detail = await axios.get(`/api/v1/automation-runs/${record.id}/review`);
      if (Array.isArray(detail.data?.history)) {
        setReviewHistory(detail.data.history);
      }
      if (Array.isArray(detail.data?.actions)) {
        setRunActions(detail.data.actions);
      }

      if (updated?.status === "failed") {
        toast.error(
          updated.error ||
            tt("审核已通过，但后续操作执行失败", "Review approved, but follow-up actions failed"),
        );
      } else if (actions.length > 0) {
        toast.success(tt("审核已通过，后续操作已完成", "Review approved and follow-up actions completed"));
      } else {
        toast.success(tt("审核已通过，当前内容已锁定为最终结果", "Review approved and the current content is locked as the final result"));
      }
    } catch (error: any) {
      console.error("审核通过失败:", error);
      toast.error(error?.response?.data?.detail || tt("审核通过失败", "Failed to approve review"));
    } finally {
      setReviewActionBusy(false);
    }
  }

  async function retryFailedRunActions(record: RunRecord) {
    if (
      reviewActionBusy ||
      record.status !== "failed" ||
      record.reviewStatus !== "approved" ||
      !runActions.some((action) => action.status === "failed")
    ) {
      return;
    }

    try {
      setReviewActionBusy(true);

      const response = await axios.post(
        `/api/v1/automation-runs/${record.id}/review`,
        { action: "retry_failed_actions" },
      );

      const updated = response.data?.run as RunRecord | undefined;
      const actions = Array.isArray(response.data?.actions) ? response.data.actions : [];

      if (updated) upsertRunRecord(updated);
      setRunActions(actions);
      await loadRunRecords({ silent: true });

      if (updated?.status === "failed") {
        toast.error(
          updated.error ||
            tt("失败操作重试后仍未成功", "Some follow-up actions still failed after retry"),
        );
      } else {
        toast.success(
          tt("失败的后续操作已重试完成", "Failed follow-up actions retried successfully"),
        );
      }
    } catch (error: any) {
      console.error("重试失败操作失败:", error);
      toast.error(
        error?.response?.data?.detail ||
          tt("失败操作重试失败", "Failed to retry follow-up actions"),
      );
    } finally {
      setReviewActionBusy(false);
    }
  }

  async function regenerateRunReview(record: RunRecord) {
    if (record.status !== "pending" || reviewActionBusy) return;

    const advice = regenerationAdvice.trim();
    if (!advice) {
      toast.error(tt("请填写重新生成的修改建议", "Please enter regeneration instructions"));
      return;
    }

    try {
      setReviewActionBusy(true);
      upsertRunRecord({
        ...record,
        status: "regenerating",
        statusText: "重新生成中",
      });

      const response = await axios.post(
        `/api/v1/automation-runs/${record.id}/review`,
        {
          action: "regenerate",
          advice,
          content: reviewDraft,
        },
      );

      const updated = response.data?.run as RunRecord | undefined;
      if (updated) {
        upsertRunRecord(updated);
        setReviewDraft(updated.reviewContent || updated.result || "");
      }

      setRegenerateDialogOpen(false);
      setRegenerationAdvice("");
      await loadRunRecords({ silent: true });

      const detail = await axios.get(`/api/v1/automation-runs/${record.id}/review`);
      if (Array.isArray(detail.data?.history)) {
        setReviewHistory(detail.data.history);
      }

      toast.success(tt("已重新生成，请继续审核新版本", "Regenerated successfully. Please review the new version."));
    } catch (error: any) {
      const restored = error?.response?.data?.run as RunRecord | undefined;
      if (restored) {
        upsertRunRecord(restored);
        setReviewDraft(restored.reviewContent || restored.result || reviewDraft);
      } else {
        await loadRunRecords({ silent: true });
      }

      console.error("重新生成失败:", error);
      toast.error(error?.response?.data?.detail || tt("重新生成失败", "Regeneration failed"));
    } finally {
      setReviewActionBusy(false);
    }
  }

  async function rejectRunReview(record: RunRecord) {
    if (record.status !== "pending" || reviewActionBusy) return;

    try {
      setReviewActionBusy(true);
      const response = await axios.post(
        `/api/v1/automation-runs/${record.id}/review`,
        {
          action: "reject",
          reason: rejectionReason.trim() || undefined,
        },
      );

      const updated = response.data?.run as RunRecord | undefined;
      if (updated) upsertRunRecord(updated);
      setRejectDialogOpen(false);
      setRejectionReason("");
      await loadRunRecords({ silent: true });
      const detail = await axios.get(`/api/v1/automation-runs/${record.id}/review`);
      if (Array.isArray(detail.data?.history)) {
        setReviewHistory(detail.data.history);
      }
      toast.success(tt("本次运行已驳回", "This run has been rejected"));
    } catch (error: any) {
      console.error("驳回失败:", error);
      toast.error(error?.response?.data?.detail || tt("驳回失败", "Failed to reject run"));
    } finally {
      setReviewActionBusy(false);
    }
  }

  async function runNow(item: Automation) {
    if (!item.appId) {
      toast.error("该任务未绑定真实数字员工，请新建自动化后再运行");
      return;
    }

    toast.success(`已发起一次手动运行：${item.name}`);

    try {
      const response = await axios.post(`/api/v1/automations/${item.id}/run`, {
        trigger: "手动触发",
        triggerContext: {
          source: "manual",
          firedAt: new Date().toISOString(),
        },
      });

      const run = response.data?.run as RunRecord | undefined;
      if (run) upsertRunRecord(run);

      if (run?.status === "pending") {
        toast.success(`AI 结果已生成，等待审核：${item.name}`);
        return;
      }

      if (run?.status === "failed") {
        toast.error(run.error || `自动化后续操作执行失败：${item.name}`);
        return;
      }

      if (run?.status === "success") {
        toast.success(`自动化执行成功：${item.name}`);
      }
    } catch (error: any) {
      const failedRun = error?.response?.data?.run as RunRecord | undefined;
      if (failedRun) upsertRunRecord(failedRun);

      const errorMessage =
        error?.response?.data?.detail ||
        error?.response?.data?.error ||
        error?.message ||
        "任务执行失败";

      if (item.strategy === "自动执行") {
        await sendAutomationCallback(item, "failed", undefined, String(errorMessage));
      }

      toast.error(`自动化执行失败：${item.name}`);
    }
  }

  // 邮件触发已交由服务端 Automation Scheduler 处理。
  // 即使用户关闭自动化页面，服务端仍会持续监听邮箱并按规则触发任务。

  // 定时触发已交由服务端 Automation Scheduler 处理。
  // 页面不再执行浏览器端定时轮询，避免与服务端 Scheduler 重复触发同一任务。


  // Webhook/API 演示版：Next API 暂存外部事件，页面每 5 秒领取并执行。
  // biome-ignore lint/correctness/useExhaustiveDependencies: polling intentionally follows automation state
  useEffect(() => {
    if (!automationsLoaded) return;

    const hasActiveWebhook = automations.some(
      (item) => item.trigger === "Webhook / API" && item.status === "running",
    );
    if (!hasActiveWebhook) return;

    let cancelled = false;

    async function pollWebhook() {
      if (cancelled || webhookPollBusyRef.current) return;
      webhookPollBusyRef.current = true;

      try {
        const response = await axios.get("/api/automation/webhook");
        const events = Array.isArray(response.data?.events) ? response.data.events : [];

        for (const event of events) {
          if (cancelled) return;
          const automationId = Number(event?.automation_id);
          const item = automationsRef.current.find(
            (automation) =>
              automation.id === automationId &&
              automation.trigger === "Webhook / API" &&
              automation.status === "running",
          );
          if (!item) continue;

          await runContextAutomation(
            item,
            "Webhook / API",
            [
              "【Webhook / API 触发上下文】",
              `事件ID：${event?.id || "未知"}`,
              "事件数据：",
              JSON.stringify(event?.payload ?? {}, null, 2),
            ].join("\n"),
          );
        }
      } catch (error) {
        console.error("Webhook 事件检查失败:", error);
      } finally {
        webhookPollBusyRef.current = false;
      }
    }

    pollWebhook();
    const timer = window.setInterval(pollWebhook, WEBHOOK_POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [automationsLoaded, automations]);

  // 自动化完成触发：监听刚完成的运行记录，并把上游结果传给下游自动化。
  // biome-ignore lint/correctness/useExhaustiveDependencies: chain processing follows run record state
  useEffect(() => {
    if (!automationsLoaded || !runRecordsLoaded || chainPollBusyRef.current) return;

    const completed = runRecords.filter(
      (record) => record.status === "success" || record.status === "failed",
    );
    if (completed.length === 0) return;

    let cancelled = false;

    async function processChains() {
      if (chainPollBusyRef.current) return;
      chainPollBusyRef.current = true;

      try {
        const raw = window.localStorage.getItem(CHAIN_PROCESSED_STORAGE_KEY);
        const processed = new Set<string>(raw ? JSON.parse(raw) : []);

        for (const record of completed) {
          if (cancelled) return;
          const key = String(record.id);
          if (processed.has(key)) continue;

          // 先标记，避免下游执行更新 runRecords 时重复处理同一条上游记录。
          processed.add(key);
          const compact = Array.from(processed).slice(-300);
          window.localStorage.setItem(
            CHAIN_PROCESSED_STORAGE_KEY,
            JSON.stringify(compact),
          );

          if (!record.automationId) continue;

          const downstreams = automationsRef.current.filter((item) => {
            if (
              item.trigger !== "自动化完成触发" ||
              item.status !== "running" ||
              item.upstreamAutomationId !== record.automationId
            ) {
              return false;
            }

            const condition = item.upstreamCondition || "执行成功";
            if (condition === "执行成功") return record.status === "success";
            if (condition === "执行失败") return record.status === "failed";
            return true;
          });

          for (const item of downstreams) {
            if (cancelled) return;
            const previousContent =
              item.passPreviousResult === false
                ? "（未配置传入上游执行结果）"
                : record.status === "success"
                  ? record.result || "上游任务成功，但没有文本结果"
                  : record.error || "上游任务执行失败";

            await runContextAutomation(
              item,
              "自动化完成触发",
              [
                "【上游自动化执行完成】",
                `上游自动化：${record.name}`,
                `上游状态：${record.status === "success" ? "成功" : "失败"}`,
                `上游运行ID：${record.id}`,
                "上游结果：",
                previousContent,
              ].join("\n"),
            );
          }
        }
      } catch (error) {
        console.error("自动化链式触发失败:", error);
      } finally {
        chainPollBusyRef.current = false;
      }
    }

    processChains();
    return () => {
      cancelled = true;
    };
  }, [automationsLoaded, runRecordsLoaded, runRecords, automations]);

  function testRun() {
    toast.success("测试运行已发起：本次不会影响正式自动化");
  }

  async function testCallback() {
    if (!callbackUrl.trim()) {
      toast.error("请先填写接收 URL");
      return;
    }

    try {
      await axios.post("/api/automation/callback", {
        url: callbackUrl.trim(),
        auth: callbackAuth,
        credential: callbackCredential.trim(),
        payload: {
          event: "automation.test",
          message: "这是一条来自自动化管理的测试数据",
          occurred_at: new Date().toISOString(),
        },
      });
      toast.success("测试数据已发送，请确认接收系统是否正常收到结果");
    } catch (error: any) {
      toast.error(
        error?.response?.data?.detail ||
          error?.response?.data?.error ||
          "测试连接失败",
      );
    }
  }

  function insertVariable(value: string) {
    setPrompt((current) => `${current}${current ? " " : ""}${value}`);
  }

  const reviewEventLabel = (eventType: string) => {
    const labels: Record<string, string> = {
      ai_generated: tt("AI 生成", "AI generated"),
      human_edited: tt("人工修改", "Human edited"),
      regeneration_requested: tt("请求重新生成", "Regeneration requested"),
      regeneration_failed: tt("重新生成失败", "Regeneration failed"),
      approved: tt("审核通过", "Approved"),
      rejected: tt("已驳回", "Rejected"),
    };
    return labels[eventType] || eventType;
  };

  const reviewActionSummary = (record: RunRecord) => {
    const config = record.resultConfigSnapshot || {};
    const parts = [tt("平台内保存", "Save in platform")];
    if (config.resultEmail) {
      parts.push(isEnglish ? `Email: ${config.resultEmail}` : `发送至邮箱 ${config.resultEmail}`);
    }
    if (config.callbackUrl && config.callbackTiming !== "仅任务失败后") {
      parts.push(tt("发送至接收 URL", "Send to result URL"));
    }
    return parts.join(" + ");
  };

  const runActionLabel = (action: RunActionItem) =>
    action.type === "email"
      ? tt("发送结果邮件", "Send result email")
      : action.type === "result_url"
        ? tt("发送至结果接收 URL", "Send to result URL")
        : action.type;

  const runActionStatusLabel = (status: string) => {
    const labels: Record<string, string> = {
      pending: tt("等待执行", "Pending"),
      running: tt("执行中", "Running"),
      success: tt("成功", "Success"),
      failed: tt("失败", "Failed"),
    };
    return labels[status] || status;
  };

  return (
    <div className="mx-auto w-full max-w-[1260px] pb-16">
      <div className="flex items-start justify-between gap-6">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">{tt("自动化管理", "Automation Management")}</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            {tt("让数字员工按照时间或业务事件自动执行任务", "Let digital employees run tasks automatically by time or business events")}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="relative">
            <button
              type="button"
              onClick={() => setNotificationOpen((open) => !open)}
              className="relative inline-flex h-10 w-10 items-center justify-center rounded-md border bg-background text-muted-foreground shadow-sm hover:bg-muted hover:text-foreground"
              title={tt("自动化提醒", "Automation notifications")}
            >
              <Bell className="h-4 w-4" />
              {notificationUnreadCount > 0 && (
                <span className="absolute -right-1.5 -top-1.5 inline-flex min-w-5 items-center justify-center rounded-full bg-red-500 px-1.5 py-0.5 text-[10px] font-bold leading-none text-white">
                  {notificationUnreadCount > 99 ? "99+" : notificationUnreadCount}
                </span>
              )}
            </button>

            {notificationOpen && (
              <div className="absolute right-0 top-12 z-50 w-[390px] max-w-[calc(100vw-2rem)] overflow-hidden rounded-xl border bg-background shadow-xl">
                <div className="flex items-center justify-between border-b px-4 py-3">
                  <div>
                    <div className="text-sm font-semibold">{tt("自动化提醒", "Automation Notifications")}</div>
                    <div className="mt-0.5 text-xs text-muted-foreground">
                      {notificationUnreadCount > 0
                        ? tt(`${notificationUnreadCount} 条未读`, `${notificationUnreadCount} unread`)
                        : tt("暂无未读提醒", "No unread notifications")}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => void markAllNotificationsRead()}
                    disabled={notificationUnreadCount === 0}
                    className="text-xs font-medium text-primary disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    {tt("全部已读", "Mark all read")}
                  </button>
                </div>

                <div className="max-h-[420px] overflow-y-auto">
                  {notifications.length === 0 ? (
                    <div className="px-4 py-10 text-center text-sm text-muted-foreground">
                      {tt("暂无自动化提醒", "No automation notifications")}
                    </div>
                  ) : (
                    notifications.slice(0, 12).map((item) => (
                      <button
                        key={item.eventKey}
                        type="button"
                        onClick={() => void openNotificationItem(item)}
                        className={`block w-full border-b px-4 py-3 text-left last:border-b-0 hover:bg-muted/50 ${
                          item.read ? "bg-background" : "bg-amber-50/40"
                        }`}
                      >
                        <div className="flex items-start gap-2.5">
                          <span
                            className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${
                              item.read
                                ? "bg-slate-300"
                                : item.level === "strong"
                                  ? "bg-red-500"
                                  : "bg-primary"
                            }`}
                          />
                          <div className="min-w-0 flex-1">
                            <div className={`text-sm ${item.read ? "font-medium" : "font-semibold"}`}>
                              {item.title}
                            </div>
                            <div className="mt-1 line-clamp-2 text-xs leading-5 text-muted-foreground">
                              {item.message}
                            </div>
                            <div className="mt-1.5 text-[11px] text-muted-foreground">
                              {new Date(item.createdAt).toLocaleString(isEnglish ? "en-US" : "zh-CN")}
                            </div>
                          </div>
                        </div>
                      </button>
                    ))
                  )}
                </div>

                <div className="border-t px-4 py-2.5 text-xs text-muted-foreground">
                  {tt(
                    "待审核、失败和超时为强提醒；成功为普通提醒。点击提醒可直接打开对应运行记录。",
                    "Pending review, failures, and timeouts are high-priority alerts. Success notifications are standard. Click an item to open its run details.",
                  )}
                </div>
              </div>
            )}
          </div>

          <button
            onClick={openCreateDialog}
            className="rounded-md bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground shadow-sm hover:opacity-90"
          >
            ＋ {tt("新建自动化", "New Automation")}
          </button>
        </div>
      </div>

      <div className="mt-7 flex gap-7 border-b">
        <button
          onClick={() => setActiveTab("automations")}
          className={`relative pb-3 text-sm ${
            activeTab === "automations" ? "font-semibold text-primary" : "text-muted-foreground"
          }`}
        >
          {tt("自动化任务", "Automations")}
          {activeTab === "automations" && (
            <span className="absolute inset-x-0 -bottom-px h-0.5 bg-primary" />
          )}
        </button>
        <button
          onClick={() => setActiveTab("templates")}
          className={`relative pb-3 text-sm ${
            activeTab === "templates" ? "font-semibold text-primary" : "text-muted-foreground"
          }`}
        >
          {tt("自动化模板", "Templates")}
          {activeTab === "templates" && (
            <span className="absolute inset-x-0 -bottom-px h-0.5 bg-primary" />
          )}
        </button>
        <button
          onClick={() => setActiveTab("runs")}
          className={`relative pb-3 text-sm ${
            activeTab === "runs" ? "font-semibold text-primary" : "text-muted-foreground"
          }`}
        >
          {tt("运行记录", "Run History")}
          {activeTab === "runs" && (
            <span className="absolute inset-x-0 -bottom-px h-0.5 bg-primary" />
          )}
        </button>
      </div>

      {activeTab === "automations" ? (
        <>
          <div className="mt-6 flex flex-wrap items-center justify-between gap-4">
            <div className="flex rounded-lg bg-muted p-1">
              {[
                ["all", tt("全部", "All")],
                ["running", tt("运行中", "Running")],
                ["paused", tt("已暂停", "Paused")],
                ["error", tt("异常", "Error")],
              ].map(([value, label]) => (
                <button
                  key={value}
                  onClick={() => setAutoFilter(value as "all" | AutomationStatus)}
                  className={`rounded-md px-3 py-1.5 text-sm ${
                    autoFilter === value
                      ? "bg-background font-semibold text-foreground shadow-sm"
                      : "text-muted-foreground"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>

            <div className="flex items-center gap-2">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <input
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder={tt("搜索自动化", "Search automations")}
                  className="h-10 w-60 rounded-md border bg-background pl-9 pr-3 text-sm outline-none focus:ring-2 focus:ring-primary/20"
                />
              </div>

              <button
                onClick={() => setViewMode("list")}
                className={`grid h-10 w-10 place-items-center rounded-md border ${
                  viewMode === "list" ? "bg-primary text-primary-foreground" : "bg-background"
                }`}
                aria-label={tt("列表视图", "List view")}
              >
                <List className="h-4 w-4" />
              </button>
              <button
                onClick={() => setViewMode("grid")}
                className={`grid h-10 w-10 place-items-center rounded-md border ${
                  viewMode === "grid" ? "bg-primary text-primary-foreground" : "bg-background"
                }`}
                aria-label={tt("卡片视图", "Grid view")}
              >
                <LayoutGrid className="h-4 w-4" />
              </button>
            </div>
          </div>

          {filteredAutomations.length === 0 ? (
            <div className="py-20 text-center">
              <div className="text-sm text-muted-foreground">{tt("当前暂无自动化任务", "No automations yet")}</div>
              <div className="mt-2 text-xs text-muted-foreground">
                {tt("可以新建自动化，或从模板快速创建。", "Create a new automation or start from a template.")}
              </div>
              <div className="mt-5 flex justify-center gap-3">
                <button
                  onClick={openCreateDialog}
                  className="rounded-md bg-primary px-3.5 py-2 text-sm font-semibold text-primary-foreground"
                >
                  {tt("新建自动化", "New Automation")}
                </button>
                <button
                  onClick={() => setActiveTab("templates")}
                  className="rounded-md border bg-background px-3.5 py-2 text-sm font-semibold hover:bg-muted"
                >
                  {tt("查看模板", "View Templates")}
                </button>
              </div>
            </div>
          ) : viewMode === "grid" ? (
            <div className="mt-6 grid grid-cols-1 gap-5 lg:grid-cols-2 xl:grid-cols-3">
              {filteredAutomations.map((item) => (
                <article
                  key={item.id}
                  onClick={() => setDrawerAutomationId(item.id)}
                  className={`relative min-h-[205px] cursor-pointer rounded-xl border p-6 transition ${
                    item.status === "paused"
                      ? "bg-muted/40 opacity-70 hover:translate-y-0 hover:shadow-none"
                      : "bg-background hover:-translate-y-0.5 hover:shadow-md"
                  }`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex min-w-0 items-center gap-3">
                      <div className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-muted text-muted-foreground">
                        <TriggerIcon trigger={item.trigger} />
                      </div>
                      <div className="truncate text-lg font-bold">{item.name}</div>
                    </div>
                    <StatusBadge status={item.status} text={statusLabel(item.statusText, item.status)} />
                  </div>

                  <div className="mt-5 grid gap-2.5 text-sm text-muted-foreground">
                    <div className="flex gap-3">
                      <span className="w-16 shrink-0 text-muted-foreground/70">{tt("触发方式", "Trigger")}</span>
                      <span>{triggerLabel(item.trigger)}</span>
                    </div>
                    <div className="flex gap-3">
                      <span className="w-16 shrink-0 text-muted-foreground/70">{tt("数字员工", "Digital Employee")}</span>
                      <span>{item.agent}</span>
                    </div>
                    <div className="flex gap-3">
                      <span className="w-16 shrink-0 text-muted-foreground/70">{tt("执行策略", "Execution Strategy")}</span>
                      <span>{strategyLabel(item.strategy)}</span>
                    </div>
                  </div>

                  <div className="absolute bottom-5 left-6 right-6 flex items-center justify-between gap-3 text-xs text-muted-foreground">
                    <span>{displayTime(item.time)}</span>
                    <button
                      onClick={(event) => {
                        event.stopPropagation();
                        runNow(item);
                      }}
                      className="inline-flex items-center gap-1.5 rounded-md border bg-background px-2.5 py-1.5 text-foreground hover:bg-muted"
                    >
                      <Play className="h-3.5 w-3.5" />
                      {tt("立即运行", "Run Now")}
                    </button>
                  </div>
                </article>
              ))}
            </div>
          ) : (
            <div className="mt-6 overflow-hidden rounded-xl border">
              <div className="grid grid-cols-[1.5fr_.9fr_1fr_1.15fr_.8fr_70px] gap-4 bg-muted/50 px-4 py-3 text-xs text-muted-foreground">
                <div>{tt("自动化名称", "Automation")}</div>
                <div>{tt("触发方式", "Trigger")}</div>
                <div>{tt("数字员工", "Digital Employee")}</div>
                <div>{tt("最近 / 下次执行", "Last / Next Run")}</div>
                <div>{tt("状态", "Status")}</div>
                <div />
              </div>
              {filteredAutomations.map((item) => (
                <div
                  key={item.id}
                  className={`grid grid-cols-[1.5fr_.9fr_1fr_1.15fr_.8fr_70px] items-center gap-4 border-t px-4 py-4 text-sm transition ${
                    item.status === "paused" ? "bg-muted/30 opacity-70" : "bg-background"
                  }`}
                >
                  <div className="font-semibold">{item.name}</div>
                  <div className="text-muted-foreground">{triggerLabel(item.trigger)}</div>
                  <div className="text-muted-foreground">{item.agent}</div>
                  <div className="text-muted-foreground">{displayTime(item.time)}</div>
                  <div><StatusBadge status={item.status} text={statusLabel(item.statusText, item.status)} /></div>
                  <button
                    onClick={() => setDrawerAutomationId(item.id)}
                    className="text-sm text-primary hover:underline"
                  >
                    {tt("查看", "View")}
                  </button>
                </div>
              ))}
            </div>
          )}
        </>
      ) : activeTab === "templates" ? (
        <>
          <div className="mt-6">
            <div>
              <h2 className="text-lg font-bold">{tt("自动化模板", "Automation Templates")}</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                {tt("选择常用场景快速创建，模板只预填任务与触发方式，数字员工仍由用户选择。", "Choose a common scenario to create quickly. Templates prefill the task and trigger; you still choose the digital employee.")}
              </p>
            </div>

            <div className="mt-6 grid grid-cols-1 gap-5 lg:grid-cols-2 xl:grid-cols-3">
              {automationTemplates.map((template) => (
                <article
                  key={template.id}
                  className="flex min-h-[225px] flex-col rounded-xl border bg-background p-6 transition hover:-translate-y-0.5 hover:shadow-md"
                >
                  <div className="flex items-start gap-3">
                    <div className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-muted text-muted-foreground">
                      <TriggerIcon trigger={template.trigger} />
                    </div>
                    <div>
                      <div className="text-lg font-bold">{templateText(template).name}</div>
                      <div className="mt-1 text-xs text-muted-foreground">{triggerLabel(template.trigger)}</div>
                    </div>
                  </div>

                  <p className="mt-4 flex-1 text-sm leading-6 text-muted-foreground">
                    {templateText(template).description}
                  </p>

                  <div className="mt-5 flex items-center justify-between gap-3">
                    <span className="text-xs text-muted-foreground">{strategyLabel(template.strategy)}</span>
                    <button
                      onClick={() => useTemplate(template)}
                      className="rounded-md border bg-background px-3 py-1.5 text-sm font-semibold hover:bg-muted"
                    >
                      {tt("使用模板", "Use Template")}
                    </button>
                  </div>
                </article>
              ))}
            </div>
          </div>
        </>
      ) : (
        <>
          <div className="mt-6 flex flex-wrap items-center justify-between gap-4">
            <div className="flex rounded-lg bg-muted p-1">
              {[
                ["all", tt("全部", "All")],
                ["success", tt("成功", "Success")],
                ["failed", tt("失败", "Failed")],
                ["running", tt("执行中", "Running")],
                ["pending", tt("待审核", "Pending Review")],
                ["regenerating", tt("重新生成中", "Regenerating")],
                ["rejected", tt("已驳回", "Rejected")],
                ["timed_out", tt("已超时", "Timed Out")],
              ].map(([value, label]) => (
                <button
                  key={value}
                  onClick={() => setRunFilter(value as "all" | RunStatus)}
                  className={`rounded-md px-3 py-1.5 text-sm ${
                    runFilter === value
                      ? "bg-background font-semibold text-foreground shadow-sm"
                      : "text-muted-foreground"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>

            <div className="relative">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <input
                value={runSearch}
                onChange={(event) => setRunSearch(event.target.value)}
                placeholder={tt("搜索运行记录", "Search run history")}
                className="h-10 w-60 rounded-md border bg-background pl-9 pr-3 text-sm outline-none focus:ring-2 focus:ring-primary/20"
              />
            </div>
          </div>

          {filteredRuns.length === 0 ? (
            <div className="py-20 text-center text-sm text-muted-foreground">
              {tt("当前筛选条件下暂无运行记录", "No run records match the current filter")}
            </div>
          ) : (
            <div className="mt-6 overflow-hidden rounded-xl border">
              <div className="grid grid-cols-[1.05fr_1.45fr_.9fr_1fr_.8fr_.7fr_70px] gap-4 bg-muted/50 px-4 py-3 text-xs text-muted-foreground">
                <div>{tt("时间", "Time")}</div>
                <div>{tt("自动化", "Automation")}</div>
                <div>{tt("触发方式", "Trigger")}</div>
                <div>{tt("数字员工", "Digital Employee")}</div>
                <div>{tt("状态", "Status")}</div>
                <div>{tt("耗时", "Duration")}</div>
                <div />
              </div>
              {filteredRuns.map((item) => (
                <div
                  key={item.id}
                  className="grid grid-cols-[1.05fr_1.45fr_.9fr_1fr_.8fr_.7fr_70px] items-center gap-4 border-t px-4 py-4 text-sm"
                >
                  <div className="text-muted-foreground">{displayTime(item.time)}</div>
                  <div className="font-semibold">{item.name}</div>
                  <div className="text-muted-foreground">{triggerLabel(item.trigger)}</div>
                  <div className="text-muted-foreground">{item.agent}</div>
                  <div><StatusBadge status={item.status} text={statusLabel(item.statusText, item.status)} /></div>
                  <div className="text-muted-foreground">{item.duration}</div>
                  <button
                    onClick={() => setDrawerRunId(item.id)}
                    className="text-sm text-primary hover:underline"
                  >
                    {tt("详情", "Details")}
                  </button>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {dialogOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/30 p-5">
          <div className="flex max-h-[90vh] w-full max-w-4xl flex-col overflow-hidden rounded-2xl bg-background shadow-2xl">
            <div className="flex items-center justify-between border-b px-7 py-5">
              <div className="text-xl font-bold">
                {editingAutomationId != null
                  ? tt("编辑自动化", "Edit Automation")
                  : tt("新建自动化", "New Automation")}
              </div>
              <button
                onClick={() => setDialogOpen(false)}
                className="grid h-9 w-9 place-items-center rounded-md bg-muted text-muted-foreground"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="flex items-center gap-2 border-b bg-muted/40 px-7 py-4">
              {[
                [1, tt("任务配置", "Task Setup")],
                [2, tt("触发方式", "Trigger")],
                [3, tt("执行策略", "Execution Strategy")],
              ].map(([value, label], index) => (
                <div key={value} className="flex flex-1 items-center gap-2">
                  <div className={`flex items-center gap-2 text-xs ${step >= Number(value) ? "font-semibold text-foreground" : "text-muted-foreground"}`}>
                    <span className={`grid h-6 w-6 place-items-center rounded-full border text-xs ${step >= Number(value) ? "border-primary bg-primary text-primary-foreground" : "bg-background"}`}>
                      {value}
                    </span>
                    {label}
                  </div>
                  {index < 2 && <div className="h-px flex-1 bg-border" />}
                </div>
              ))}
            </div>

            <div className="overflow-y-auto px-7 py-6">
              {step === 1 && (
                <div>
                  <h3 className="mb-4 text-base font-bold">{tt("任务配置", "Task Setup")}</h3>

                  <Field label={tt("自动化名称", "Automation Name")}>
                    <input
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      className="input-base"
                      placeholder={tt("例如：客户询价自动处理", "e.g. Customer inquiry handling")}
                    />
                  </Field>

                  <Field label={tt("数字员工", "Digital Employee")}>
                    <select
                      value={selectedAppId ?? ""}
                      onChange={(e) => setSelectedAppId(Number(e.target.value))}
                      className="input-base"
                      disabled={appsLoading || apps.length === 0}
                    >
                      {appsLoading && <option value="">{tt("加载中...", "Loading...")}</option>}
                      {!appsLoading && apps.length === 0 && <option value="">{tt("暂无可用数字员工", "No digital employees available")}</option>}
                      {apps.map((app) => (
                        <option key={app.id} value={app.id}>{app.name}</option>
                      ))}
                    </select>
                  </Field>

                  <div className="mt-3 rounded-xl border bg-muted/40 px-4 py-3 text-xs leading-6 text-muted-foreground">
                    {tt("数字员工将直接使用其已绑定的 Skill 执行任务，无需在自动化中重复配置 Skill。", "The digital employee will use its bound Skills directly; no need to configure Skills again in the automation.")}
                  </div>

                  <Field label={tt("任务说明", "Task Description")}>
                    <textarea
                      value={prompt}
                      onChange={(e) => setPrompt(e.target.value)}
                      className="input-base min-h-28 resize-y"
                      placeholder={tt("描述数字员工需要完成的任务", "Describe what the digital employee should do")}
                    />
                  </Field>

                  <Field label={tt("结果发送", "Result Delivery")}>
                    <div className="rounded-xl border bg-muted/30 p-4">
                      <div className="mb-4 text-xs leading-6 text-muted-foreground">
                        {tt("自动化执行完成后，可将最终结果通过完成通知邮箱或接收 URL 发送出去。两项都留空时，结果仅保存在平台内。", "After execution, the final result can be sent through a completion notification email or a receiving URL. Leave both blank to keep results only in the platform.")}
                      </div>

                      <Field label={tt("完成通知邮箱（选填）", "Completion Notification Email (optional)")} compact>
                        <input
                          type="email"
                          value={mailResultEmail}
                          onChange={(e) => setMailResultEmail(e.target.value)}
                          className="input-base"
                          placeholder={tt("例如：manager@company.com", "e.g. manager@company.com")}
                        />
                        <div className="mt-1.5 text-xs leading-5 text-muted-foreground">
                          {tt("任务完成后，可将最终结果作为完成通知发送到该邮箱；它不是邮件触发的监听邮箱。留空则不发送邮件通知。", "After the task finishes, the final result can be sent to this address as a completion notification. This is separate from the mailbox monitored by an email trigger. Leave it blank to skip email notification.")}
                        </div>
                        {mailResultEmail.trim() && (
                          <label className="mt-3 flex cursor-pointer items-start gap-2 rounded-lg border bg-background px-3 py-2.5">
                            <input
                              type="checkbox"
                              checked={resultEmailIncludeAttachments}
                              onChange={(e) => setResultEmailIncludeAttachments(e.target.checked)}
                              className="mt-0.5 h-4 w-4"
                            />
                            <span>
                              <span className="block text-sm font-medium text-foreground">
                                {tt("附带数字员工生成的文件", "Attach files generated by the digital employee")}
                              </span>
                              <span className="mt-0.5 block text-xs leading-5 text-muted-foreground">
                                {tt("若本次任务生成了平台文件，将与执行结果一起作为邮件附件发送；没有生成文件时仍只发送正文。", "If this run generated platform files, they will be attached to the completion email. If no files were generated, only the email body is sent.")}
                              </span>
                            </span>
                          </label>
                        )}
                      </Field>

                      <Field label={tt("接收 URL（选填）", "Callback URL (optional)")} compact>
                        <input
                          value={callbackUrl}
                          onChange={(e) => setCallbackUrl(e.target.value)}
                          className="input-base"
                          placeholder="https://example.com/api/result"
                        />
                        <div className="mt-1.5 text-xs leading-5 text-muted-foreground">
                          {tt("填写用于接收自动化执行结果的 URL，通常由贵公司的系统管理员或技术人员提供。", "Enter the URL that receives automation results. It is usually provided by your system administrator or technical team.")}
                        </div>
                      </Field>

                      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                        <Field label={tt("发送时机", "Send Timing")} compact>
                          <select
                            value={callbackTiming}
                            onChange={(e) => setCallbackTiming(e.target.value)}
                            className="input-base"
                          >
                            <option value="任务结束后（推荐）">{tt("任务结束后（推荐）", "After task completion (recommended)")}</option>
                            <option value="仅任务成功后">{tt("仅任务成功后", "Only after success")}</option>
                            <option value="仅任务失败后">{tt("仅任务失败后", "Only after failure")}</option>
                          </select>
                        </Field>

                        <Field label={tt("安全验证", "Authentication")} compact>
                          <select
                            value={callbackAuth}
                            onChange={(e) => setCallbackAuth(e.target.value)}
                            className="input-base"
                          >
                            <option value="无需验证">{tt("无需验证", "No authentication")}</option>
                            <option value="Token 验证">{tt("Token 验证", "Token authentication")}</option>
                            <option value="自定义请求头">{tt("自定义请求头", "Custom header")}</option>
                          </select>
                        </Field>
                      </div>

                      {callbackAuth !== "无需验证" && (
                        <Field label={callbackAuth === "Token 验证" ? "Token" : tt("请求头信息", "Header Information")} compact>
                          <input
                            value={callbackCredential}
                            onChange={(e) => setCallbackCredential(e.target.value)}
                            className="input-base"
                            placeholder={
                              callbackAuth === "Token 验证"
                                ? tt("请输入接收系统提供的 Token", "Enter the token provided by the receiving system")
                                : tt("例如：X-API-Key: abc123", "e.g. X-API-Key: abc123")
                            }
                          />
                          <div className="mt-1.5 text-xs leading-5 text-muted-foreground">
                            {callbackAuth === "Token 验证"
                              ? tt("Token 由接收结果的业务系统提供，如不确定请向系统管理员确认。", "The token is provided by the receiving business system. Ask your system administrator if unsure.")
                              : tt("填写接收系统要求的请求头信息，通常由系统管理员或技术人员提供。", "Enter the header required by the receiving system. It is usually provided by your system administrator or technical team.")}
                          </div>
                        </Field>
                      )}

                      <div className="mt-4 flex items-center justify-between gap-4">
                        <div className="text-xs text-muted-foreground">
                          {tt("测试连接会发送一条测试数据，用于确认该 URL 能否正常接收结果。", "Test Connection sends sample data to verify that the URL can receive results.")}
                        </div>
                        <button onClick={testCallback} type="button" className="btn-secondary shrink-0">
                          {tt("测试连接", "Test Connection")}
                        </button>
                      </div>
                    </div>
                  </Field>
                </div>
              )}

              {step === 2 && (
                <div>
                  <h3 className="mb-4 text-base font-bold">{tt("选择触发方式", "Choose Trigger")}</h3>

                  <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                    {(
                      [
                        ["定时触发", tt("按照指定时间自动运行", "Run automatically on a schedule")],
                        ["邮件触发", tt("邮箱收到符合规则的新邮件后自动处理", "Process new emails that match configured rules")],
                        ["Webhook / API", tt("由 ERP、CRM 等外部系统触发", "Triggered by ERP, CRM, or other external systems")],
                        ["自动化完成触发", tt("当另一个自动化结束后运行", "Run after another automation completes")],
                      ] as [TriggerType, string][]
                    ).map(([value, desc]) => (
                      <button
                        key={value}
                        onClick={() => setTrigger(value)}
                        className={`rounded-xl border p-4 text-left transition ${
                          trigger === value
                            ? "border-primary bg-primary/5 ring-2 ring-primary/10"
                            : "bg-background hover:bg-muted/30"
                        }`}
                      >
                        <strong className="block text-sm">{triggerLabel(value)}</strong>
                        <span className="mt-1 block text-xs text-muted-foreground">{desc}</span>
                      </button>
                    ))}
                  </div>

                  <div className="mt-4 rounded-xl border bg-muted/30 p-4">
                    {trigger === "定时触发" && (
                      <>
                        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                          <Field label={tt("执行周期", "Schedule")} compact>
                            <select
                              value={schedulePeriod}
                              onChange={(e) => setSchedulePeriod(e.target.value)}
                              className="input-base"
                            >
                              <option value="每天">{tt("每天", "Daily")}</option>
                              <option value="每周">{tt("每周", "Weekly")}</option>
                              <option value="每月">{tt("每月", "Monthly")}</option>
                              <option value="仅一次">{tt("仅一次", "Once")}</option>
                            </select>
                          </Field>
                          <Field label={tt("执行时间", "Run Time")} compact>
                            <input
                              type="time"
                              value={scheduleTime}
                              onChange={(e) => setScheduleTime(e.target.value)}
                              className="input-base"
                            />
                          </Field>
                        </div>

                        {schedulePeriod === "每周" && (
                          <Field label={tt("执行星期", "Run on")} compact>
                            <div className="flex flex-wrap gap-2">
                              {weekdayOptions.map((option) => {
                                const selected = scheduleWeekdays.includes(option.value);
                                return (
                                  <button
                                    key={option.value}
                                    type="button"
                                    onClick={() =>
                                      setScheduleWeekdays((current) =>
                                        selected
                                          ? current.filter((value) => value !== option.value)
                                          : [...current, option.value],
                                      )
                                    }
                                    className={`rounded-lg border px-3 py-2 text-sm transition ${
                                      selected
                                        ? "border-primary bg-primary/10 font-medium text-primary"
                                        : "bg-background hover:bg-muted/40"
                                    }`}
                                  >
                                    {tt(option.zh, option.en)}
                                  </button>
                                );
                              })}
                            </div>
                            <div className="mt-1.5 text-xs text-muted-foreground">
                              {tt(
                                "至少选择一个星期，可同时选择多个。",
                                "Select at least one weekday; multiple days are supported.",
                              )}
                            </div>
                          </Field>
                        )}

                        {schedulePeriod === "每月" && (
                          <Field label={tt("执行日期", "Run Date")} compact>
                            <div className="space-y-3">
                              <label
                                className={`block cursor-pointer rounded-xl border p-4 transition ${
                                  scheduleMonthlyMode === "fixed_day"
                                    ? "border-primary bg-primary/5 ring-1 ring-primary/10"
                                    : "bg-background hover:bg-muted/30"
                                }`}
                              >
                                <div className="flex items-center gap-3">
                                  <input
                                    type="radio"
                                    name="schedule-monthly-mode"
                                    checked={scheduleMonthlyMode === "fixed_day"}
                                    onChange={() => {
                                      setScheduleMonthlyMode("fixed_day");
                                      if (!scheduleDayOfMonth) setScheduleDayOfMonth(1);
                                    }}
                                  />
                                  <span className="text-sm font-medium">
                                    {tt("每月固定日期", "Fixed day each month")}
                                  </span>
                                  <select
                                    value={scheduleDayOfMonth ?? ""}
                                    onClick={(e) => e.stopPropagation()}
                                    onChange={(e) => {
                                      setScheduleMonthlyMode("fixed_day");
                                      setScheduleDayOfMonth(Number(e.target.value));
                                    }}
                                    className="ml-auto min-w-28 rounded-lg border bg-background px-3 py-2 text-sm"
                                  >
                                    <option value="" disabled>
                                      {tt("选择日期", "Choose day")}
                                    </option>
                                    {Array.from({ length: 31 }, (_, index) => index + 1).map((day) => (
                                      <option key={day} value={day}>
                                        {tt(`${day}日`, `Day ${day}`)}
                                      </option>
                                    ))}
                                  </select>
                                </div>
                              </label>

                              <label
                                className={`block cursor-pointer rounded-xl border p-4 transition ${
                                  scheduleMonthlyMode === "last_day"
                                    ? "border-primary bg-primary/5 ring-1 ring-primary/10"
                                    : "bg-background hover:bg-muted/30"
                                }`}
                              >
                                <div className="flex items-start gap-3">
                                  <input
                                    type="radio"
                                    name="schedule-monthly-mode"
                                    checked={scheduleMonthlyMode === "last_day"}
                                    onChange={() => setScheduleMonthlyMode("last_day")}
                                    className="mt-0.5"
                                  />
                                  <div>
                                    <div className="text-sm font-medium">
                                      {tt("每月最后一天", "Last day of each month")}
                                    </div>
                                    <div className="mt-1 text-xs leading-5 text-muted-foreground">
                                      {tt(
                                        "自动按当月实际最后一天执行；2月会自动识别28日或闰年的29日。",
                                        "Runs on the actual last day of each month; February automatically uses the 28th or the 29th in a leap year.",
                                      )}
                                    </div>
                                  </div>
                                </div>
                              </label>

                              {scheduleMonthlyMode === "fixed_day" && Number(scheduleDayOfMonth) >= 29 && (
                                <div className="rounded-xl border border-amber-200 bg-amber-50/60 p-4">
                                  <div className="text-sm font-medium text-amber-900">
                                    {tt(
                                      "提醒：当前日期并非每个月都存在",
                                      "Reminder: this date does not exist in every month",
                                    )}
                                  </div>
                                  <div className="mt-1 text-xs leading-5 text-amber-800">
                                    {tt(
                                      "请选择当月没有该日期时的处理方式。2月天数会按普通年份和闰年自动判断。",
                                      "Choose what to do when that date does not exist. February is handled automatically for normal and leap years.",
                                    )}
                                  </div>
                                  <div className="mt-3 space-y-2">
                                    <label className="flex cursor-pointer items-start gap-2 text-sm">
                                      <input
                                        type="radio"
                                        name="schedule-missing-day"
                                        checked={scheduleMissingDayPolicy === "skip"}
                                        onChange={() => setScheduleMissingDayPolicy("skip")}
                                        className="mt-0.5"
                                      />
                                      <span>{tt("跳过该月", "Skip that month")}</span>
                                    </label>
                                    <label className="flex cursor-pointer items-start gap-2 text-sm">
                                      <input
                                        type="radio"
                                        name="schedule-missing-day"
                                        checked={scheduleMissingDayPolicy === "last_day"}
                                        onChange={() => setScheduleMissingDayPolicy("last_day")}
                                        className="mt-0.5"
                                      />
                                      <span>
                                        {tt(
                                          "改为当月最后一天执行",
                                          "Run on the last day of that month instead",
                                        )}
                                      </span>
                                    </label>
                                  </div>
                                </div>
                              )}
                            </div>
                          </Field>
                        )}

                        {schedulePeriod === "仅一次" && (
                          <Field label={tt("执行日期", "Run Date")} compact>
                            <input
                              type="date"
                              value={scheduleDate}
                              onChange={(e) => setScheduleDate(e.target.value)}
                              className="input-base"
                            />
                            <div className="mt-1.5 text-xs text-muted-foreground">
                              {tt(
                                "请选择具体日期；任务执行完成后会自动暂停。",
                                "Choose a specific date. The automation pauses after this run.",
                              )}
                            </div>
                          </Field>
                        )}

                        <Field label={tt("时区", "Time Zone")} compact>
                          <select
                            value={scheduleTimezone}
                            onChange={(e) => setScheduleTimezone(e.target.value)}
                            className="input-base"
                          >
                            <option value="Asia/Shanghai">Asia/Shanghai (UTC+8)</option>
                            <option value="Asia/Tokyo">Asia/Tokyo (UTC+9)</option>
                            <option value="America/New_York">
                              {tt(
                                "America/New_York（自动适配夏令时）",
                                "America/New_York (DST aware)",
                              )}
                            </option>
                            <option value="UTC">UTC</option>
                          </select>
                        </Field>
                      </>
                    )}

                    {trigger === "邮件触发" && (
                      <>
                        <Field label={tt("监听邮箱", "Monitored Mailbox")} compact>
                          <div className="flex gap-2">
                            <select
                              value={mailboxKey}
                              onChange={(e) => {
                                const nextKey = e.target.value;
                                setMailboxKey(nextKey);
                                if (nextKey === "system") {
                                  setMailboxLabel("系统邮箱");
                                  setMailFolder("INBOX");
                                } else {
                                  const mailbox = connectedMailboxes.find((item) => item.key === nextKey);
                                  setMailboxLabel(mailbox?.label || mailbox?.email || nextKey);
                                  setMailFolder(mailbox?.folder || "INBOX");
                                }
                              }}
                              className="input-base flex-1"
                            >
                              <option value="system">{tt("系统邮箱（系统设置）", "System Mailbox (System Settings)")}</option>
                              {connectedMailboxes.map((mailbox) => (
                                <option key={mailbox.id} value={mailbox.key}>
                                  {mailbox.label || mailbox.email}
                                </option>
                              ))}
                            </select>
                            <button
                              type="button"
                              onClick={() => setMailboxConnectOpen((open) => !open)}
                              className="shrink-0 rounded-lg border px-3 py-2 text-xs font-medium hover:bg-muted/40"
                            >
                              {tt("连接新邮箱", "Connect Mailbox")}
                            </button>
                          </div>
                          <div className="mt-1.5 text-xs leading-5 text-muted-foreground">
                            {tt("每个自动化只监听这里选中的邮箱；监听邮箱与完成通知邮箱相互独立。", "Each automation monitors only the mailbox selected here. This is separate from the completion notification email.")}
                          </div>

                          {mailboxConnectOpen && (
                            <div className="mt-3 space-y-3 rounded-lg border bg-muted/20 p-3">
                              <div className="text-sm font-semibold">{tt("连接企业邮箱", "Connect Enterprise Mailbox")}</div>
                              <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                                <input value={newMailboxName} onChange={(e) => setNewMailboxName(e.target.value)} className="input-base" placeholder={tt("邮箱名称，例如：销售邮箱", "Mailbox name, e.g. Sales")} />
                                <input type="email" value={newMailboxEmail} onChange={(e) => {
                                  const nextEmail = e.target.value;
                                  setNewMailboxEmail(nextEmail);
                                  if (!newMailboxUsername || newMailboxUsername === newMailboxEmail) setNewMailboxUsername(nextEmail);
                                  if (!newMailboxImapHost || newMailboxImapHost === defaultImapHost(newMailboxEmail)) setNewMailboxImapHost(defaultImapHost(nextEmail));
                                }} className="input-base" placeholder={tt("邮箱地址", "Email address")} />
                                <input value={newMailboxUsername} onChange={(e) => setNewMailboxUsername(e.target.value)} className="input-base" placeholder={tt("登录账号（通常与邮箱一致）", "Login username")} />
                                <input type="password" value={newMailboxPassword} onChange={(e) => setNewMailboxPassword(e.target.value)} className="input-base" placeholder={tt("邮箱授权码 / 密码", "App password / password")} autoComplete="new-password" />
                                <input value={newMailboxImapHost} onChange={(e) => setNewMailboxImapHost(e.target.value)} className="input-base" placeholder="imap.company.com" />
                                <input type="number" min={1} max={65535} value={newMailboxImapPort} onChange={(e) => setNewMailboxImapPort(Number(e.target.value || 993))} className="input-base" placeholder="993" />
                              </div>
                              <label className="flex items-center gap-2 text-xs text-muted-foreground">
                                <input type="checkbox" checked={newMailboxImapSecure} onChange={(e) => setNewMailboxImapSecure(e.target.checked)} />
                                {tt("使用 SSL 安全连接（通常为 993 端口）", "Use SSL (usually port 993)")}
                              </label>
                              <div className="flex justify-end gap-2">
                                <button type="button" onClick={() => setMailboxConnectOpen(false)} className="rounded-lg border px-3 py-2 text-xs hover:bg-background">{tt("取消", "Cancel")}</button>
                                <button type="button" onClick={() => void connectMailbox()} disabled={mailboxSaving} className="rounded-lg bg-foreground px-3 py-2 text-xs font-medium text-background disabled:opacity-50">
                                  {mailboxSaving ? tt("正在验证…", "Verifying…") : tt("验证并连接", "Verify & Connect")}
                                </button>
                              </div>
                              <div className="text-xs leading-5 text-muted-foreground">
                                {tt("密码或授权码只在服务端加密保存，页面不会再次显示。企业邮箱如禁用 IMAP，需要管理员先在邮箱后台开启。", "The password/app password is encrypted on the server and is never shown again. IMAP must be enabled by the mailbox administrator if disabled.")}
                              </div>
                            </div>
                          )}
                        </Field>

                        <Field label={tt("监听文件夹", "Monitored Folder")} compact>
                          <select value={mailFolder} onChange={(e) => setMailFolder(e.target.value)} className="input-base">
                            <option value="INBOX">{tt("收件箱", "Inbox")}</option>
                          </select>
                        </Field>

                        <Field label={tt("触发条件", "Trigger Conditions")} compact>
                          <div className="space-y-3 rounded-lg border bg-background p-3">
                            <div className="flex flex-wrap items-center justify-between gap-3">
                              <select value={mailRuleMode} onChange={(e) => setMailRuleMode(e.target.value === "any" ? "any" : "all")} className="input-base max-w-[220px]">
                                <option value="all">{tt("满足全部条件（AND）", "Match all conditions (AND)")}</option>
                                <option value="any">{tt("满足任一条件（OR）", "Match any condition (OR)")}</option>
                              </select>
                              <button type="button" onClick={() => setMailRules((rules) => [...rules, newMailRule()])} className="rounded-lg border px-3 py-2 text-xs font-medium hover:bg-muted/40">
                                {tt("+ 添加条件", "+ Add condition")}
                              </button>
                            </div>

                            {mailRules.length === 0 ? (
                              <div className="rounded-lg bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
                                {tt("未添加条件时，收到新邮件即触发。", "With no conditions, every new email triggers the automation.")}
                              </div>
                            ) : (
                              <div className="space-y-2">
                                {mailRules.map((rule) => (
                                  <div key={rule.id} className="grid grid-cols-1 gap-2 rounded-lg border p-2 md:grid-cols-[1fr_1fr_1.4fr_auto]">
                                    <select value={rule.field} onChange={(e) => {
                                      const field = e.target.value as MailRuleField;
                                      setMailRules((rules) => rules.map((item) => item.id === rule.id ? {
                                        ...item, field,
                                        operator: field === "是否包含附件" ? "是否存在" : item.operator === "是否存在" ? "包含" : item.operator,
                                        value: field === "是否包含附件" ? "是" : item.value,
                                      } : item));
                                    }} className="input-base">
                                      {MAIL_RULE_FIELDS.map((field) => <option key={field} value={field}>{field}</option>)}
                                    </select>

                                    <select value={rule.field === "是否包含附件" ? "是否存在" : rule.operator} disabled={rule.field === "是否包含附件"} onChange={(e) => setMailRules((rules) => rules.map((item) => item.id === rule.id ? { ...item, operator: e.target.value as MailRuleOperator } : item))} className="input-base disabled:opacity-60">
                                      {MAIL_RULE_OPERATORS.map((operator) => <option key={operator} value={operator}>{operator}</option>)}
                                    </select>

                                    {rule.operator === "是否存在" || rule.field === "是否包含附件" ? (
                                      <select value={rule.value || "是"} onChange={(e) => setMailRules((rules) => rules.map((item) => item.id === rule.id ? { ...item, value: e.target.value } : item))} className="input-base">
                                        <option value="是">{tt("是", "Yes")}</option>
                                        <option value="否">{tt("否", "No")}</option>
                                      </select>
                                    ) : (
                                      <input value={rule.value} onChange={(e) => setMailRules((rules) => rules.map((item) => item.id === rule.id ? { ...item, value: e.target.value } : item))} className="input-base" placeholder={tt("填写条件值", "Enter value")} />
                                    )}

                                    <button type="button" onClick={() => setMailRules((rules) => rules.filter((item) => item.id !== rule.id))} className="rounded-lg border px-3 py-2 text-xs hover:bg-muted/40">
                                      {tt("删除", "Remove")}
                                    </button>
                                  </div>
                                ))}
                              </div>
                            )}

                            <div className="text-xs leading-5 text-muted-foreground">
                              {tt("“包含”只做文字包含判断，不进行语义推断。", "Contains performs literal text matching only; it does not use semantic inference.")}
                            </div>
                          </div>
                        </Field>

                        <Field label={tt("规则优先级", "Rule Priority")} compact>
                          <input type="number" min={0} max={100} value={mailPriority} onChange={(e) => setMailPriority(Math.max(0, Math.min(100, Number(e.target.value) || 0)))} className="input-base" />
                          <div className="mt-1.5 text-xs leading-5 text-muted-foreground">
                            {tt("同一封邮件同时命中多个自动化时，只执行优先级最高的一条。建议使用 0–100。", "If multiple automations match the same email, only the highest-priority one runs. Recommended range: 0–100.")}
                          </div>
                        </Field>

                        {mailConflictCandidates.length > 0 && (
                          <div className="rounded-lg border border-amber-200 bg-amber-50/70 px-3 py-3 text-amber-950">
                            <div className="text-xs font-semibold">
                              {tt("检测到同一监听范围内存在其他邮件自动化", "Other email automations use the same monitored mailbox")}
                            </div>
                            <div className="mt-1 text-xs leading-5 text-amber-900/80">
                              {tt(
                                "这些规则可能同时命中同一封邮件。平台仍只会执行优先级最高的一条，建议确认优先级是否符合业务顺序。",
                                "These rules may match the same email. The platform still runs only the highest-priority automation, so confirm that the priority order matches the business requirement.",
                              )}
                            </div>
                            <div className="mt-2 space-y-1.5">
                              {mailConflictCandidates.slice(0, 3).map(({ item, level, priority }) => (
                                <div key={item.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-amber-200/80 bg-white/70 px-2.5 py-2 text-xs">
                                  <div className="min-w-0">
                                    <span className="font-medium">{item.name}</span>
                                    <span className="ml-2 text-amber-800/70">
                                      {level === "high"
                                        ? tt("规则高度重叠", "High overlap")
                                        : tt("存在潜在重叠", "Potential overlap")}
                                    </span>
                                  </div>
                                  <div className="shrink-0">
                                    {tt("优先级", "Priority")} {priority}
                                  </div>
                                </div>
                              ))}
                              {mailConflictCandidates.length > 3 && (
                                <div className="text-xs text-amber-800/70">
                                  {tt(
                                    `另有 ${mailConflictCandidates.length - 3} 条同范围邮件自动化`,
                                    `${mailConflictCandidates.length - 3} more email automations use the same scope`,
                                  )}
                                </div>
                              )}
                            </div>
                            {mailConflictCandidates.some(({ priority }) => priority > mailPriority) && (
                              <div className="mt-2 text-xs font-medium leading-5">
                                {tt(
                                  "当前优先级低于其中部分自动化；若同一邮件同时命中，当前自动化将不会执行。",
                                  "The current priority is lower than at least one existing automation. If the same email matches both, this automation will not run.",
                                )}
                              </div>
                            )}
                            {mailConflictCandidates.some(({ priority }) => priority === mailPriority) && (
                              <div className="mt-1 text-xs leading-5 text-amber-900/80">
                                {tt(
                                  "存在相同优先级。相同优先级时系统按固定顺序只执行一条，建议使用不同优先级避免业务歧义。",
                                  "An equal priority exists. With equal priorities, the system uses a fixed order and runs only one; use distinct priorities to avoid ambiguity.",
                                )}
                              </div>
                            )}
                          </div>
                        )}

                        <Field label={tt("规则测试", "Rule Test")} compact>
                          <div className="rounded-lg border bg-background p-3">
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <div>
                                <div className="text-sm font-medium">{tt("用模拟邮件验证当前规则", "Test the current rules with a sample email")}</div>
                                <div className="mt-1 text-xs leading-5 text-muted-foreground">
                                  {tt("不会读取真实邮箱，也不会创建运行记录，只按照服务端相同的文字匹配逻辑进行预判。", "This does not read a real mailbox or create a run. It previews using the same literal matching logic as the server.")}
                                </div>
                              </div>
                              <button
                                type="button"
                                onClick={() => setMailTesterOpen((value) => !value)}
                                className="rounded-lg border px-3 py-2 text-xs font-medium hover:bg-muted/40"
                              >
                                {mailTesterOpen ? tt("收起测试", "Hide test") : tt("测试规则", "Test rules")}
                              </button>
                            </div>

                            {mailTesterOpen && mailRuleTestResult && (
                              <div className="mt-3 space-y-3 border-t pt-3">
                                <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
                                  <input value={mailTestFrom} onChange={(e) => setMailTestFrom(e.target.value)} className="input-base" placeholder={tt("发件人，例如 customer@example.com", "Sender, e.g. customer@example.com")} />
                                  <input value={mailTestTo} onChange={(e) => setMailTestTo(e.target.value)} className="input-base" placeholder={tt("收件人，例如 sales@company.com", "Recipient, e.g. sales@company.com")} />
                                  <input value={mailTestSubject} onChange={(e) => setMailTestSubject(e.target.value)} className="input-base md:col-span-2" placeholder={tt("邮件主题", "Email subject")} />
                                  <textarea value={mailTestBody} onChange={(e) => setMailTestBody(e.target.value)} className="input-base min-h-[88px] resize-y md:col-span-2" placeholder={tt("邮件正文", "Email body")} />
                                  <textarea value={mailTestAttachments} onChange={(e) => setMailTestAttachments(e.target.value)} className="input-base min-h-[70px] resize-y md:col-span-2" placeholder={tt("附件名称，可每行填写一个，例如：报价单.xlsx", "Attachment names, one per line, e.g. quote.xlsx")} />
                                </div>

                                <div className={`rounded-lg border px-3 py-2.5 ${
                                  mailRuleTestResult.winner?.current
                                    ? "border-emerald-200 bg-emerald-50/70"
                                    : mailRuleTestResult.currentMatched
                                      ? "border-amber-200 bg-amber-50/70"
                                      : "bg-muted/25"
                                }`}>
                                  <div className="text-xs font-semibold">
                                    {mailRuleTestResult.winner?.current
                                      ? tt("结果：当前自动化会触发", "Result: current automation will run")
                                      : mailRuleTestResult.currentMatched && mailRuleTestResult.winner
                                        ? tt(`结果：当前规则命中，但会由「${mailRuleTestResult.winner.name}」优先执行`, `Result: current rules match, but “${mailRuleTestResult.winner.name}” wins by priority`)
                                        : tt("结果：当前自动化不会触发", "Result: current automation will not run")}
                                  </div>
                                  {mailRuleTestResult.winner && (
                                    <div className="mt-1 text-xs leading-5 text-muted-foreground">
                                      {tt("最终命中", "Winner")}: {mailRuleTestResult.winner.name} · {tt("优先级", "Priority")} {mailRuleTestResult.winner.priority}
                                    </div>
                                  )}
                                </div>

                                {mailRules.length > 0 && (
                                  <div className="space-y-1.5">
                                    <div className="text-xs font-medium">{tt("条件明细", "Condition details")}</div>
                                    {mailRuleTestResult.currentRuleResults.map(({ rule, matched, source }) => (
                                      <div key={rule.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border px-2.5 py-2 text-xs">
                                        <div className="min-w-0">
                                          <span className="font-medium">{mailRuleText(rule)}</span>
                                          <span className="ml-2 text-muted-foreground">
                                            {tt("实际值", "Actual")}: {source || tt("空", "empty")}
                                          </span>
                                        </div>
                                        <span className={matched ? "font-medium text-emerald-700" : "font-medium text-muted-foreground"}>
                                          {matched ? tt("命中", "Matched") : tt("未命中", "Not matched")}
                                        </span>
                                      </div>
                                    ))}
                                  </div>
                                )}

                                {mailRuleTestResult.matchedCandidates.length > 1 && (
                                  <div className="rounded-lg bg-muted/25 px-3 py-2.5">
                                    <div className="text-xs font-medium">{tt("同时命中的自动化", "Other matching automations")}</div>
                                    <div className="mt-1.5 flex flex-wrap gap-2">
                                      {mailRuleTestResult.matchedCandidates.map((item) => (
                                        <span key={`${item.current ? "current" : "saved"}-${item.id}`} className="rounded-full border bg-background px-2 py-1 text-xs">
                                          {item.name} · {item.priority}
                                        </span>
                                      ))}
                                    </div>
                                  </div>
                                )}
                              </div>
                            )}
                          </div>
                        </Field>

                        <div className="rounded-lg border border-dashed bg-muted/20 px-3 py-2.5">
                          <div className="text-xs font-medium text-foreground">{tt("自动传入邮件内容", "Automatically Pass Email Content")}</div>
                          <div className="mt-1 text-xs leading-5 text-muted-foreground">
                            {tt("监听邮箱、发件人、收件人、主题、正文、附件和命中规则都会写入本次运行上下文，便于追溯。", "Mailbox, sender, recipient, subject, body, attachments, and the matched rule are stored in the run context.")}
                          </div>
                        </div>
                      </>
                    )}

                    {trigger === "Webhook / API" && (
                      <>
                        <Field label={tt("Webhook 地址", "Webhook URL")} compact>
                          <input
                            readOnly
                            value="http://localhost:3000/api/automation/webhook"
                            className="input-base bg-muted/40"
                          />
                          <div className="mt-1.5 text-xs leading-5 text-muted-foreground">
                            {tt("创建后系统会使用该自动化的 ID 接收事件；演示时可从任务详情复制调用参数。", "After creation, the automation ID is used to receive events. For demos, copy the request parameters from the automation details.")}
                          </div>
                        </Field>
                        <Field label={tt("鉴权方式", "Authentication")} compact>
                          <select className="input-base" defaultValue="Bearer Token">
                            <option>Bearer Token</option>
                            <option>{tt("签名验证", "Signature Verification")}</option>
                          </select>
                        </Field>
                      </>
                    )}

                    {trigger === "自动化完成触发" && (
                      <>
                        <Field label={tt("上游自动化", "Upstream Automation")} compact>
                          <select
                            value={upstreamAutomationId ?? ""}
                            onChange={(e) => setUpstreamAutomationId(Number(e.target.value))}
                            className="input-base"
                          >
                            {automations
                              .filter((item) => item.id !== editingAutomationId)
                              .map((item) => (
                                <option key={item.id} value={item.id}>{item.name}</option>
                              ))}
                          </select>
                        </Field>
                        <Field label={tt("触发条件", "Trigger Condition")} compact>
                          <select
                            value={upstreamCondition}
                            onChange={(e) => setUpstreamCondition(e.target.value)}
                            className="input-base"
                          >
                            <option value="执行成功">{tt("执行成功", "Succeeded")}</option>
                            <option value="执行失败">{tt("执行失败", "Failed")}</option>
                            <option value="执行结束（无论成功失败）">{tt("执行结束（无论成功失败）", "Completed (success or failure)")}</option>
                          </select>
                        </Field>
                        <label className="mt-3 flex items-center gap-2 text-sm text-muted-foreground">
                          <input
                            type="checkbox"
                            checked={passPreviousResult}
                            onChange={(e) => setPassPreviousResult(e.target.checked)}
                          />
                          {tt("将上一自动化结果传入本次任务", "Pass the previous automation result into this task")}
                        </label>
                      </>
                    )}
                  </div>

                  <div className="mt-4 rounded-xl border bg-muted/30 p-4">
                    <div className="mb-2 text-xs text-muted-foreground">
                      {tt("当前触发方式可用变量（点击可插入任务说明）", "Available variables for this trigger (click to insert into the task description)")}
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {variables.map((variable) => (
                        <button
                          key={variable.value}
                          type="button"
                          onClick={() => insertVariable(variable.value)}
                          className="min-w-[132px] rounded-lg border bg-background px-3 py-2 text-left hover:bg-muted"
                        >
                          <div className="text-xs font-medium text-foreground">{variable.label}</div>
                          <div className="mt-0.5 font-mono text-[11px] text-muted-foreground">
                            {variable.value}
                          </div>
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              )}

              {step === 3 && (
                <div>
                  <h3 className="mb-4 text-base font-bold">{tt("执行策略", "Execution Strategy")}</h3>

                  <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                    {(
                      [
                        ["仅生成结果", tt("只生成结果，不执行外部操作", "Generate a result without external actions")],
                        ["需要确认后执行", tt("涉及外部操作时等待人工确认", "Wait for human confirmation before external actions")],
                        ["自动执行", tt("按照数字员工已有能力自动完成任务", "Execute automatically using the digital employee's existing capabilities")],
                      ] as [StrategyType, string][]
                    ).map(([value, desc]) => (
                      <button
                        key={value}
                        onClick={() => setStrategy(value)}
                        className={`rounded-xl border p-4 text-left transition ${
                          strategy === value
                            ? "border-primary bg-primary/5 ring-2 ring-primary/10"
                            : "bg-background hover:bg-muted/30"
                        }`}
                      >
                        <strong className="block text-sm">{strategyLabel(value)}</strong>
                        <span className="mt-1 block text-xs text-muted-foreground">{desc}</span>
                      </button>
                    ))}
                  </div>

                  <Field label={tt("异常处理", "Failure Handling")}>
                    <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                      <label className="flex items-center gap-2 text-sm text-muted-foreground">
                        <input
                          type="checkbox"
                          checked={notifyOnFailure}
                          onChange={(e) => setNotifyOnFailure(e.target.checked)}
                        />
                        {tt("执行失败时通知负责人", "Notify the owner when execution fails")}
                      </label>
                      {callbackEnabled && (
                        <label className="flex items-center gap-2 text-sm text-muted-foreground">
                          <input
                            type="checkbox"
                            checked={retryCallback}
                            onChange={(e) => setRetryCallback(e.target.checked)}
                          />
                          {tt("结果发送失败后自动重试", "Retry automatically if result delivery fails")}
                        </label>
                      )}
                    </div>
                  </Field>

                  <Field label={tt("配置预览", "Configuration Preview")}>
                    <div className="grid gap-3 rounded-xl border bg-muted/30 p-4 text-sm">
                      <SummaryRow label={tt("名称", "Name")} value={name.trim() || tt("未命名自动化", "Untitled automation")} />
                      <SummaryRow label={tt("数字员工", "Digital Employee")} value={selectedApp?.name || tt("未选择", "Not selected")} />
                      <SummaryRow label={tt("结果发送", "Result Delivery")} value={resultReturnText} />
                      <SummaryRow label={tt("触发方式", "Trigger")} value={triggerLabel(trigger)} />
                      <SummaryRow label={tt("执行策略", "Execution Strategy")} value={strategyLabel(strategy)} />
                    </div>
                  </Field>
                </div>
              )}
            </div>

            <div className="flex items-center justify-between border-t px-7 py-4">
              <button onClick={() => setDialogOpen(false)} className="btn-secondary">
                {tt("取消", "Cancel")}
              </button>
              <div className="flex items-center gap-2">
                {step > 1 && (
                  <button onClick={() => setStep((value) => value - 1)} className="btn-secondary">
                    {tt("上一步", "Back")}
                  </button>
                )}
                {step === 3 && (
                  <button onClick={testRun} className="btn-secondary">
                    {tt("测试运行", "Test Run")}
                  </button>
                )}
                <button
                  onClick={() => {
                    if (step < 3) setStep((value) => value + 1);
                    else if (editingAutomationId != null) saveAutomation();
                    else createAutomation();
                  }}
                  className="rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:opacity-90"
                >
                  {step === 3
                    ? editingAutomationId != null
                      ? tt("保存修改", "Save Changes")
                      : tt("创建并启用", "Create & Enable")
                    : tt("下一步", "Next")}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {drawerAutomation && (
        <div
          className="fixed inset-0 z-40 bg-slate-950/20"
          onClick={(event) => {
            if (event.currentTarget === event.target) setDrawerAutomationId(null);
          }}
        >
          <aside className="absolute right-0 top-0 flex h-full w-full max-w-xl flex-col bg-background shadow-2xl">
            <div className="flex items-start justify-between gap-4 border-b px-6 py-5">
              <div>
                <div className="text-xl font-bold">{drawerAutomation.name}</div>
                <div className="mt-1 text-xs text-muted-foreground">
                  {triggerLabel(drawerAutomation.trigger)} · {drawerAutomation.agent}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => openEditDialog(drawerAutomation)}
                  className="btn-secondary inline-flex items-center gap-1.5"
                >
                  <Pencil className="h-4 w-4" />
                  {tt("编辑", "Edit")}
                </button>
                <button
                  onClick={() => toggleAutomation(drawerAutomation.id)}
                  className="btn-secondary"
                >
                  {drawerAutomation.status === "paused" ? tt("启用", "Enable") : tt("暂停", "Pause")}
                </button>
                <button
                  onClick={() => deleteAutomation(drawerAutomation)}
                  className="inline-flex h-9 items-center gap-1.5 rounded-md border border-red-200 bg-background px-3 text-sm font-semibold text-red-600 transition hover:bg-red-50"
                >
                  <Trash2 className="h-4 w-4" />
                  {tt("删除", "Delete")}
                </button>
                <button
                  onClick={() => setDrawerAutomationId(null)}
                  className="grid h-9 w-9 place-items-center rounded-md bg-muted text-muted-foreground"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>

            <div className="overflow-y-auto px-6 py-5">
              <InfoSection title={tt("基本信息", "Basic Information")}>
                <div className="grid grid-cols-2 gap-3">
                  <InfoItem label={tt("状态", "Status")} value={statusLabel(drawerAutomation.statusText, drawerAutomation.status)} />
                  <InfoItem label={tt("执行策略", "Execution Strategy")} value={strategyLabel(drawerAutomation.strategy)} />
                  <InfoItem label={tt("触发方式", "Trigger")} value={triggerLabel(drawerAutomation.trigger)} />
                  <InfoItem label={tt("数字员工", "Digital Employee")} value={drawerAutomation.agent} />
                </div>
              </InfoSection>

              <InfoSection title={tt("触发配置", "Trigger Configuration")}>
                <InfoBox>
                  {drawerAutomation.trigger === "Webhook / API"
                    ? `${localizedTriggerDetail(drawerAutomation)}\nPOST http://localhost:3000/api/automation/webhook?automation_id=${drawerAutomation.id}`
                    : localizedTriggerDetail(drawerAutomation)}
                </InfoBox>
              </InfoSection>

              {drawerAutomation.trigger === "邮件触发" && (
                <InfoSection title={tt("邮件触发统计", "Email Trigger Statistics")}>
                  <div className="mb-2 flex items-center justify-between gap-3">
                    <div className="text-xs text-muted-foreground">
                      {tt(
                        "路由统计记录服务端实际检查结果，包括未命中和被更高优先级规则截获的邮件。",
                        "Routing statistics include server-side checks, unmatched messages, and messages suppressed by higher-priority rules.",
                      )}
                    </div>
                    {emailRoutingStatsLoading && (
                      <div className="shrink-0 text-xs text-muted-foreground">{tt("读取中...", "Loading...")}</div>
                    )}
                  </div>

                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                    <div className="rounded-lg border bg-muted/20 px-3 py-3">
                      <div className="text-xs text-muted-foreground">{tt("已检查邮件", "Checked")}</div>
                      <div className="mt-1 text-xl font-bold">{emailRoutingStats.scanned}</div>
                    </div>
                    <div className="rounded-lg border bg-muted/20 px-3 py-3">
                      <div className="text-xs text-muted-foreground">{tt("规则命中", "Rule Matched")}</div>
                      <div className="mt-1 text-xl font-bold">{emailRoutingStats.matched}</div>
                    </div>
                    <div className="rounded-lg border bg-muted/20 px-3 py-3">
                      <div className="text-xs text-muted-foreground">{tt("实际触发", "Triggered")}</div>
                      <div className="mt-1 text-xl font-bold">{emailRoutingStats.triggered}</div>
                    </div>
                    <div className="rounded-lg border bg-muted/20 px-3 py-3">
                      <div className="text-xs text-muted-foreground">{tt("未命中", "Not Matched")}</div>
                      <div className="mt-1 text-xl font-bold">{emailRoutingStats.notMatched}</div>
                    </div>
                    <div className="rounded-lg border bg-muted/20 px-3 py-3">
                      <div className="text-xs text-muted-foreground">{tt("被高优先级截获", "Suppressed")}</div>
                      <div className="mt-1 text-xl font-bold">{emailRoutingStats.suppressed}</div>
                    </div>
                    <div className="rounded-lg border bg-muted/20 px-3 py-3">
                      <div className="text-xs text-muted-foreground">{tt("重复拦截", "Deduplicated")}</div>
                      <div className="mt-1 text-xl font-bold">{emailRoutingStats.duplicate}</div>
                    </div>
                  </div>

                  <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
                    <div className="rounded-lg border bg-background px-3 py-3">
                      <div className="text-xs text-muted-foreground">{tt("命中并创建运行", "Runs Created")}</div>
                      <div className="mt-1 text-lg font-bold">{drawerEmailStats.total}</div>
                    </div>
                    <div className="rounded-lg border bg-background px-3 py-3">
                      <div className="text-xs text-muted-foreground">{tt("成功", "Success")}</div>
                      <div className="mt-1 text-lg font-bold">{drawerEmailStats.success}</div>
                    </div>
                    <div className="rounded-lg border bg-background px-3 py-3">
                      <div className="text-xs text-muted-foreground">{tt("失败 / 超时", "Failed / Timed Out")}</div>
                      <div className="mt-1 text-lg font-bold">{drawerEmailStats.failed}</div>
                    </div>
                    <div className="rounded-lg border bg-background px-3 py-3">
                      <div className="text-xs text-muted-foreground">{tt("处理中 / 待审核", "Processing / Pending")}</div>
                      <div className="mt-1 text-lg font-bold">{drawerEmailStats.pending}</div>
                    </div>
                  </div>

                  <div className="mt-3 rounded-lg border bg-background px-3 py-3">
                    <div className="text-xs font-medium text-foreground">{tt("最近路由结果", "Recent Routing Results")}</div>
                    {emailRoutingStats.recent.length === 0 ? (
                      <div className="mt-2 text-xs text-muted-foreground">
                        {tt("暂无服务端邮件路由统计", "No server-side email routing statistics yet")}
                      </div>
                    ) : (
                      <div className="mt-2 divide-y">
                        {emailRoutingStats.recent.slice(0, 5).map((event) => {
                          const outcomeText =
                            event.outcome === "triggered"
                              ? tt("已触发", "Triggered")
                              : event.outcome === "suppressed_by_priority"
                                ? tt("被高优先级截获", "Suppressed")
                                : event.outcome === "duplicate"
                                  ? tt("重复拦截", "Deduplicated")
                                  : tt("未命中", "Not Matched");
                          return (
                            <div key={event.id} className="flex items-start justify-between gap-3 py-2">
                              <div className="min-w-0">
                                <div className="truncate text-sm font-medium">
                                  {event.subject || tt("无主题", "No Subject")}
                                </div>
                                <div className="mt-0.5 truncate text-xs text-muted-foreground">
                                  {event.from || tt("未知发件人", "Unknown Sender")}
                                </div>
                              </div>
                              <div className="shrink-0 text-right">
                                <div className="text-xs font-medium">{outcomeText}</div>
                                {event.priority != null && (
                                  <div className="mt-0.5 text-[11px] text-muted-foreground">
                                    {tt("优先级", "Priority")} {event.priority}
                                  </div>
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>

                  <div className="mt-3 rounded-lg border bg-background px-3 py-3">
                    <div className="text-xs font-medium text-foreground">{tt("最近实际触发的邮件", "Recently Triggered Emails")}</div>
                    {drawerEmailRuns.length === 0 ? (
                      <div className="mt-2 text-xs text-muted-foreground">
                        {tt("暂无由服务端邮件监听触发的运行记录", "No runs have been triggered by server-side email monitoring yet")}
                      </div>
                    ) : (
                      <div className="mt-2 divide-y">
                        {drawerEmailRuns.slice(0, 3).map((run) => (
                          <button
                            key={run.id}
                            type="button"
                            onClick={() => {
                              setDrawerAutomationId(null);
                              setDrawerRunId(run.id);
                            }}
                            className="flex w-full items-start justify-between gap-3 py-2 text-left hover:bg-muted/40"
                          >
                            <div className="min-w-0">
                              <div className="truncate text-sm font-medium">
                                {String(run.triggerContext?.subject || tt("无主题", "No Subject"))}
                              </div>
                              <div className="mt-0.5 truncate text-xs text-muted-foreground">
                                {String(run.triggerContext?.from || tt("未知发件人", "Unknown Sender"))}
                              </div>
                            </div>
                            <div className="shrink-0 text-right">
                              <div className="text-xs font-medium">{statusLabel(run.statusText, run.status)}</div>
                              <div className="mt-0.5 text-[11px] text-muted-foreground">{displayTime(run.time)}</div>
                            </div>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </InfoSection>
              )}

              <InfoSection title={tt("任务说明", "Task Description")}>
                <InfoBox>{drawerAutomation.task}</InfoBox>
              </InfoSection>

              <InfoSection title={tt("结果发送", "Result Delivery")}>
                <InfoBox>{localizedReturnDetail(drawerAutomation)}</InfoBox>
              </InfoSection>

              <InfoSection title={tt("最近运行", "Recent Run")}>
                {drawerAutomationRuns.length === 0 ? (
                  <div className="text-sm text-muted-foreground">
                    {tt("暂无运行记录", "No run history yet")}
                  </div>
                ) : (
                  <div className="ml-2 border-l pl-5">
                    {drawerAutomationRuns.slice(0, 3).map((run) => (
                      <TimelineItem
                        key={run.id}
                        text={
                          run.triggerContext?.source === "email-server"
                            ? `${tt("邮件触发", "Email Trigger")} · ${String(run.triggerContext?.subject || tt("无主题", "No Subject"))} · ${statusLabel(run.statusText, run.status)}`
                            : `${triggerLabel(run.trigger)} · ${statusLabel(run.statusText, run.status)}`
                        }
                        time={displayTime(run.time)}
                      />
                    ))}
                  </div>
                )}
              </InfoSection>
            </div>
          </aside>
        </div>
      )}

      {drawerRun && (
        <div
          className="fixed inset-0 z-40 bg-slate-950/20"
          onClick={(event) => {
            if (event.currentTarget === event.target) setDrawerRunId(null);
          }}
        >
          <aside className="absolute right-0 top-0 flex h-full w-full max-w-2xl flex-col bg-background shadow-2xl">
            <div className="flex items-start justify-between gap-4 border-b px-6 py-5">
              <div>
                <div className="text-xl font-bold">{tt("运行详情", "Run Details")}</div>
                <div className="mt-1 text-xs text-muted-foreground">
                  {drawerRun.name} · {triggerLabel(drawerRun.trigger)}
                </div>
              </div>
              <button
                onClick={() => setDrawerRunId(null)}
                className="grid h-9 w-9 place-items-center rounded-md bg-muted text-muted-foreground"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="overflow-y-auto px-6 py-5">
              <InfoSection title={tt("基本信息", "Basic Information")}>
                <div className="grid grid-cols-2 gap-3">
                  <InfoItem label={tt("自动化名称", "Automation Name")} value={drawerRun.name} />
                  <InfoItem label={tt("数字员工", "Digital Employee")} value={drawerRun.agent} />
                  <InfoItem label={tt("触发方式", "Trigger")} value={triggerLabel(drawerRun.trigger)} />
                  <InfoItem label={tt("开始时间", "Start Time")} value={drawerRun.time} />
                  <InfoItem label={tt("状态", "Status")} value={statusLabel(drawerRun.statusText, drawerRun.status)} />
                  <InfoItem label={tt("执行耗时", "Duration")} value={drawerRun.duration} />
                  {drawerRun.strategy && (
                    <InfoItem
                      label={tt("执行策略", "Execution Strategy")}
                      value={strategyLabel(drawerRun.strategy)}
                    />
                  )}
                  {drawerRun.aiVersion != null && drawerRun.aiVersion > 0 && (
                    <InfoItem
                      label={tt("当前 AI 版本", "Current AI Version")}
                      value={`V${drawerRun.aiVersion}`}
                    />
                  )}
                </div>
              </InfoSection>

              {drawerRun.trigger === "邮件触发" && drawerRun.triggerContext && (
                <InfoSection title={tt("邮件来源", "Email Source")}>
                  <div className="grid grid-cols-2 gap-3">
                    <InfoItem
                      label={tt("监听邮箱", "Monitored Mailbox")}
                      value={emailContextText(drawerRun.triggerContext.mailbox, tt("系统邮箱", "System Mailbox"))}
                    />
                    <InfoItem
                      label={tt("监听范围", "Monitoring Scope")}
                      value={mailFolderDisplay(drawerRun.triggerContext.folder)}
                    />
                    <InfoItem
                      label={tt("监听方式", "Monitoring Method")}
                      value={emailSourceDisplay(drawerRun.triggerContext.source)}
                    />
                    <InfoItem
                      label={tt("规则优先级", "Rule Priority")}
                      value={String(drawerRun.triggerContext.priority ?? 50)}
                    />
                    <InfoItem
                      label={tt("发件人", "Sender")}
                      value={emailContextText(drawerRun.triggerContext.from, tt("未知", "Unknown"))}
                    />
                    <InfoItem
                      label={tt("收件人", "Recipient")}
                      value={emailContextText(drawerRun.triggerContext.to, tt("未知", "Unknown"))}
                    />
                    <InfoItem
                      label={tt("邮件主题", "Subject")}
                      value={emailContextText(drawerRun.triggerContext.subject, tt("无主题", "No subject"))}
                    />
                    <InfoItem
                      label={tt("邮件时间", "Email Time")}
                      value={emailContextText(drawerRun.triggerContext.date)}
                    />
                  </div>

                  <div className="mt-3">
                    <div className="mb-1 text-xs font-semibold text-muted-foreground">
                      {tt("命中规则", "Matched Rule")}
                    </div>
                    <InfoBox>
                      <div className="whitespace-pre-wrap text-foreground">
                        {emailContextText(
                          drawerRun.triggerContext.matchedRule,
                          tt("收到新邮件即触发", "Trigger on new email"),
                        )}
                      </div>
                    </InfoBox>
                  </div>

                  <div className="mt-3">
                    <div className="mb-1 text-xs font-semibold text-muted-foreground">
                      {tt("邮件正文", "Email Body")}
                    </div>
                    <InfoBox>
                      <div className="max-h-72 overflow-auto whitespace-pre-wrap break-words text-foreground">
                        {emailContextText(drawerRun.triggerContext.body, tt("无正文", "No body"))}
                      </div>
                    </InfoBox>
                  </div>

                  <div className="mt-3">
                    <div className="mb-1 text-xs font-semibold text-muted-foreground">
                      {tt("附件", "Attachments")}
                    </div>
                    <InfoBox>
                      <div className="whitespace-pre-wrap break-words text-foreground">
                        {Array.isArray(drawerRun.triggerContext.attachments) && drawerRun.triggerContext.attachments.length > 0
                          ? drawerRun.triggerContext.attachments.join("\n")
                          : tt("无附件", "No attachments")}
                      </div>
                    </InfoBox>
                  </div>

                  <details className="mt-3 rounded-lg border bg-muted/20 px-3 py-2">
                    <summary className="cursor-pointer text-xs font-semibold text-muted-foreground">
                      {tt("技术信息", "Technical Details")}
                    </summary>
                    <div className="mt-3 grid grid-cols-1 gap-2 text-xs sm:grid-cols-2">
                      <InfoItem
                        label={tt("邮件唯一标识（Message-ID）", "Message-ID")}
                        value={emailContextText(drawerRun.triggerContext.messageId)}
                      />
                      <InfoItem
                        label={tt("邮箱序号（UID）", "Mailbox UID")}
                        value={emailContextText(drawerRun.triggerContext.uid)}
                      />
                    </div>
                  </details>
                </InfoSection>
              )}

              {(drawerRun.taskSnapshot ||
                (drawerRun.trigger !== "邮件触发" &&
                  drawerRun.triggerContext &&
                  Object.keys(drawerRun.triggerContext).length > 0)) && (
                <InfoSection title={tt("触发 / 输入明细", "Trigger / Input Details")}>
                  {drawerRun.taskSnapshot && (
                    <div className={drawerRun.trigger === "邮件触发" ? "" : "mb-3"}>
                      <div className="mb-1 text-xs font-semibold text-muted-foreground">
                        {tt("任务快照", "Task Snapshot")}
                      </div>
                      <InfoBox>
                        <div className="whitespace-pre-wrap text-foreground">
                          {drawerRun.taskSnapshot}
                        </div>
                      </InfoBox>
                    </div>
                  )}

                  {drawerRun.trigger !== "邮件触发" &&
                    drawerRun.triggerContext &&
                    Object.keys(drawerRun.triggerContext).length > 0 && (
                      <div>
                        <div className="mb-1 text-xs font-semibold text-muted-foreground">
                          {tt("本次触发上下文", "Trigger Context")}
                        </div>
                        <InfoBox>
                          <pre className="max-h-56 overflow-auto whitespace-pre-wrap break-words font-sans text-xs text-foreground">
                            {JSON.stringify(drawerRun.triggerContext, null, 2)}
                          </pre>
                        </InfoBox>
                      </div>
                    )}
                </InfoSection>
              )}

              <InfoSection title={tt("执行过程", "Execution Process")}>
                <div className="ml-2 border-l pl-5">
                  <TimelineItem text={tt("运行任务已创建", "Run task created")} time={drawerRun.time} />
                  <TimelineItem
                    text={isEnglish ? `Digital employee “${drawerRun.agent}” started processing` : `数字员工「${drawerRun.agent}」开始处理任务`}
                    time={drawerRun.time}
                  />
                  <TimelineItem
                    text={
                      drawerRun.status === "success"
                        ? drawerRun.reviewStatus === "approved"
                          ? tt("AI 内容审核通过，已锁定最终结果", "AI content approved and final result locked")
                          : tt("任务执行成功", "Task completed successfully")
                        : drawerRun.status === "failed"
                          ? tt("任务执行失败", "Task execution failed")
                          : drawerRun.status === "pending"
                            ? tt("AI 已生成结果，等待人工审核", "AI result generated and awaiting review")
                            : drawerRun.status === "regenerating"
                              ? tt("正在根据修改建议重新生成", "Regenerating from reviewer instructions")
                              : drawerRun.status === "action_running"
                                ? tt("正在执行后续操作", "Running follow-up actions")
                                : drawerRun.status === "rejected"
                                  ? tt("本次结果已被驳回", "This result was rejected")
                                  : drawerRun.status === "timed_out"
                                    ? tt("本次运行已超时", "This run timed out")
                                    : tt("任务正在执行中", "Task is running")
                    }
                    time={
                      drawerRun.status === "running" || drawerRun.status === "regenerating"
                        ? tt("进行中", "In progress")
                        : drawerRun.reviewedAt || drawerRun.time
                    }
                  />
                </div>
              </InfoSection>

              {drawerRun.status === "pending" || drawerRun.status === "regenerating" ? (
                <InfoSection title={tt("AI 处理结果", "AI Result")}>
                  <div className="rounded-xl border bg-muted/20 p-4">
                    <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                      <div className="text-xs text-muted-foreground">
                        {drawerRun.aiVersion
                          ? tt(`当前版本 V${drawerRun.aiVersion}`, `Current version V${drawerRun.aiVersion}`)
                          : tt("当前版本", "Current version")}
                        {drawerRun.updatedAt
                          ? ` · ${new Date(drawerRun.updatedAt).toLocaleString(isEnglish ? "en-US" : "zh-CN")}`
                          : ""}
                      </div>
                      <StatusBadge
                        status={drawerRun.status}
                        text={statusLabel(drawerRun.statusText, drawerRun.status)}
                      />
                    </div>

                    {reviewLoading ? (
                      <div className="py-12 text-center text-sm text-muted-foreground">
                        {tt("正在加载审核内容…", "Loading review content…")}
                      </div>
                    ) : (
                      <textarea
                        value={reviewDraft}
                        onChange={(event) => setReviewDraft(event.target.value)}
                        onBlur={() => void saveCurrentReviewDraft(drawerRun)}
                        disabled={drawerRun.status === "regenerating" || reviewActionBusy}
                        className="min-h-[260px] w-full resize-y rounded-lg border bg-background p-4 text-sm leading-6 outline-none focus:ring-2 focus:ring-primary/20 disabled:cursor-not-allowed disabled:opacity-70"
                      />
                    )}

                    {drawerRun.error && (
                      <div className="mt-3 rounded-lg border border-red-200 bg-red-50 p-3 text-xs leading-5 text-red-700">
                        {drawerRun.error}
                      </div>
                    )}

                    <div className="mt-4 rounded-lg border bg-background p-3">
                      <div className="text-xs font-semibold">
                        {tt("审核通过后将执行", "Actions after approval")}
                      </div>
                      <div className="mt-1 text-xs leading-5 text-muted-foreground">
                        {reviewActionSummary(drawerRun)}
                      </div>
                    </div>

                    <div className="mt-4 flex flex-wrap items-center justify-end gap-3">
                      <button
                        type="button"
                        onClick={() => {
                          setRejectionReason("");
                          setRejectDialogOpen(true);
                        }}
                        disabled={drawerRun.status !== "pending" || reviewActionBusy}
                        className="rounded-md border px-4 py-2 text-sm font-semibold text-red-600 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {tt("驳回", "Reject")}
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setRegenerationAdvice("");
                          setRegenerateDialogOpen(true);
                        }}
                        disabled={drawerRun.status !== "pending" || reviewActionBusy}
                        className="btn-secondary disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {tt("重新生成", "Regenerate")}
                      </button>
                      <button
                        type="button"
                        onClick={() => void approveRunReview(drawerRun)}
                        disabled={
                          drawerRun.status !== "pending" ||
                          reviewActionBusy ||
                          !reviewDraft.trim()
                        }
                        className="rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {reviewActionBusy
                          ? tt("处理中…", "Processing…")
                          : tt("审核通过", "Approve")}
                      </button>
                    </div>
                  </div>
                </InfoSection>
              ) : (
                <InfoSection title={tt("执行结果", "Result")}>
                  <InfoBox>
                    <div className="whitespace-pre-wrap text-foreground">
                      {drawerRun.status === "running"
                        ? tt("数字员工正在执行任务，请稍候。", "The digital employee is processing the task. Please wait.")
                        : drawerRun.status === "failed"
                          ? drawerRun.error || tt("任务执行失败，未返回详细错误信息。", "Task execution failed with no detailed error returned.")
                          : drawerRun.status === "timed_out"
                            ? drawerRun.error || tt("任务执行超时。", "Task execution timed out.")
                            : drawerRun.status === "rejected"
                              ? drawerRun.reviewContent || drawerRun.result || tt("本次结果已被驳回。", "This result was rejected.")
                              : drawerRun.status === "success"
                                ? drawerRun.finalResult || drawerRun.result || tt("任务执行成功。", "Task completed successfully.")
                                : drawerRun.result || tt("当前暂无执行结果。", "No execution result yet.")}
                    </div>
                  </InfoBox>

                  {drawerRun.status === "timed_out" && drawerRun.result && (
                    <div className="mt-3 rounded-lg border bg-muted/30 p-3">
                      <div className="mb-1 text-xs font-semibold text-foreground">
                        {tt("超时前已生成的部分结果", "Partial result generated before timeout")}
                      </div>
                      <div className="whitespace-pre-wrap text-xs leading-5 text-muted-foreground">
                        {drawerRun.result}
                      </div>
                    </div>
                  )}

                  {drawerRun.status === "rejected" && (
                    <div className="mt-3 rounded-lg border bg-muted/30 p-3 text-xs leading-5 text-muted-foreground">
                      <span className="font-semibold text-foreground">
                        {tt("驳回原因：", "Rejection reason: ")}
                      </span>
                      {drawerRun.rejectionReason || tt("未填写", "Not provided")}
                    </div>
                  )}
                </InfoSection>
              )}

              {Array.isArray(drawerRun.resultAttachments) && drawerRun.resultAttachments.length > 0 && (
                <InfoSection title={tt("数字员工生成的附件", "Generated Attachments")}>
                  <div className="space-y-2">
                    {drawerRun.resultAttachments.map((attachment, index) => (
                      <div key={`${attachment.object_key || attachment.filename}-${index}`} className="rounded-lg border bg-muted/20 px-3 py-2">
                        <div className="text-sm font-medium text-foreground">{attachment.filename}</div>
                        <div className="mt-0.5 text-xs text-muted-foreground">
                          {[attachment.content_type, attachment.size ? `${Math.max(1, Math.round(attachment.size / 1024))} KB` : ""]
                            .filter(Boolean)
                            .join(" · ") || tt("平台生成文件", "Platform-generated file")}
                        </div>
                      </div>
                    ))}
                  </div>
                </InfoSection>
              )}

              {runActions.length > 0 && (
                <InfoSection title={tt("后续操作", "Follow-up Actions")}>
                  <div className="space-y-2">
                    {runActions.map((action) => (
                      <div key={action.id} className="rounded-lg border bg-muted/20 p-3">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div className="text-sm font-semibold">{runActionLabel(action)}</div>
                          <div className="text-xs text-muted-foreground">
                            {runActionStatusLabel(action.status)}
                          </div>
                        </div>
                        {action.error && (
                          <div className="mt-1 whitespace-pre-wrap text-xs leading-5 text-red-600">
                            {action.error}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>

                  {drawerRun.status === "failed" &&
                    drawerRun.reviewStatus === "approved" &&
                    runActions.some((action) => action.status === "failed") && (
                      <div className="mt-3 flex justify-end">
                        <button
                          type="button"
                          onClick={() => void retryFailedRunActions(drawerRun)}
                          disabled={reviewActionBusy}
                          className="btn-secondary disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          {reviewActionBusy
                            ? tt("重试中…", "Retrying…")
                            : tt("重试失败操作", "Retry Failed Actions")}
                        </button>
                      </div>
                    )}
                </InfoSection>
              )}

              {reviewHistory.length > 0 && (
                <InfoSection title={tt("审核记录", "Review History")}>
                  <div className="space-y-2">
                    {reviewHistory.map((item) => (
                      <div key={item.id} className="rounded-lg border bg-muted/20 p-3">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div className="text-sm font-semibold">
                            {reviewEventLabel(item.eventType)}
                            {item.aiVersion ? ` · V${item.aiVersion}` : ""}
                          </div>
                          <div className="text-xs text-muted-foreground">
                            {new Date(item.createdAt).toLocaleString(isEnglish ? "en-US" : "zh-CN")}
                          </div>
                        </div>
                        {item.note && (
                          <div className="mt-1 whitespace-pre-wrap text-xs leading-5 text-muted-foreground">
                            {item.note}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </InfoSection>
              )}
            </div>
          </aside>
        </div>
      )}

      {regenerateDialogOpen && drawerRun && (
        <div
          className="fixed inset-0 z-50 grid place-items-center bg-slate-950/30 px-4"
          onClick={(event) => {
            if (event.currentTarget === event.target && !reviewActionBusy) {
              setRegenerateDialogOpen(false);
            }
          }}
        >
          <div className="w-full max-w-lg rounded-xl border bg-background p-6 shadow-2xl">
            <div className="text-lg font-bold">{tt("重新生成", "Regenerate")}</div>
            <div className="mt-2 text-sm leading-6 text-muted-foreground">
              {tt(
                "填写你希望 AI 如何修改当前内容。重新生成后会产生新版本，并再次进入待审核状态。",
                "Describe how the AI should revise the current content. A new version will be generated and returned to pending review.",
              )}
            </div>
            <textarea
              value={regenerationAdvice}
              onChange={(event) => setRegenerationAdvice(event.target.value)}
              placeholder={tt(
                "例如：语气更正式，保留关键数据，把结论放在最前面。",
                "For example: Use a more formal tone, keep the key data, and put the conclusion first.",
              )}
              className="mt-4 min-h-[140px] w-full resize-y rounded-lg border bg-background p-3 text-sm outline-none focus:ring-2 focus:ring-primary/20"
              autoFocus
            />
            <div className="mt-5 flex justify-end gap-3">
              <button
                type="button"
                onClick={() => setRegenerateDialogOpen(false)}
                disabled={reviewActionBusy}
                className="btn-secondary disabled:opacity-50"
              >
                {tt("取消", "Cancel")}
              </button>
              <button
                type="button"
                onClick={() => void regenerateRunReview(drawerRun)}
                disabled={reviewActionBusy || !regenerationAdvice.trim()}
                className="rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {reviewActionBusy
                  ? tt("正在重新生成…", "Regenerating…")
                  : tt("开始重新生成", "Regenerate")}
              </button>
            </div>
          </div>
        </div>
      )}

      {rejectDialogOpen && drawerRun && (
        <div
          className="fixed inset-0 z-50 grid place-items-center bg-slate-950/30 px-4"
          onClick={(event) => {
            if (event.currentTarget === event.target && !reviewActionBusy) {
              setRejectDialogOpen(false);
            }
          }}
        >
          <div className="w-full max-w-lg rounded-xl border bg-background p-6 shadow-2xl">
            <div className="text-lg font-bold">{tt("驳回本次结果", "Reject This Result")}</div>
            <div className="mt-2 text-sm leading-6 text-muted-foreground">
              {tt(
                "驳回后本次运行直接结束，不会继续执行后续业务操作。驳回原因可选填。",
                "Rejecting ends this run and no follow-up business actions will be executed. A reason is optional.",
              )}
            </div>
            <textarea
              value={rejectionReason}
              onChange={(event) => setRejectionReason(event.target.value)}
              placeholder={tt("可选：填写驳回原因", "Optional: enter a rejection reason")}
              className="mt-4 min-h-[110px] w-full resize-y rounded-lg border bg-background p-3 text-sm outline-none focus:ring-2 focus:ring-primary/20"
              autoFocus
            />
            <div className="mt-5 flex justify-end gap-3">
              <button
                type="button"
                onClick={() => setRejectDialogOpen(false)}
                disabled={reviewActionBusy}
                className="btn-secondary disabled:opacity-50"
              >
                {tt("取消", "Cancel")}
              </button>
              <button
                type="button"
                onClick={() => void rejectRunReview(drawerRun)}
                disabled={reviewActionBusy}
                className="rounded-md bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {reviewActionBusy ? tt("处理中…", "Processing…") : tt("确认驳回", "Reject")}
              </button>
            </div>
          </div>
        </div>
      )}

      <style jsx global>{`
        .input-base {
          width: 100%;
          border: 1px solid hsl(var(--border));
          border-radius: 0.5rem;
          background: hsl(var(--background));
          padding: 0.65rem 0.75rem;
          font-size: 0.875rem;
          outline: none;
        }
        .input-base:focus {
          box-shadow: 0 0 0 3px hsl(var(--primary) / 0.12);
          border-color: hsl(var(--primary));
        }
        .btn-secondary {
          border: 1px solid hsl(var(--border));
          border-radius: 0.5rem;
          background: hsl(var(--background));
          padding: 0.55rem 0.9rem;
          font-size: 0.875rem;
          font-weight: 600;
        }
        .btn-secondary:hover {
          background: hsl(var(--muted));
        }
      `}</style>
    </div>
  );
}

function Field({
  label,
  children,
  compact = false,
}: {
  label: string;
  children: React.ReactNode;
  compact?: boolean;
}) {
  return (
    <div className={compact ? "mt-3" : "mt-5"}>
      <label className="mb-2 block text-sm font-semibold">{label}</label>
      {children}
    </div>
  );
}

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid grid-cols-[110px_1fr] gap-3">
      <div className="text-muted-foreground">{label}</div>
      <div className="font-semibold">{value}</div>
    </div>
  );
}

function InfoSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mb-6">
      <div className="mb-3 text-sm font-bold">{title}</div>
      {children}
    </section>
  );
}

function InfoItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border bg-muted/30 p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-1 text-sm font-semibold">{value}</div>
    </div>
  );
}

function InfoBox({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-lg border bg-muted/30 p-4 text-sm leading-6 text-muted-foreground">
      {children}
    </div>
  );
}

function TimelineItem({ time, text }: { time: string; text: string }) {
  return (
    <div className="relative mb-5 last:mb-0">
      <span className="absolute -left-[25px] top-1.5 h-2.5 w-2.5 rounded-full bg-emerald-500 ring-2 ring-background" />
      <div className="text-xs text-muted-foreground">{time}</div>
      <div className="mt-1 text-sm">{text}</div>
    </div>
  );
}
