import JSZip from "jszip";

export interface DocxHeading {
  /** 1-based 标题级别（Heading 1 → 1） */
  level: number;
  /**
   * 段落纯文本。注意：Word 自动编号（"第一章"、"1.2" 等）存在 numbering.xml 里，
   * 不在段落文本中 —— 但 OnlyOffice 渲染的 PDF 文本里有，定位时用包含匹配兜住。
   */
  text: string;
}

/**
 * 从 docx 提取正文标题（按文档顺序）。
 *
 * 级别判定与 LibreOffice 生成书签的口径一致：
 * 1. 段落 pPr 里的直接 w:outlineLvl（0-8 有效，9 表示正文）
 * 2. 否则 w:pStyle 指向的样式在 styles.xml 里声明的 outlineLvl / "heading N" 名称
 *
 * 目录域（TOC1-9 样式）不带 outlineLvl，天然不会被误提取。
 */
export async function extractDocxHeadings(docx: Buffer): Promise<DocxHeading[]> {
  const zip = await JSZip.loadAsync(docx);
  const docFile = zip.file("word/document.xml");
  if (!docFile) {
    throw new Error("invalid docx: word/document.xml missing");
  }
  const documentXml = await docFile.async("string");
  const stylesXml = (await zip.file("word/styles.xml")?.async("string")) ?? "";

  const styleLevels = parseStyleOutlineLevels(stylesXml);
  const headings: DocxHeading[] = [];

  // OOXML 中 w:p 不会嵌套 w:p，非贪婪到最近的 </w:p> 是安全的
  for (const m of documentXml.matchAll(/<w:p[ >][\s\S]*?<\/w:p>/g)) {
    const paragraph = m[0];
    const level = paragraphOutlineLevel(paragraph, styleLevels);
    if (level === null) continue;

    const text = paragraphText(paragraph);
    if (!text) continue;

    headings.push({ level, text });
  }
  return headings;
}

/**
 * styles.xml: styleId → 1-based outline level。
 *
 * 必须沿 w:basedOn 链上溯：企业模板常见"制度标题一 basedOn 标题1"的派生样式，
 * outlineLvl 只声明在祖先样式上，不上溯会把这类标题整体判为正文 → 静默丢掉全部书签。
 * 派生样式显式声明 outlineLvl=9（正文）则终止上溯，不再继承祖先的级别。
 */
function parseStyleOutlineLevels(stylesXml: string): Map<string, number> {
  // level: 1-9 = 标题级别；"body" = 显式 outlineLvl=9；null = 未声明（需上溯）
  const styles = new Map<string, { level: number | "body" | null; basedOn: string | null }>();
  for (const m of stylesXml.matchAll(
    /<w:style\b[^>]*w:type="paragraph"[^>]*>([\s\S]*?)<\/w:style>/g
  )) {
    const styleId = m[0].match(/w:styleId="([^"]+)"/)?.[1];
    if (!styleId) continue;

    let level: number | "body" | null = null;
    const outlineMatch = m[1].match(/<w:outlineLvl\b[^>]*w:val="(\d)"/);
    if (outlineMatch) {
      const lvl = Number(outlineMatch[1]);
      level = lvl <= 8 ? lvl + 1 : "body";
    } else {
      // 内置标题样式可能不带 outlineLvl，靠样式名 "heading N" 识别（中文 Word 的 styleId 常是 "1"-"9"）
      const nameMatch = m[1].match(/<w:name\b[^>]*w:val="heading (\d)"/i);
      if (nameMatch) level = Number(nameMatch[1]);
    }
    const basedOn = m[1].match(/<w:basedOn\b[^>]*w:val="([^"]+)"/)?.[1] ?? null;
    styles.set(styleId, { level, basedOn });
  }

  const resolved = new Map<string, number>();
  for (const styleId of styles.keys()) {
    const seen = new Set<string>();
    for (let cur: string | null = styleId; cur && !seen.has(cur); ) {
      seen.add(cur);
      const info = styles.get(cur);
      if (!info) break;
      if (info.level === "body") break;
      if (info.level !== null) {
        resolved.set(styleId, info.level);
        break;
      }
      cur = info.basedOn;
    }
  }
  return resolved;
}

function paragraphOutlineLevel(paragraph: string, styleLevels: Map<string, number>): number | null {
  const pPrMatch = paragraph.match(/<w:pPr>[\s\S]*?<\/w:pPr>/);
  if (!pPrMatch) return null;

  const direct = pPrMatch[0].match(/<w:outlineLvl\b[^>]*w:val="(\d)"/);
  if (direct) {
    const lvl = Number(direct[1]);
    return lvl <= 8 ? lvl + 1 : null;
  }

  const style = pPrMatch[0].match(/<w:pStyle\b[^>]*w:val="([^"]+)"/);
  if (style) {
    return styleLevels.get(style[1]) ?? null;
  }
  return null;
}

function paragraphText(paragraph: string): string {
  // 排除修订删除的文本（w:delText 是独立标签，不会被 w:t 捕获），只拼接 w:t
  const parts: string[] = [];
  for (const m of paragraph.matchAll(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/g)) {
    parts.push(m[1]);
  }
  return decodeXmlEntities(parts.join("")).trim();
}

function decodeXmlEntities(s: string): string {
  return s
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCodePoint(Number.parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(Number(dec)))
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}
