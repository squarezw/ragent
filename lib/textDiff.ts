// 草稿 vs 已发布的文本对照算法（纯函数，无第三方依赖；SkillDiffDialog 正文与资产文本共用）
//
// 行级 LCS → 相邻 remove/add 按相似度配对成 modify → modify 行再做字符级 LCS 供行内高亮。
// 中文没有词边界，字符切分一律走 Intl.Segmenter 的 grapheme（退化时用 Array.from 的码点），
// 绝不用 split("")——否则代理对（emoji）会被劈成两个半字符。

export type DiffRowType = "equal" | "add" | "remove" | "modify";
export type DiffSegmentType = "equal" | "add" | "remove";

/** modify 行的字符级片段；左栏只渲染 equal|remove，右栏只渲染 equal|add */
export interface DiffSegment {
  type: DiffSegmentType;
  text: string;
}

/** 一条左右对齐的行对；某侧无对应内容时该侧字段为 null（渲染成占位空行） */
export interface DiffRow {
  type: DiffRowType;
  /** 1 基行号 */
  leftLineNo: number | null;
  rightLineNo: number | null;
  leftText: string | null;
  rightText: string | null;
  /** 仅 modify 行有；降级路径下缺省 */
  segments?: DiffSegment[];
}

export interface DiffStats {
  added: number;
  removed: number;
  modified: number;
  unchanged: number;
  hasChanges: boolean;
}

export interface TextDiffResult {
  rows: DiffRow[];
  stats: DiffStats;
  /** true = 文本过大已走降级路径：仅逐行等位比对，且不出字符级片段 */
  degraded: boolean;
}

/**
 * 行级 LCS 的 DP 单元上限（去掉公共首尾后的 left×right）。
 * 4e6 ≈ 2000×2000，Int32Array 约 16MB、约 4e6 次内层迭代，浏览器上 100ms 量级；
 * 再大就不求最优对齐了，退化为逐行等位比对（O(n)）——审核场景没人会逐行读 2000 行以上的 diff。
 */
export const MAX_LINE_DIFF_CELLS = 4_000_000;

/**
 * 单行字符级 LCS 的 DP 单元上限（去掉公共首尾后的 left×right）。
 * 5e5 ≈ 700×700 字符；超长行退化为「整段替换」的两个片段，行级标注仍在。
 */
export const MAX_INLINE_DIFF_CELLS = 500_000;

/** remove/add 配对成 modify 的最低相似度（公共字符占比，Sørensen–Dice） */
export const MODIFY_PAIR_THRESHOLD = 0.3;

/** 折叠未变区段的默认上下文行数 */
export const DEFAULT_CONTEXT_LINES = 3;
/** 连续未变行超过该值才折叠 */
export const DEFAULT_MIN_COLLAPSED_RUN = 6;

let cachedSegmenter: Intl.Segmenter | null | undefined;

function graphemeSegmenter(): Intl.Segmenter | null {
  if (cachedSegmenter === undefined) {
    cachedSegmenter =
      typeof Intl !== "undefined" && typeof Intl.Segmenter === "function"
        ? new Intl.Segmenter(undefined, { granularity: "grapheme" })
        : null;
  }
  return cachedSegmenter;
}

/**
 * 按字素簇切分。Intl.Segmenter 可用时组合字符（e、u{301}）与 ZWJ emoji 保持整体；
 * 不可用时回落到 Array.from 的码点切分——代理对依然完整，只是组合字符会拆开。
 */
export function toGraphemes(text: string): string[] {
  if (text.length === 0) return [];
  const segmenter = graphemeSegmenter();
  if (!segmenter) return Array.from(text);
  const out: string[] = [];
  for (const { segment } of segmenter.segment(text)) out.push(segment);
  return out;
}

/** CRLF 归一：编辑器提交的换行差异是不可见噪声，不该占满整屏红绿 */
function splitLines(text: string): string[] {
  if (typeof text !== "string" || text.length === 0) return [];
  return text.replace(/\r\n?/g, "\n").split("\n");
}

/** 字符串数组 → 整数 id 数组（LCS 内层只比整数，避免逐格字符串比较） */
function intern(a: string[], b: string[]): { left: Int32Array; right: Int32Array } {
  const ids = new Map<string, number>();
  const encode = (items: string[]) => {
    const out = new Int32Array(items.length);
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      let id = ids.get(item);
      if (id === undefined) {
        id = ids.size;
        ids.set(item, id);
      }
      out[i] = id;
    }
    return out;
  };
  return { left: encode(a), right: encode(b) };
}

interface DiffOp {
  type: "equal" | "remove" | "add";
  leftIndex: number;
  rightIndex: number;
}

