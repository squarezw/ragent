/**
 * 预审原始报告 → 展示模型派生。
 *
 * 规则全部来自 zd-service docs/api/raw-preview-report-client-guide.md（预审 MCP 的
 * 客户端解析指南）：检查项通过与否、颜色名称、展开尺寸等都是展示层派生，原始 JSON
 * 没有现成字段。要点：
 *   - colorSpace "Unknown" 按不通过处理，不默认当作 CMYK；
 *   - 条码两项 checked=false 表示「未检查」（todo 占位），不是失败 → skipped；
 *   - 展开尺寸优先 dieLines.regions[].bounds，兜底 primaryDieLine；刀线未检出(found=false)
 *     时不再回落 artboardSize（那是整张标题板尺寸，不是展开尺寸），显式提示人工确认；
 *   - 检测到刀线时各模块 items/found 已按刀线区域过滤，前端不做二次几何过滤；
 *   - 读数组字段前给默认空数组（旧结果可能缺字段）。
 *
 * 派生出的 name / summary / issues 等文案为业务中文（与企微通知一致的客户语境），
 * 不走 i18n —— 弹窗骨架文案（标题/状态徽标等）仍由 ReviewReportModal 走 t()。
 */
import type {
  ObserveOrderDetailData,
  RawPreviewReport,
  ReviewCheckField,
  ReviewCheckItem,
  ReviewChecklistItem,
  ReviewReport,
  ReviewVerdict,
} from "./types";
import { formatDate } from "./time";

// ───── 防御取值：原始 JSON 来自外部进程，骨架之外不假设任何字段存在 ─────

function asArray<T = Record<string, unknown>>(v: unknown): T[] {
  return Array.isArray(v) ? (v as T[]) : [];
}

function asStrings(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
}

function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}

/** mm 数值展示：整数不带小数位，非整数保留 1 位。 */
function mm(v: number): string {
  return Number.isInteger(v) ? String(v) : v.toFixed(1);
}

/**
 * 明细字段列表截断：超长列表只展示前 MAX 条 + 「等 N 项」，避免弹窗被撑爆。
 * 「期望/标准值」对照行（tone="expected"）恒保留——它是明细的比对基准，
 * 正好排在末尾，盲目 slice 会在问题最多时把它截没，让用户只看到一堆红值却没有对照标准。
 */
const MAX_DETAIL_ITEMS = 8;
function capFields(fields: ReviewCheckField[]): ReviewCheckField[] {
  const expected = fields.filter((f) => f.tone === "expected");
  const items = fields.filter((f) => f.tone !== "expected");
  if (items.length <= MAX_DETAIL_ITEMS) return fields;
  return [
    ...items.slice(0, MAX_DETAIL_ITEMS),
    { label: "…", value: `等 ${items.length} 项` },
    ...expected,
  ];
}

// ───── 各检查项派生 ─────

interface DerivedChecks {
  checks: ReviewCheckItem[];
  issues: string[];
}

