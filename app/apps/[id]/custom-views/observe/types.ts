/**
 * 流程观测看板用到的响应类型，对齐 zd-service 的 @zd/contracts（PRD §5.4）。
 * ragent 不引跨项目包，这里抄一份用到的子集。zd 端契约变动时手动同步。
 */

export type OrderState = "queued" | "downloading" | "archived" | "reviewing" | "done" | "failed";
export type FailedPhase = "download" | "prepare" | "review";
export type ObserveNodeStatus = "done" | "active" | "pending" | "failed";
export type LogLevel = "debug" | "info" | "warn" | "error";
export type LogSource = "file-agent" | "baidu-agent" | "preview-agent" | "system";

/** failedPhase 原始枚举 → 六态 key（流程追踪 / 列表 / 失败横幅共用一份）。 */
export const FAILED_PHASE_TO_STATE: Record<FailedPhase, OrderState> = {
  download: "downloading",
  prepare: "archived",
  review: "reviewing",
};

/** zd-service 统一响应外壳。 */
export interface Envelope<T> {
  code: number;
  message: string;
  data: T;
}

export interface ObserveSummaryData {
  total: number;
  inProgress: number;
  reviewing: number;
  done: number;
  failed: number;
  avgProgress: number;
}

export interface ObserveOrderListItem {
  orderId: string;
  serialNumber: string;
  customerName: string;
  productName: string;
  productCode: string;
  state: OrderState;
  stateLabel: string;
  failedPhase: FailedPhase | null;
  overallProgress: number;
  producer: string;
  createdAt: string;
  updatedAt: string;
  endTime: string;
  /** 预审原始报告的问题类目数(issueCount 标量);无报告为 null。done 且 >0 → 行染黄。 */
  reviewIssueCount: number | null;
}

export interface ObserveOrderListData {
  items: ObserveOrderListItem[];
  page: number;
  pageSize: number;
  total: number;
}

export interface ObserveNode {
  phase: OrderState;
  label: string;
  status: ObserveNodeStatus;
  enteredAt: string | null;
  leftAt: string | null;
  detail?: Record<string, unknown> | null;
}

/** 下载富进度（zd-service buildNodes 给 downloading 节点 detail.progress，与 agent get_order_progress 同源）。 */
export interface FileProgress {
  name: string;
  bytesDone: number;
  bytesTotal: number | null;
}
export interface SourceProgress {
  total: number | null;
  done: number;
  failed: number;
  doneFiles: string[];
  failedFiles: string[];
  currentFile: FileProgress | null;
}
export interface OrderProgress {
  baidu: SourceProgress;
  attachment: SourceProgress;
  phase: "baidu" | "attachment" | "finalizing";
  updatedAt: string;
}
export interface FailedFile {
  name: string;
  reason: string;
  source?: string;
}

export interface ObserveTimelineItem {
  id: number;
  eventType: string;
  actor: string;
  fromState: OrderState | null;
  toState: OrderState | null;
  payload: Record<string, unknown> | null;
  createdAt: string;
}

export interface ObserveParams {
  oaSubmit: Record<string, unknown>;
  previewAgent: {
    appId: number | null;
    salespersonWechatId: string | null;
    content: string | null;
    detailId: string | null;
    finishReason: string | null;
  };
  baidu: { shareUrl: string; instruction: string; sharePwd: string } | null;
  attachments: Array<{ name: string | null; url: string }>;
  wecom: { weChatIds: string[]; productCode: string; chatId: string | null };
}

export interface ObserveOrderDetailOrder {
  orderId: string;
  serialNumber: string;
  state: OrderState;
  stateLabel: string;
  failedPhase: FailedPhase | null;
  failureReason: string | null;
  createdAt: string;
  updatedAt: string;
  dispatchedAt: string | null;
  lastHeartbeatAt: string | null;
  downloadProgress: Record<string, unknown> | null;
  progressSummary: Record<string, unknown> | null;
  filesDone: unknown[] | null;
  filesFailed: unknown[] | null;
  archivePath: string | null;
  overallProgress: number;
  producer: string;
  customerName: string;
  productName: string;
  productCode: string;
}

export interface ObserveOrderDetailData {
  order: ObserveOrderDetailOrder;
  params: ObserveParams;
  nodes: ObserveNode[];
  timeline: ObserveTimelineItem[];
  /** 预审原始报告（review-callback result=success 落库），zd-service 原样透传;未完成预审为 null。 */
  reviewReport: RawPreviewReport | null;
}

// ───── 预审原始报告 (raw preview report) ──────────────────────────
// Illustrator 预审 MCP 产出的原始结果 JSON，zd-service 只存不算、原样透传。
// 字段口径与展示派生规则见 zd-service docs/api/raw-preview-report-client-guide.md；
// 这里只锁定对方文档标注「稳定」的骨架，明细对象不展开（结构随预审端演进）。

/** linkedImages / rasterImages 共用骨架（来源不同，不要合并后反推来源）。 */
export interface RawPreviewImageGroup {
  total: number;
  missing: string[];
  missingDetails: Array<Record<string, unknown>>;
  lowRes: Array<Record<string, unknown>>;
  items: Array<Record<string, unknown>>;
  byColorSpace: Record<string, number>;
  allOK: boolean;
  [k: string]: unknown;
}