/** 标准 LCS：自底向上填 DP 表，再从头回溯出 equal/remove/add 操作序列 */
function lcsOps(a: Int32Array, b: Int32Array): DiffOp[] {
  const n = a.length;
  const m = b.length;
  const width = m + 1;
  const dp = new Int32Array((n + 1) * width);
  for (let i = n - 1; i >= 0; i--) {
    const rowBase = i * width;
    const nextBase = rowBase + width;
    const ai = a[i];
    for (let j = m - 1; j >= 0; j--) {
      if (ai === b[j]) {
        dp[rowBase + j] = dp[nextBase + j + 1] + 1;
      } else {
        const down = dp[nextBase + j];
        const rightward = dp[rowBase + j + 1];
        dp[rowBase + j] = down >= rightward ? down : rightward;
      }
    }
  }

  const ops: DiffOp[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      ops.push({ type: "equal", leftIndex: i, rightIndex: j });
      i++;
      j++;
    } else if (dp[(i + 1) * width + j] >= dp[i * width + j + 1]) {
      ops.push({ type: "remove", leftIndex: i, rightIndex: j });
      i++;
    } else {
      ops.push({ type: "add", leftIndex: i, rightIndex: j });
      j++;
    }
  }
  while (i < n) {
    ops.push({ type: "remove", leftIndex: i, rightIndex: j });
    i++;
  }
  while (j < m) {
    ops.push({ type: "add", leftIndex: i, rightIndex: j });
    j++;
  }
  return ops;
}

function commonPrefixLength(a: readonly string[], b: readonly string[]): number {
  const max = Math.min(a.length, b.length);
  let i = 0;
  while (i < max && a[i] === b[i]) i++;
  return i;
}

function commonSuffixLength(a: readonly string[], b: readonly string[], skip: number): number {
  const max = Math.min(a.length, b.length) - skip;
  let i = 0;
  while (i < max && a[a.length - 1 - i] === b[b.length - 1 - i]) i++;
  return i;
}

/**
 * 字符（字素簇）相似度：公共字符多重集占两侧总长的比例。
 * 只用来决定 remove+add 要不要合成一条 modify，不参与高亮，故取 O(n+m) 的多重集交集而非 LCS。
 */
export function charSimilarity(left: string, right: string): number {
  if (left === right) return 1;
  if (left.length === 0 || right.length === 0) return 0;
  const a = toGraphemes(left);
  const b = toGraphemes(right);
  const counts = new Map<string, number>();
  for (const g of a) counts.set(g, (counts.get(g) ?? 0) + 1);
  let common = 0;
  for (const g of b) {
    const remaining = counts.get(g);
    if (remaining !== undefined && remaining > 0) {
      counts.set(g, remaining - 1);
      common++;
    }
  }
  return (2 * common) / (a.length + b.length);
}

function pushSegment(segments: DiffSegment[], type: DiffSegmentType, text: string): void {
  if (text.length === 0) return;
  const last = segments[segments.length - 1];
  if (last && last.type === type) {
    last.text += text;
    return;
  }
  segments.push({ type, text });
}

/**
 * 单行字符级 diff。返回的片段按左→右阅读顺序排列；
 * 左栏渲染时过滤掉 add、右栏过滤掉 remove，即可两侧共用同一份片段。
 */
export function diffChars(left: string, right: string): DiffSegment[] {
  if (left === right) {
    return left.length === 0 ? [] : [{ type: "equal", text: left }];
  }
  const a = toGraphemes(left);
  const b = toGraphemes(right);
  const prefix = commonPrefixLength(a, b);
  const suffix = commonSuffixLength(a, b, prefix);
  const coreA = a.slice(prefix, a.length - suffix);
  const coreB = b.slice(prefix, b.length - suffix);

  const segments: DiffSegment[] = [];
  pushSegment(segments, "equal", a.slice(0, prefix).join(""));

  if (coreA.length * coreB.length > MAX_INLINE_DIFF_CELLS) {
    // 超长行：不求最优对齐，整段替换（行级/前后缀标注仍然有效）
    pushSegment(segments, "remove", coreA.join(""));
    pushSegment(segments, "add", coreB.join(""));
  } else {
    const interned = intern(coreA, coreB);
    for (const op of lcsOps(interned.left, interned.right)) {
      if (op.type === "equal") pushSegment(segments, "equal", coreA[op.leftIndex]);
      else if (op.type === "remove") pushSegment(segments, "remove", coreA[op.leftIndex]);
      else pushSegment(segments, "add", coreB[op.rightIndex]);
    }
  }

  pushSegment(segments, "equal", a.slice(a.length - suffix).join(""));
  return segments;
}

function equalRow(leftIndex: number, rightIndex: number, text: string): DiffRow {
  return {
    type: "equal",
    leftLineNo: leftIndex + 1,
    rightLineNo: rightIndex + 1,
    leftText: text,
    rightText: text,
  };
}

