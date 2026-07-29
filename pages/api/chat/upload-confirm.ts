import type { NextApiRequest, NextApiResponse } from "next";
import { getUserIdFromRequest } from "@/lib/auth";
import { ossClient } from "@/lib/ossClient";
import { logError } from "@/lib/logError";
import pdfParse from "pdf-parse";
import mammoth from "mammoth";
import textract from "textract";
import * as XLSX from "xlsx";
import axios from "axios";
import FormData from "form-data";

function cleanText(text: string): string {
  if (!text) return "";
  return text
    .replace(/\s+/g, " ")
    .replace(/\n\s*\n/g, "\n")
    .trim();
}

async function callOCRAPI(
  fileBuffer: Buffer,
  filename: string,
  mimetype: string,
  authToken: string
): Promise<string> {
  const EXTERNAL_API_BASE_URL = process.env.EXTERNAL_API_BASE_URL || "http://localhost:8010";

  if (!authToken) {
    throw new Error("Missing auth token for OCR API");
  }

  const formData = new FormData();
  formData.append("file", fileBuffer, { filename, contentType: mimetype });

  try {
    const response = await axios.post(`${EXTERNAL_API_BASE_URL}/api/v1/ocr`, formData, {
      headers: {
        ...formData.getHeaders(),
        Authorization: `Bearer ${authToken}`,
      },
      maxContentLength: Infinity,
      maxBodyLength: Infinity,
      timeout: 300000,
    });

    if (response.data.success && response.data.text) {
      return cleanText(response.data.text);
    }
    throw new Error("OCR failed: no valid text returned");
  } catch (error: any) {
    if (error.code === "ECONNRESET" || error.code === "ECONNREFUSED") {
      throw new Error(`OCR service connection failed: ${error.message}`);
    } else if (error.code === "ETIMEDOUT" || error.message?.includes("timeout")) {
      throw new Error(`OCR service timeout: ${error.message}`);
    } else if (error.response?.status) {
      const errorMessage =
        error.response?.data?.message || error.response?.data?.detail || error.message;
      throw new Error(`OCR service error (${error.response.status}): ${errorMessage}`);
    }
    throw new Error(`OCR failed: ${error.message || "unknown error"}`);
  }
}

async function extractContentFromBuffer(
  buffer: Buffer,
  filename: string,
  mimetype: string,
  authToken?: string
): Promise<{ content: string; type: string; filename: string }> {
  let extractedContent = "";
  let fileType = "";

  // .ai (Adobe Illustrator) 文件不做内容解析，直接返回
  if (filename.toLowerCase().endsWith(".ai")) {
    return { content: "", type: "AI", filename };
  }

  switch (mimetype) {
    case "application/pdf":
      try {
        const pdfData = await pdfParse(buffer);
        extractedContent = cleanText(pdfData.text);
        fileType = "PDF";
      } catch (e) {
        if (authToken) {
          try {
            extractedContent = await callOCRAPI(buffer, filename, mimetype, authToken);
            fileType = "PDF";
          } catch (ocrError: any) {
            throw new Error(`PDF parse failed, OCR also failed: ${ocrError.message}`);
          }
        } else {
          throw new Error("PDF parse failed");
        }
      }
      break;

    case "application/msword":
      try {
        const text = await new Promise<string>((resolve, reject) => {
          textract.fromBufferWithMime(
            mimetype,
            buffer,
            (error: Error | null, extractedText: string | undefined) => {
              if (error) reject(error);
              else resolve(extractedText || "");
            }
          );
        });
        extractedContent = cleanText(text);
        fileType = "Word";
      } catch (e) {
        throw new Error(".doc file parse failed");
      }
      break;

    case "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
      try {
        const result = await mammoth.extractRawText({ buffer });
        extractedContent = cleanText(result.value);
        fileType = "Word";
      } catch (e) {
        throw new Error("Word document parse failed");
      }
      break;

    case "application/vnd.ms-excel":
    case "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet":
      try {
        const workbook = XLSX.read(buffer, { type: "buffer" });
        let content = "";
        workbook.SheetNames.forEach((sheetName) => {
          const worksheet = workbook.Sheets[sheetName];
          const jsonData = XLSX.utils.sheet_to_json(worksheet, { header: 1 }) as unknown[];
          content += `Sheet: ${sheetName}\n`;
          jsonData.forEach((row) => {
            const cells = Array.isArray(row) ? row : [];
            content += `${cells.map((cell) => cell ?? "").join("\t")}\n`;
          });
          content += "\n";
        });
        extractedContent = cleanText(content);
        fileType = "Excel";
      } catch (e) {
        throw new Error("Excel file parse failed");
      }
      break;

    case "text/plain":
      try {
        extractedContent = cleanText(buffer.toString("utf-8"));
        fileType = "Text";
      } catch (e) {
        throw new Error("Text file parse failed");
      }
      break;

    default:
      throw new Error(
        "Unsupported file format. Supported: PDF, Word(.docx), Excel(.xlsx/.xls), Text"
      );
  }

  // 文字抽取为空 → 交给 OCR 兜底。
  //
  // 曾经只放 PDF 进这个分支，于是**整页截图粘进 Word 的 docx 直接失败**：mammoth
  // 拿不到文字（实测某 16 页保险材料的 document.xml 去标签后 0 字符，内容全在
  // word/media 的 16 张 PNG 里），用户看到的是 "No text content found in file"，
  // 而后端 /api/v1/ocr 本来就能识别它——只是没人送过去。
  //
  // 后端对 docx 是**逐页**识别并保留 `## 第 N 页` 标记的，所以走这条路拿到的文本
  // 带真实页码；这比 mammoth 那种整块无分页的文本更适合需要引用页码的下游。
  const OCR_FALLBACK_MIMETYPES = new Set([
    "application/pdf",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ]);
  if (
    (!extractedContent || extractedContent.trim().length === 0) &&
    OCR_FALLBACK_MIMETYPES.has(mimetype) &&
    authToken
  ) {
    try {
      extractedContent = await callOCRAPI(buffer, filename, mimetype, authToken);
    } catch (ocrError: any) {
      throw new Error(
        `${fileType || "File"} has no extractable text, OCR also failed: ${ocrError.message}`
      );
    }
  } else if (!extractedContent || extractedContent.trim().length === 0) {
    throw new Error("No text content found in file");
  }

  return { content: extractedContent, type: fileType, filename };
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const userId = getUserIdFromRequest(req);
  if (!userId) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const { objectKey, originalFilename, contentType } = req.body;

  if (!objectKey || !originalFilename || !contentType) {
    return res.status(400).json({ error: "Missing required fields" });
  }

  const authHeader = req.headers.authorization || "";
  const authToken = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";

  try {
    // Download file from OSS
    const { url } = await ossClient.sign({ objectKey });
    const response = await axios.get(url, { responseType: "arraybuffer", timeout: 300000 });
    const buffer = Buffer.from(response.data);

    // Extract content from buffer
    const extracted = await extractContentFromBuffer(
      buffer,
      originalFilename,
      contentType,
      authToken
    );

    return res.status(200).json({
      success: true,
      content: extracted.content,
      type: extracted.type,
      filename: extracted.filename,
      objectKey,
    });
  } catch (error: any) {
    console.error("[Chat Upload Confirm] Error:", error);
    logError(error);
    return res.status(400).json({ error: error.message || "File processing failed" });
  }
}