function deriveChecks(raw: RawPreviewReport): DerivedChecks {
  const checks: ReviewCheckItem[] = [];
  const issues: string[] = [];

  const linkedMissing = asStrings(raw.linkedImages?.missing);
  const rasterMissing = asStrings(raw.rasterImages?.missing);
  const lowRes = [...asArray(raw.linkedImages?.lowRes), ...asArray(raw.rasterImages?.lowRes)];
  const imageItems = [...asArray(raw.linkedImages?.items), ...asArray(raw.rasterImages?.items)];

  // 1. 图片颜色是否 CMYK：v1.1.0 起完整报告(status='completed')的文档模式必为 CMYK——
  // RGB/Unknown 文档已被前置门拦成 status='skipped'、根本进不到这里(见 deriveReviewReport)。
  // 故本项只看参与检查的图片色彩空间(Unknown 不算通过);无图片视为通过。
  const nonCmyk = imageItems.filter((it) => str(it.colorSpace) !== "CMYK");
  if (nonCmyk.length === 0) {
    checks.push({ name: "图片颜色", status: "pass" });
  } else {
    const fields: ReviewCheckField[] = [
      ...nonCmyk.map((it) => ({
        label: str(it.name) || "未命名图片",
        value: str(it.colorSpace) || "Unknown",
        tone: "current" as const,
      })),
      { label: "标准值", value: "CMYK", tone: "expected" },
    ];
    checks.push({
      name: "图片颜色",
      status: "fail",
      detail: {
        summary: `${nonCmyk.length} 个图片颜色空间非 CMYK`,
        fields: capFields(fields),
        suggestion: "将所有置入/嵌入图片转换为 CMYK 色彩模式（Unknown 也按不通过处理）",
      },
    });
    for (const it of nonCmyk) {
      issues.push(
        `非 CMYK 图片：${str(it.name) || "未命名图片"}（${str(it.colorSpace) || "Unknown"}）`
      );
    }
  }

  // 2. 链接图片是否齐全：linkedImages.missing + rasterImages.missing 都为空
  const allMissing = [...linkedMissing, ...rasterMissing];
  if (allMissing.length === 0) {
    checks.push({ name: "链接图片", status: "pass" });
  } else {
    checks.push({
      name: "链接图片",
      status: "fail",
      detail: {
        summary: `${allMissing.length} 个置入图片缺失`,
        fields: capFields(
          allMissing.map((name) => ({ label: "缺失", value: name, tone: "current" as const }))
        ),
        suggestion: "随源文件一并提供缺失的链接图片，或重新嵌入",
      },
    });
    for (const name of allMissing) issues.push(`缺失置入图片：${name}`);
  }

  // 3. 图片精度：lowRes 为空即符合（低于约 300 DPI 进入 lowRes）
  if (lowRes.length === 0) {
    checks.push({ name: "图片精度", status: "pass" });
  } else {
    checks.push({
      name: "图片精度",
      status: "fail",
      detail: {
        summary: `${lowRes.length} 张图片低于 300 DPI`,
        fields: capFields([
          ...lowRes.map((it) => ({
            label: str(it.name) || "未命名图片",
            value: num(it.effectiveDPI) != null ? `${num(it.effectiveDPI)} DPI` : "DPI 未知",
            tone: "current" as const,
          })),
          { label: "建议值", value: "≥ 300 DPI", tone: "expected" },
        ]),
        suggestion: "替换为 300 DPI 以上的高清原图",
      },
    });
    for (const it of lowRes) {
      const dpi = num(it.effectiveDPI);
      issues.push(
        `图片精度不足：${str(it.name) || "未命名图片"}（${dpi != null ? `${dpi} DPI` : "DPI 未知"}，需 ≥300 DPI）`
      );
    }
  }

  // 4. 字体缺失：missing 非空即缺失;isOutlined=true 表示已转曲
  const missingFonts = asStrings(raw.fonts?.missing);
  if (missingFonts.length === 0) {
    checks.push({
      name: "字体缺失",
      status: "pass",
      detail:
        raw.fonts?.isOutlined === true ? { summary: "未检测到文本框，文字已转曲" } : undefined,
    });
  } else {
    checks.push({
      name: "字体缺失",
      status: "fail",
      detail: {
        summary: `缺失 ${missingFonts.length} 种字体`,
        fields: capFields(
          missingFonts.map((name) => ({ label: "缺失字体", value: name, tone: "current" as const }))
        ),
        suggestion: "补装缺失字体，或在源文件中将文字转曲",
      },
    });
    for (const name of missingFonts) issues.push(`缺失字体：${name}`);
  }

  // 5. 白色叠印：印刷时白色元素会消失，按 fail 处理
  const overprintFound = asArray(raw.whiteOverprint?.found);
  if (raw.whiteOverprint?.hasIssue === true) {
    checks.push({
      name: "白色叠印",
      status: "fail",
      detail: {
        summary: `${overprintFound.length} 处白色填充/描边设置了叠印`,
        fields: capFields(
          overprintFound.map((it) => ({
            label: `${str(it.type) || "对象"} ${str(it.name) || ""}`.trim(),
            value: str(it.layer) ? `图层 ${str(it.layer)}` : "图层未知",
            tone: "current" as const,
          }))
        ),
        suggestion: "取消白色元素的叠印设置（白色叠印输出时会消失）",
      },
    });
    for (const it of overprintFound) {
      issues.push(
        `白色叠印：${str(it.type) || "对象"} ${str(it.name) || "未命名"}（图层 ${str(it.layer) || "未知"}）`
      );
    }
  } else {
    checks.push({ name: "白色叠印", status: "pass" });
  }

  // 6. 细小线条：< 0.1mm 的描边（不限白色）
  const thinFound = asArray(raw.thinStrokes?.found);
  if (raw.thinStrokes?.hasIssue === true) {
    checks.push({
      name: "细小线条",
      status: "fail",
      detail: {
        summary: `${thinFound.length} 条描边低于 0.1mm`,
        fields: capFields([
          ...thinFound.map((it) => ({
            label: str(it.name) || "未命名路径",
            value: num(it.width) != null ? `${num(it.width)}mm` : "线宽未知",
            tone: "current" as const,
          })),
          { label: "标准值", value: "≥ 0.1mm", tone: "expected" },
        ]),
        suggestion: "将过细线条加粗到 0.1mm 以上，避免印刷丢失",
      },
    });
    for (const it of thinFound) {
      const w = num(it.width);
      issues.push(
        `过细线：${str(it.name) || "未命名路径"}（${w != null ? `${w}mm` : "线宽未知"}，需 ≥0.1mm）`
      );
    }
  } else {
    checks.push({ name: "细小线条", status: "pass" });
  }

  // 7. 刀线检测：found=true 即各项检查已按有效刀线区域过滤。
  // 未检出是「检查范围」的提示性 caveat,不是质量问题(guide 的 issueCount 不计它)——
  // 用 skipped(灰色,不进判定计数)+ 徽标覆写「未检出」,避免零问题文件被判成「不通过」。
  const regionCount = num(raw.dieLines?.regionCount) ?? 0;
  if (hasValidDieLine(raw)) {
    checks.push({
      name: "刀线检测",
      status: "pass",
      detail: {
        summary: `检测到 ${regionCount} 个有效预审区域，各项检查已按刀线范围过滤`,
        fields: capFields(dieLineSizes(raw).map((s, i) => ({ label: `区域 ${i + 1}`, value: s }))),
      },
    });
  } else {
    checks.push({
      name: "刀线检测",
      status: "skipped",
      statusLabel: "未检出",
      detail: {
        summary: "未检测到有效刀线（未找到，或刀线区域面积为 0），各项检查未按刀线区域过滤（可能包含画板外对象）",
      },
    });
    // 未检出虽不计入「不通过」判定（见上），但展开尺寸无从推导、检查范围不可信，
    // 仍需在问题区给一条人工确认告警——否则这类文件会被显示成「零问题」。
    issues.push("未自动识别到有效刀线：展开尺寸与各项检查范围需人工确认");
  }

  // 8/9. 条码两项：checked=false 是「未检查」（todo 占位），不是失败
  checks.push(barcodeCheck("条码字符", raw.barcodeCharacters));
  checks.push(barcodeCheck("条码空白区", raw.barcodeQuietZone));

  return { checks, issues };
}

