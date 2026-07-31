import type { NextApiRequest, NextApiResponse } from "next";
import { getUserIdFromRequest } from "@/lib/auth";
import { logError } from "@/lib/logError";

/**
 * POST /api/chat/upload-confirm —— 确认一次附件上传，返回元信息。
 *
 * **上传和抽取是两件事。** 这个端点只做前者：文件已由浏览器直传对象存储，这里确认并回
 * 一份元信息。文字由后端的 `extract_document_text` 工具按需取（普通抽取还是 OCR 由它
 * 内部判定）。
 *
 * 原先这里会把文件从 OSS 下载回来、按 MIME 分派 pdf-parse / mammoth / xlsx / textract，
 * 抽不到文字还调 OCR 服务兜底。那样耦合有三个实际代价：
 *
 * 1. **抽取失败等于上传失败。** default 分支对未知类型直接抛 "Unsupported file format"，
 *    抽不到文字抛 "No text content found in file"。图片因此长期无法作为聊天附件，
 *    整页截图粘成的 docx 也一样传不上来——不是不该支持，是这个耦合挡住了。
 * 2. **每次上传都付 OCR 的钱。** 一份 16 页扫描件要 9 秒，而用户的目的常常只是把文件
 *    交给 skill 处理，根本不需要平台先读一遍。
 * 3. **抽取结果绕模型一圈。** 文本经 `JSON.stringify` 进 system 消息时换行被转义成字面
 *    `\n`，模型转述给下游工具后分页标记全部失配（实测 16 页材料被当成 1 页，报告里
 *    所有位置都写"第1页"）。现在材料以文件形态直达 skill 的 `inputs/`，不穿过模型输出。
 *
 * 于是模型面对的规则也统一了：**附件就是文件，要读内容就调 extract_document_text**，
 * 而不是"有的附件自带内容、有的不带"，还得自己判断在哪种情形。
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const userId = getUserIdFromRequest(req);
  if (!userId) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const { objectKey, originalFilename, contentType } = req.body;

  if (!objectKey || !originalFilename) {
    return res.status(400).json({ error: "Missing required fields" });
  }

  try {
    return res.status(200).json({
      success: true,
      objectKey,
      filename: originalFilename,
      type: describeType(contentType, originalFilename),
      // 字段保持在位、值恒为空串：调用方不必分情况处理，而"内容此刻还没有"这件事
      // 由 content 为空表达。
      content: "",
    });
  } catch (error: any) {
    console.error("[Chat Upload Confirm] Error:", error);
    logError(error);
    return res.status(400).json({ error: error.message || "Upload confirm failed" });
  }
}

/** 给用户看的类型标签（附件气泡上显示），不参与任何分派逻辑。 */
function describeType(contentType: string | undefined, filename: string): string {
  const mime = (contentType || "").toLowerCase();
  const name = (filename || "").toLowerCase();

  if (mime.startsWith("image/")) return "Image";
  if (mime === "application/pdf" || name.endsWith(".pdf")) return "PDF";
  if (mime.includes("word") || name.endsWith(".docx") || name.endsWith(".doc")) return "Word";
  if (
    mime.includes("excel") ||
    mime.includes("spreadsheet") ||
    name.endsWith(".xlsx") ||
    name.endsWith(".xls")
  )
    return "Excel";
  if (mime === "text/csv" || name.endsWith(".csv")) return "CSV";
  if (mime.startsWith("text/") || name.endsWith(".txt") || name.endsWith(".md")) return "Text";
  if (mime === "application/postscript" || name.endsWith(".ai")) return "AI";
  return "File";
}
