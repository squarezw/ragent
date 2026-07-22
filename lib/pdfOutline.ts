import { PDFDocument, PDFHexString, PDFName, type PDFRef } from "pdf-lib";
import pdfParse from "pdf-parse";
import type { DocxHeading } from "@/lib/docxOutline";
import { type LocatedHeading, matchHeadings, type PdfLine } from "@/lib/pdfOutlineMatch";

/**
 * 在 PDF 中按文档顺序定位 docx 标题，返回可定位的标题 + 未命中的标题文本。
 * 解析 PDF 取文本行后委托给纯函数 {@link matchHeadings}（后者可脱离 PDF 单测）。
 */
export async function locateHeadings(
  pdf: Buffer,
  headings: DocxHeading[]
): Promise<{ located: LocatedHeading[]; missing: string[] }> {
  const lines = await extractPdfLines(pdf);
  return matchHeadings(lines, headings);
}

/** 把定位好的标题写进 PDF outline（书签），并让阅读器默认展开书签面板 */
export async function injectPdfOutline(pdf: Buffer, items: LocatedHeading[]): Promise<Buffer> {
  if (items.length === 0) {
    throw new Error("injectPdfOutline called with no items");
  }
  const doc = await PDFDocument.load(pdf, { updateMetadata: false });
  const ctx = doc.context;
  const pageRefs = doc.getPages().map((p) => p.ref);

  interface Node extends LocatedHeading {
    ref: PDFRef;
    children: Node[];
  }
  const rootRef = ctx.nextRef();
  const rootChildren: Node[] = [];
  const stack: Node[] = [];

  for (const item of items) {
    if (item.pageIndex >= pageRefs.length) {
      throw new Error(
        `outline item points to page ${item.pageIndex} but PDF has ${pageRefs.length} pages`
      );
    }
    const node: Node = { ...item, ref: ctx.nextRef(), children: [] };
    while (stack.length > 0 && item.level <= stack[stack.length - 1].level) {
      stack.pop();
    }
    (stack.length > 0 ? stack[stack.length - 1].children : rootChildren).push(node);
    stack.push(node);
  }

  const writeNodes = (nodes: Node[], parentRef: PDFRef): number => {
    let count = nodes.length;
    nodes.forEach((node, i) => {
      const dict: Record<string, unknown> = {
        Title: PDFHexString.fromText(node.title),
        Parent: parentRef,
        // /XYZ x y zoom：跳到标题行上方一点；null 保持阅读器当前缩放
        Dest: [pageRefs[node.pageIndex], "XYZ", null, node.y + 18, null],
      };
      if (i > 0) dict.Prev = nodes[i - 1].ref;
      if (i < nodes.length - 1) dict.Next = nodes[i + 1].ref;
      if (node.children.length > 0) {
        const descendants = writeNodes(node.children, node.ref);
        dict.First = node.children[0].ref;
        dict.Last = node.children[node.children.length - 1].ref;
        dict.Count = descendants; // 正数 = 默认展开
        count += descendants;
      }
      ctx.assign(node.ref, ctx.obj(dict as Parameters<typeof ctx.obj>[0]));
    });
    return count;
  };

  const total = writeNodes(rootChildren, rootRef);
  ctx.assign(
    rootRef,
    ctx.obj({
      Type: "Outlines",
      First: rootChildren[0].ref,
      Last: rootChildren[rootChildren.length - 1].ref,
      Count: total,
    })
  );
  doc.catalog.set(PDFName.of("Outlines"), rootRef);
  doc.catalog.set(PDFName.of("PageMode"), PDFName.of("UseOutlines"));

  return Buffer.from(await doc.save({ useObjectStreams: false }));
}

/** 逐页提取文本行（按 y 聚类成行，行内按 x 排序），顺序为阅读顺序 */
async function extractPdfLines(pdf: Buffer): Promise<PdfLine[]> {
  const lines: PdfLine[] = [];
  let pageIndex = 0;

  await pdfParse(pdf, {
    pagerender: async (pageData: {
      getTextContent: (opts: object) => Promise<{
        items: Array<{ str: string; transform: number[] }>;
      }>;
    }) => {
      const tc = await pageData.getTextContent({ normalizeWhitespace: true });
      // 按 y 降序排一次再贪心分组（容差 2pt）：同一行的 text item y 基本一致。
      // 不用哈希桶 —— 取整边界 + 邻桶探测的结果依赖 item 在内容流里的出现顺序，
      // 同一视觉行可能被拆成两行导致标题匹配失败；排序后分组与顺序无关。
      const items = tc.items
        .filter((i) => i.str)
        .map((i) => ({ x: i.transform[4], y: i.transform[5], str: i.str }))
        .sort((a, b) => b.y - a.y);

      const rows: Array<{ y: number; items: Array<{ x: number; str: string }> }> = [];
      for (const item of items) {
        const last = rows[rows.length - 1];
        // last.y 是行内最高的 y（降序首个 item），同行 item 与它的差应在 2pt 内
        if (last && last.y - item.y < 2) {
          last.items.push(item);
        } else {
          rows.push({ y: item.y, items: [item] });
        }
      }

      for (const row of rows) {
        const text = row.items
          .sort((a, b) => a.x - b.x)
          .map((i) => i.str)
          .join("");
        if (text.trim()) {
          lines.push({ pageIndex, y: row.y, text });
        }
      }
      pageIndex++;
      return "";
    },
  });
  return lines;
}