/** 条码检查：未实现时 checked=false → skipped;实现后以 hasIssue 判断。 */
function barcodeCheck(
  name: string,
  r: { checked: boolean; [k: string]: unknown } | undefined
): ReviewCheckItem {
  if (r?.checked !== true) return { name, status: "skipped" };
  return r.hasIssue === true ? { name, status: "fail" } : { name, status: "pass" };
}

// ───── 信息章派生 ─────

/** 刀线推导的展开尺寸：优先 dieLines.regions[].bounds，兜底 primaryDieLine。不含 artboard 兜底。 */
function dieLineSizes(raw: RawPreviewReport): string[] {
  const out: string[] = [];
  for (const region of asArray(raw.dieLines?.regions)) {
    const bounds = region.bounds as Record<string, unknown> | undefined;
    const w = num(bounds?.widthMM);
    const h = num(bounds?.heightMM);
    if (w != null && h != null) out.push(`${mm(w)}×${mm(h)}mm`);
  }
  if (out.length > 0) return out;

  const primary = raw.dieLines?.primaryDieLine as Record<string, unknown> | undefined;
  const pw = num(primary?.widthMM);
  const ph = num(primary?.heightMM);
  if (pw != null && ph != null) return [`${mm(pw)}×${mm(ph)}mm`];
  return [];
}