export interface RawPreviewReport {
  /**
   * v1.1.0 前置门：'completed' 正常完整报告；'skipped' 文档颜色模式非 CMYK(RGB/Unknown)，
   * 已跳过全部检查、各模块是 checked:false 的空壳。无此字段按 'completed' 处理(兼容旧结果)。
   */
  status?: "completed" | "skipped" | (string & {});
  /** 仅 status==='skipped'：'documentColorModeRGB' | 'documentColorModeUnknown'。 */
  skipReason?: string;
  /** 仅 status==='skipped'：给客户直接展示的人工确认文案。 */
  skipMessage?: string;
  fileName: string;
  /** 未保存文档可能是 "未保存"。 */
  filePath: string;
  /** 画板尺寸列表，单位 mm。 */
  artboardSize: Array<{ name: string; width: number; height: number }>;
  linkedImages: RawPreviewImageGroup;
  rasterImages: RawPreviewImageGroup;
  colors: {
    /** "CMYK" | "RGB" | "Unknown"。 */
    documentColorMode: string;
    processColors: string[];
    spotColors: string[];
    hasRegistration: boolean;
    [k: string]: unknown;
  };
  fonts: {
    total: number;
    missing: string[];
    allOK: boolean;
    /** 无 TextFrame 时 true，通常表示已转曲。 */
    isOutlined: boolean;
    used: Array<Record<string, unknown>>;
    [k: string]: unknown;
  };
  whiteOverprint: {
    hasIssue: boolean;
    found: Array<Record<string, unknown>>;
    [k: string]: unknown;
  };
  thinStrokes: { hasIssue: boolean; found: Array<Record<string, unknown>>; [k: string]: unknown };
  dieLines: {
    found: boolean;
    count: number;
    /** 有效预审区域 — 展开尺寸优先读这里，兜底 primaryDieLine → artboardSize[0]。 */
    regions: Array<Record<string, unknown>>;
    regionCount: number;
    [k: string]: unknown;
  };
  colorSeparations: {
    /** 未检测到有效刀线时 false；RGB 文档可为 true 但 insideDie 可能为空，空数组≠CMYK。 */
    checked: boolean;
    allSeparations: string[];
    /** 刀线内实际用色 — 「颜色名称」展示优先用它。 */
    insideDie: string[];
    outsideDie: string[];
    [k: string]: unknown;
  };
  /** 当前未实现：{ checked: false, todo: true }。todo 不是检查失败。 */
  barcodeCharacters: { checked: boolean; [k: string]: unknown };
  barcodeQuietZone: { checked: boolean; [k: string]: unknown };
  /** 问题「类目」数，不是具体问题条数。 */
  issueCount: number;
  [k: string]: unknown;
}

// ───── AI 预审报告（展示模型）────────────────────────────────────
// ReviewReportModal 渲染用的展示层结构，由 deriveReport.ts 从 RawPreviewReport
// 按 client guide 的派生规则现算，不直接来自任何接口。
// 不做严重度分级:非通过项一律「未通过」,判定只剩 通过/不通过(业务方要求)。
export type ReviewVerdict = "pass" | "fail";
/** skipped = 该项检查未执行（如条码检查 checked=false），不是失败。 */
export type ReviewCheckStatus = "pass" | "fail" | "skipped";

/** 单项检测的明细字段（元素 / 当前值 / 期望值 / 位置…）。tone 决定取值的强调色。 */
export interface ReviewCheckField {
  label: string;
  value: string;
  tone?: "current" | "expected";
}

export interface ReviewCheckDetail {
  summary?: string;
  fields?: ReviewCheckField[];
  suggestion?: string;
}

export interface ReviewCheckItem {
  name: string;
  status: ReviewCheckStatus;
  /** 状态徽标文案覆写：skipped 默认显示「未检查」（条码 todo），刀线「未检出」等场景措辞不同。 */
  statusLabel?: string;
  // 有 detail 的项可展开查看问题明细与修复建议；通过项一般无 detail。
  detail?: ReviewCheckDetail;
}

/** 图文预审信息章（客户文档 08）里的逐项布尔勾选。 */
export interface ReviewChecklistItem {
  label: string;
  ok: boolean;
}

/**
 * v1.1.0 前置门跳过态：文档颜色模式非 CMYK 时预审被整体跳过。
 * 没有 verdict/checks/checklist —— 各模块空壳不代表「通过」，只展示 message + 转人工确认。
 */
export interface SkippedReviewReport {
  kind: "skipped";
  /** 'documentColorModeRGB' | 'documentColorModeUnknown' 等。 */
  reason: string;
  /** 给客户直接展示的人工确认文案（skipMessage 原文）。 */
  message: string;
  fileName: string;
  productCode: string;
  reviewDate: string;
  operator: string;
}

export interface CompletedReviewReport {
  kind: "completed";
  /** 含 skipped 项；passed/failed 不计 skipped。 */
  totalChecks: number;
  passed: number;
  failed: number;
  /** 由各检查项推导：有未通过项 → fail，否则 pass。 */
  verdict: ReviewVerdict;
  infoChapter: {
    fileName: string;
    productCode: string;
    colorName: string;
    artboardSize: string;
    unfoldedSize: string;
    checklist: ReviewChecklistItem[];
    reviewDate: string;
    operator: string;
  };
  checks: ReviewCheckItem[];
  issues: string[];
}

export type ReviewReport = SkippedReviewReport | CompletedReviewReport;

export interface ObserveLogItem {
  id: number;
  source: LogSource;
  level: LogLevel;
  phase: OrderState;
  message: string;
  detail: Record<string, unknown> | null;
  emittedAt: string | null;
  createdAt: string;
}

export interface ObserveLogsData {
  items: ObserveLogItem[];
  nextAfter: number | null;
  hasMore: boolean;
}