function removeRow(leftIndex: number, text: string): DiffRow {
  return {
    type: "remove",
    leftLineNo: leftIndex + 1,
    rightLineNo: null,
    leftText: text,
    rightText: null,
  };
}

function addRow(rightIndex: number, text: string): DiffRow {
  return {
    type: "add",
    leftLineNo: null,
    rightLineNo: rightIndex + 1,
    leftText: null,
    rightText: text,
  };
}

function modifyRow(
  leftIndex: number,
  rightIndex: number,
  leftText: string,
  rightText: string,
  inline: boolean
): DiffRow {
  return {
    type: "modify",
    leftLineNo: leftIndex + 1,
    rightLineNo: rightIndex + 1,
    leftText,
    rightText,
    ...(inline ? { segments: diffChars(leftText, rightText) } : {}),
  };
}

/**
 * 一个变更块（连续的 remove/add）内按出现次序等位配对：
 * 相似度过阈值的合成 modify（可做行内高亮），否则保持独立的删除行 + 新增行，
 * 免得两条毫不相干的行被强行拼成一行，行内高亮变成整行乱码。
 * 降级路径（fast=true）下左右已按位置对齐，跳过相似度判定直接配对。
 */
function flushBlock(
  rows: DiffRow[],
  removes: number[],
  adds: number[],
  leftLines: string[],
  rightLines: string[],
  fast: boolean
): void {
  const paired = Math.min(removes.length, adds.length);
  for (let k = 0; k < paired; k++) {
    const leftIndex = removes[k];
    const rightIndex = adds[k];
    const leftText = leftLines[leftIndex];
    const rightText = rightLines[rightIndex];
    if (fast || charSimilarity(leftText, rightText) > MODIFY_PAIR_THRESHOLD) {
      rows.push(modifyRow(leftIndex, rightIndex, leftText, rightText, !fast));
    } else {
      rows.push(removeRow(leftIndex, leftText));
      rows.push(addRow(rightIndex, rightText));
    }
  }
  for (let k = paired; k < removes.length; k++) {
    rows.push(removeRow(removes[k], leftLines[removes[k]]));
  }
  for (let k = paired; k < adds.length; k++) {
    rows.push(addRow(adds[k], rightLines[adds[k]]));
  }
  removes.length = 0;
  adds.length = 0;
}

function buildRows(
  leftLines: string[],
  rightLines: string[],
  ops: DiffOp[],
  fast: boolean
): DiffRow[] {
  const rows: DiffRow[] = [];
  const removes: number[] = [];
  const adds: number[] = [];
  for (const op of ops) {
    if (op.type === "equal") {
      flushBlock(rows, removes, adds, leftLines, rightLines, fast);
      rows.push(equalRow(op.leftIndex, op.rightIndex, leftLines[op.leftIndex]));
    } else if (op.type === "remove") {
      removes.push(op.leftIndex);
    } else {
      adds.push(op.rightIndex);
    }
  }
  flushBlock(rows, removes, adds, leftLines, rightLines, fast);
  return rows;
}

/** 降级路径：逐行等位比对（同位相同即 equal，否则整行替换），多出来的尾巴按纯新增/纯删除处理 */
function degradedOps(
  leftLines: string[],
  rightLines: string[],
  offset: number,
  leftCount: number,
  rightCount: number
): DiffOp[] {
  const ops: DiffOp[] = [];
  const paired = Math.min(leftCount, rightCount);
  for (let k = 0; k < paired; k++) {
    const leftIndex = offset + k;
    const rightIndex = offset + k;
    if (leftLines[leftIndex] === rightLines[rightIndex]) {
      ops.push({ type: "equal", leftIndex, rightIndex });
    } else {
      ops.push({ type: "remove", leftIndex, rightIndex });
      ops.push({ type: "add", leftIndex, rightIndex });
    }
  }
  for (let k = paired; k < leftCount; k++) {
    ops.push({ type: "remove", leftIndex: offset + k, rightIndex: offset + paired });
  }
  for (let k = paired; k < rightCount; k++) {
    ops.push({ type: "add", leftIndex: offset + paired, rightIndex: offset + k });
  }
  return ops;
}

function statsOf(rows: DiffRow[]): DiffStats {
  let added = 0;
  let removed = 0;
  let modified = 0;
  let unchanged = 0;
  for (const row of rows) {
    if (row.type === "add") added++;
    else if (row.type === "remove") removed++;
    else if (row.type === "modify") modified++;
    else unchanged++;
  }
  return { added, removed, modified, unchanged, hasChanges: added + removed + modified > 0 };
}

/**
 * 左（旧 / 已发布）与右（新 / 草稿）的行级对照。
 * 先剥掉公共首尾行再做 LCS——真实审核场景多是局部改动，这一步把 DP 规模压到改动附近。
 */