/** 是否有「有效」刀线：found=true 且区域面积非 0。宽/高/面积≈0（如 12.9×0mm）= 没有有效
 *  刀线，按未找到同一逻辑处理——否则所有对象被判刀线外、各项检查空过，零问题假阴性。 */
function hasValidDieLine(raw: RawPreviewReport): boolean {
  if (raw.dieLines?.found !== true) return false;
  const EPS = 0.5; // mm；真实产品 cm 级，任一维度或面积 <0.5mm 视为无效
  const zeroArea = (b: Record<string, unknown> | undefined, areaKey: string): boolean => {
    if (!b) return false;
    const dims = [num(b.widthMM), num(b.heightMM)].filter((v): v is number => v != null);
    if (dims.length > 0 && dims.some((v) => Math.abs(v) < EPS)) return true;
    const area = num(b[areaKey]);
    return area != null && Math.abs(area) < EPS;
  };
  const dl = raw.dieLines as Record<string, unknown> | undefined;
  return !(
    zeroArea(dl?.overallBounds as Record<string, unknown> | undefined, "areaMM2") ||
    zeroArea(dl?.primaryDieLine as Record<string, unknown> | undefined, "boundingAreaMM2")
  );
}

/** 展开尺寸文案：刀线推导优先；刀线未检出（含面积为 0 的无效刀线）时不拿 artboardSize 充数。 */
const NO_DIE_LINE_SIZE = "未自动识别到刀线，需人工确认";
function unfoldedSizeText(raw: RawPreviewReport): string {
  // 没有有效刀线（未找到 / 面积为 0）：展开尺寸无从谈起 —— 不拿退化尺寸或 artboardSize 充数。
  // 须在取 sizes 之前判，否则 12.9×0 这类退化尺寸会先漏出去。
  if (!hasValidDieLine(raw)) return NO_DIE_LINE_SIZE;
  const sizes = dieLineSizes(raw);
  if (sizes.length > 0) return sizes.join(" / ");
  // found===true 却没拿到具体尺寸（极少见），按 guide 兜底 artboardSize[0]。
  const board = asArray<{ width?: unknown; height?: unknown }>(raw.artboardSize)[0];
  const bw = num(board?.width);
  const bh = num(board?.height);
  return bw != null && bh != null ? `${mm(bw)}×${mm(bh)}mm` : "—";
}

/** 颜色名称：优先刀线内实际分色;RGB 文档不推断 CMYK;无刀线时用文档定义的工艺色+专色。 */
function colorNames(raw: RawPreviewReport): string[] {
  if (raw.colorSeparations?.checked === true) return asStrings(raw.colorSeparations.insideDie);
  if (str(raw.colors?.documentColorMode) === "RGB") return [];
  return [...asStrings(raw.colors?.processColors), ...asStrings(raw.colors?.spotColors)];
}

