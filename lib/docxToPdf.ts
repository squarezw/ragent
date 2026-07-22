import crypto from "node:crypto";
import axios from "axios";
import { extractDocxHeadings } from "@/lib/docxOutline";
import { onlyofficeConvertDocxToPdf, remainingMs } from "@/lib/onlyofficeConvert";
import { injectPdfOutline, locateHeadings } from "@/lib/pdfOutline";

const DOCX_MAX_BYTES = 100 * 1024 * 1024;

export interface ConvertDocxToPdfOptions {
  /** OnlyOffice 容器与本服务都可访问的 docx 下载 URL（web 代理签名 URL 或 OSS 签名 URL） */
  sourceUrl: string;
  /** 总超时预算，默认 120s */
  timeoutMs?: number;
}

/**
 * docx → PDF：OnlyOffice 保真转换 + 标题书签后处理。
 *
 * 为什么不直接用 OnlyOffice：它转出的 PDF 没有书签（DocumentServer#2062）；
 * 为什么不用 kkFileView/LibreOffice：书签是有了，但排版保真度差、缺字体。
 * 所以两条腿走：OnlyOffice 负责排版，转换后从源 docx 提取标题，在 PDF
 * 文本中定位页码与坐标，再用 pdf-lib 写入 outline。
 *
 * 书签注入失败会抛错而不是静默返回无书签 PDF —— "没有书签"正是当初要修的问题。
 */
export async function convertDocxToPdf(opts: ConvertDocxToPdfOptions): Promise<Buffer> {
  const { sourceUrl, timeoutMs = 120_000 } = opts;
  const deadline = Date.now() + timeoutMs;

  // 源 docx 本体：标题提取需要它，内容哈希顺便做 ConvertService 的 cacheKey
  //（内容寻址，同 key 撞旧缓存的问题不复存在）
  const docxResp = await axios.get(sourceUrl, {
    responseType: "arraybuffer",
    timeout: remainingMs(deadline),
    maxContentLength: DOCX_MAX_BYTES,
    maxBodyLength: DOCX_MAX_BYTES,
  });
  const docx = Buffer.from(docxResp.data);
  const cacheKey = crypto.createHash("sha256").update(docx).digest("hex").slice(0, 40);

  const [pdf, headings] = await Promise.all([
    onlyofficeConvertDocxToPdf({ sourceUrl, cacheKey, timeoutMs: remainingMs(deadline) }),
    extractDocxHeadings(docx),
  ]);

  if (headings.length === 0) {
    // 没用标题样式的文档本来就无章可跳，不算错误
    console.warn(
      `[docx-pdf] no headings found in source docx (${sourceUrl}), returning PDF without outline`
    );
    return pdf;
  }

  const { located, missing } = await locateHeadings(pdf, headings);
  if (located.length === 0) {
    // 有标题却一个都定位不到 = 匹配逻辑对这份文档失效，必须暴露而不是悄悄退回无书签 PDF
    throw new Error(
      `[docx-pdf] failed to locate any of ${headings.length} headings in converted PDF; ` +
        `first headings: ${headings
          .slice(0, 3)
          .map((h) => JSON.stringify(h.text))
          .join(", ")}`
    );
  }
  if (missing.length > 0) {
    console.warn(
      `[docx-pdf] located ${located.length}/${headings.length} headings; missing: ${missing
        .slice(0, 5)
        .map((t) => JSON.stringify(t))
        .join(", ")}${missing.length > 5 ? ` …(+${missing.length - 5})` : ""}`
    );
  }

  return injectPdfOutline(pdf, located);
}