export function diffTexts(left: string, right: string): TextDiffResult {
  const leftLines = splitLines(left);
  const rightLines = splitLines(right);

  const prefix = commonPrefixLength(leftLines, rightLines);
  const suffix = commonSuffixLength(leftLines, rightLines, prefix);
  const coreLeftCount = leftLines.length - suffix - prefix;
  const coreRightCount = rightLines.length - suffix - prefix;

  const degraded = coreLeftCount * coreRightCount > MAX_LINE_DIFF_CELLS;

  const ops: DiffOp[] = [];
  for (let k = 0; k < prefix; k++) {
    ops.push({ type: "equal", leftIndex: k, rightIndex: k });
  }
  if (degraded) {
    ops.push(...degradedOps(leftLines, rightLines, prefix, coreLeftCount, coreRightCount));
  } else if (coreLeftCount > 0 && coreRightCount > 0) {
    const coreLeft = leftLines.slice(prefix, prefix + coreLeftCount);
    const coreRight = rightLines.slice(prefix, prefix + coreRightCount);
    const interned = intern(coreLeft, coreRight);
    for (const op of lcsOps(interned.left, interned.right)) {
      ops.push({
        type: op.type,
        leftIndex: op.leftIndex + prefix,
        rightIndex: op.rightIndex + prefix,
      });
    }
  } else {
    for (let k = 0; k < coreLeftCount; k++) {
      ops.push({ type: "remove", leftIndex: prefix + k, rightIndex: prefix });
    }
    for (let k = 0; k < coreRightCount; k++) {
      ops.push({ type: "add", leftIndex: prefix, rightIndex: prefix + k });
    }
  }
  for (let k = 0; k < suffix; k++) {
    ops.push({
      type: "equal",
      leftIndex: leftLines.length - suffix + k,
      rightIndex: rightLines.length - suffix + k,
    });
  }

  const rows = buildRows(leftLines, rightLines, ops, degraded);
  return { rows, stats: statsOf(rows), degraded };
}

/** 折叠分组：collapsed 组内全是未变行，UI 点击后原地展开 */
export interface DiffGroup {
  type: "visible" | "collapsed";
  rows: DiffRow[];
  /** 组内首行在 diffTexts().rows 里的下标，供导航与 key 使用 */
  startIndex: number;
}

export interface GroupDiffOptions {
  contextLines?: number;
  minCollapsedRun?: number;
}

/**
 * 把行序列切成「可见段 / 可折叠的未变段」。
 * 连续未变行超过 minCollapsedRun 时，保留紧邻改动的 contextLines 行上下文，中间折起来；
 * 首段没有上文、尾段没有下文，对应侧的上下文不保留（GitHub 的做法）。
 */
export function groupDiffRows(rows: DiffRow[], options: GroupDiffOptions = {}): DiffGroup[] {
  const context = options.contextLines ?? DEFAULT_CONTEXT_LINES;
  const minRun = options.minCollapsedRun ?? DEFAULT_MIN_COLLAPSED_RUN;
  const groups: DiffGroup[] = [];

  const pushRows = (type: DiffGroup["type"], startIndex: number, slice: DiffRow[]) => {
    if (slice.length === 0) return;
    const last = groups[groups.length - 1];
    if (type === "visible" && last && last.type === "visible") {
      last.rows.push(...slice);
      return;
    }
    groups.push({ type, rows: slice, startIndex });
  };

  let i = 0;
  while (i < rows.length) {
    if (rows[i].type !== "equal") {
      const start = i;
      while (i < rows.length && rows[i].type !== "equal") i++;
      pushRows("visible", start, rows.slice(start, i));
      continue;
    }
    const start = i;
    while (i < rows.length && rows[i].type === "equal") i++;
    const runLength = i - start;
    const keepBefore = start === 0 ? 0 : context;
    const keepAfter = i === rows.length ? 0 : context;
    const hidden = runLength - keepBefore - keepAfter;
    if (runLength > minRun && hidden > 0) {
      pushRows("visible", start, rows.slice(start, start + keepBefore));
      pushRows("collapsed", start + keepBefore, rows.slice(start + keepBefore, i - keepAfter));
      pushRows("visible", i - keepAfter, rows.slice(i - keepAfter, i));
    } else {
      pushRows("visible", start, rows.slice(start, i));
    }
  }
  return groups;
}

/** 每处连续改动的首行下标，供「上一处 / 下一处」导航 */
export function diffHunkStarts(rows: DiffRow[]): number[] {
  const starts: number[] = [];
  let inHunk = false;
  for (let i = 0; i < rows.length; i++) {
    if (rows[i].type === "equal") {
      inHunk = false;
      continue;
    }
    if (!inHunk) {
      starts.push(i);
      inHunk = true;
    }
  }
  return starts;
}
