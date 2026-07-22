import type { DocxHeading } from "@/lib/docxOutline";

export interface LocatedHeading {
  level: number;
  /** 书签标题：优先用 PDF 行文本（含自动编号），docx 文本兜底 */
  title: string;
  /** 0-based 页码 */
  pageIndex: number;
  /** 标题行在 PDF 用户坐标系的 y（原点在左下角） */
  y: number;
}

export interface PdfLine {
  pageIndex: number;
  y: number;
  text: string;
}

// 目录项特征：点/省略号引导符接尾随页码
export const TOC_LINE = /[.…·∙]{2,}\s*\d+\s*$/;

// 编号（"第十二章"/"1.2.3" 等）最多让标题行比标题本身长十几个字符；更长的是正文引用。
// 既是折行拼接的预算上限，也是单行命中的超长守卫——两处必须同一口径。
const NUMBERING_SLACK = 20;

/** 去掉所有空白（JS 的 \s 覆盖全角空格 　 和  ） */
export function normalize(s: string): string {
  return s.replace(/\s+/g, "");
}

/**
 * 按文档顺序把 docx 标题匹配到 PDF 文本行，返回可定位的标题 + 未命中的标题文本。
 *
 * 纯函数，不碰 PDF 解析（pdf-parse/pdf-lib）——便于脱离真实 PDF 单测。
 *
 * 匹配策略：
 * - 去全部空白后做包含匹配（docx 标题文本不含自动编号，PDF 行里有 → 包含关系兜住）
 * - 折行标题：一句话当标题时行宽放不下，PDF 里会拆成多行，单行不含完整标题串；
 *   故起点行只要是标题前缀，就向后拼接同页文本行直到凑齐整条标题（否则这类标题静默丢书签）
 * - 单调游标：标题按顺序出现，匹配位置只前进不回退，天然处理重复标题
 * - 排除目录行：点引导符 + 尾随页码的行是目录项，不是正文标题
 * - 行长限制：标题行应当基本只有标题本身（+编号），过长的单行是正文引用，跳过
 */
export function matchHeadings(
  lines: PdfLine[],
  headings: DocxHeading[]
): { located: LocatedHeading[]; missing: string[] } {
  // 预归一化一次：内层每个 (heading, line) 对都重算正则是 O(H×L)
  const normLines = lines.map((l) => normalize(l.text));
  const isToc = lines.map((l) => TOC_LINE.test(l.text));

  const located: LocatedHeading[] = [];
  const missing: string[] = [];
  let cursor = 0;

  for (const heading of headings) {
    const normHeading = normalize(heading.text);
    if (!normHeading) continue;

    const hit = findHeadingLine(lines, normLines, isToc, normHeading, cursor);
    if (!hit) {
      missing.push(heading.text);
      continue;
    }
    located.push({
      level: heading.level,
      // 折行标题取拼接后的全文；单行标题即原行文本
      title: hit.title || heading.text,
      pageIndex: lines[hit.index].pageIndex,
      y: lines[hit.index].y,
    });
    cursor = hit.index + 1;
  }
  return { located, missing };
}

/** 从 cursor 起找出一条标题的起始行，返回起始行下标 + 拼接后的标题文本；找不到返回 null。 */
function findHeadingLine(
  lines: PdfLine[],
  normLines: string[],
  isToc: boolean[],
  normHeading: string,
  cursor: number
): { index: number; title: string } | null {
  for (let i = cursor; i < lines.length; i++) {
    if (isToc[i]) continue;
    const normLine = normLines[i];
    if (!normLine) continue;
    // 起点行：本行已含整条标题（短标题单行），或本行是标题开头（长标题在 PDF 里折了行）。
    // 折行常见于一句话当标题：行宽放不下，OnlyOffice 把它拆成两行 → 任何单行都不含完整标题串。
    if (!normLine.includes(normHeading) && !normHeading.startsWith(normLine)) continue;

    // 从起点行向后拼接同页文本行，凑出整条标题
    let acc = normLine;
    const titleParts = [lines[i].text.trim()];
    let j = i;
    while (
      !acc.includes(normHeading) &&
      acc.length < normHeading.length + NUMBERING_SLACK &&
      j + 1 < lines.length &&
      lines[j + 1].pageIndex === lines[i].pageIndex &&
      !isToc[j + 1]
    ) {
      j++;
      acc += normLines[j];
      titleParts.push(lines[j].text.trim());
    }
    if (!acc.includes(normHeading)) continue;
    // 单行命中（未折行）时挡掉"正文整段引用了标题文字"的超长行
    if (i === j && normLine.length > normHeading.length + NUMBERING_SLACK) continue;

    return { index: i, title: titleParts.join("").trim() };
  }
  return null;
}