/**
 * 信息章逐项勾选 = checks[] 的投影,不重新读 raw —— 通过规则只活在 deriveChecks 一处,
 * 避免详细检测卡片与信息章勾选两套编码各改各的 desync。
 * skipped 项(条码未实现 / 刀线未检出)不进章:没有可断言的结果。
 */
const CHECKLIST_PROJECTION: ReadonlyArray<{
  name: string;
  label: string;
  labelFail: string;
}> = [
  { name: "链接图片", label: "链接图片齐全", labelFail: "链接图片异常" },
  { name: "图片精度", label: "图片精度符合", labelFail: "图片精度异常" },
  { name: "字体缺失", label: "字体无缺失", labelFail: "字体异常" },
  { name: "图片颜色", label: "图片颜色 CMYK", labelFail: "图片颜色异常" },
  { name: "白色叠印", label: "无白色叠印", labelFail: "白色叠印异常" },
  { name: "细小线条", label: "无过细线", labelFail: "过细线异常" },
  { name: "条码字符", label: "条码字符", labelFail: "条码字符异常" },
  { name: "条码空白区", label: "条码空白区", labelFail: "条码空白区异常" },
];

function checklist(checks: ReviewCheckItem[]): ReviewChecklistItem[] {
  const items: ReviewChecklistItem[] = [];
  for (const { name, label, labelFail } of CHECKLIST_PROJECTION) {
    const check = checks.find((c) => c.name === name);
    if (!check || check.status === "skipped") continue;
    const ok = check.status === "pass";
    items.push({ label: ok ? label : labelFail, ok });
  }
  return items;
}

// ───── 入口 ─────

export function deriveReviewReport(detail: ObserveOrderDetailData): ReviewReport | null {
  const raw = detail.reviewReport;
  if (!raw) return null;

  // v1.1.0 前置门：文档颜色模式非 CMYK 时预审被整体跳过(status='skipped')，各模块都是
  // checked:false 的空壳。客户端指南要求渲染前先判 status：skipped 时不渲染预审栏目、
  // 不把空数组/空壳当作「通过」(否则 RGB 文件会被误显为合格)，只展示 skipMessage + 转人工。
  // 无 status 字段按 'completed' 处理(兼容旧结果)。
  if (str(raw.status) === "skipped") {
    return {
      kind: "skipped",
      reason: str(raw.skipReason) || "unknown",
      message: str(raw.skipMessage) || "文档不满足预审前置条件，请人工确认。",
      fileName: str(raw.fileName) || "—",
      productCode: detail.order.productCode || "—",
      reviewDate: formatDate(detail.order.updatedAt) || "—",
      operator: detail.order.producer || "—",
    };
  }

  const { checks, issues } = deriveChecks(raw);
  const passed = checks.filter((c) => c.status === "pass").length;
  const failed = checks.filter((c) => c.status === "fail").length;
  const verdict: ReviewVerdict = failed > 0 ? "fail" : "pass";

  return {
    kind: "completed",
    totalChecks: checks.length,
    passed,
    failed,
    verdict,
    infoChapter: {
      fileName: str(raw.fileName) || "—",
      productCode: detail.order.productCode || "—",
      colorName: colorNames(raw).join(" ") || "—",
      artboardSize:
        asArray<{ width?: unknown; height?: unknown }>(raw.artboardSize)
          .map((b) => {
            const w = num(b.width);
            const h = num(b.height);
            return w != null && h != null ? `${mm(w)}×${mm(h)}mm` : null;
          })
          .filter((s): s is string => s != null)
          .join(" / ") || "—",
      unfoldedSize: unfoldedSizeText(raw),
      checklist: checklist(checks),
      // 预审完成时间 = 进入终态时刻（updatedAt）;原始 JSON 不带时间戳
      reviewDate: formatDate(detail.order.updatedAt) || "—",
      operator: detail.order.producer || "—",
    },
    checks,
    issues,
  };
}
