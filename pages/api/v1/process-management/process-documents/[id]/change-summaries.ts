import type { NextApiRequest, NextApiResponse } from "next";
import axios from "axios";
import { getUserIdFromRequest } from "@/lib/auth";
import { getChangeSummariesSince } from "@/lib/documentFileVersions";

const PROCESS_MGMT_BASE_URL = process.env.PROCESS_MGMT_BASE_URL || "http://localhost:8030";
const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY;
const DEEPSEEK_BASE_URL = process.env.DEEPSEEK_BASE_URL || "https://api.deepseek.com";

/**
 * GET /api/v1/process-management/process-documents/:id/change-summaries
 *
 * Returns aggregated change summaries since the last review (reviewed_at),
 * refined by LLM for readability.
 * Used to pre-populate the "更新说明" field in the submit-review dialog.
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const userId = getUserIdFromRequest(req);
  if (!userId) {
    return res.status(401).json({ detail: "Unauthorized" });
  }

  if (req.method !== "GET") {
    return res.status(405).json({ detail: "Method not allowed" });
  }

  const docId = req.query.id as string;

  // Fetch reviewed_at from backend document
  let reviewedAt: string | null = null;
  try {
    const resp = await axios.get(`${PROCESS_MGMT_BASE_URL}/api/v1/process-documents/${docId}`);
    const doc = resp.data.data ?? resp.data;
    reviewedAt = doc.reviewed_at ?? null;
  } catch {
    return res.status(200).json({ summaries: [], aggregated_text: "", since: null });
  }

  const summaries = await getChangeSummariesSince(docId, reviewedAt);

  if (summaries.length === 0) {
    return res.status(200).json({ summaries: [], aggregated_text: "", since: reviewedAt });
  }

  const rawText = summaries
    .map((s) => `v${s.version}: ${s.changeSummary}`)
    .join("\n");

  // Refine with LLM for readability
  const aggregatedText = await refineSummariesWithLLM(rawText);

  return res.status(200).json({
    summaries: summaries.map((s) => ({
      version: s.version,
      change_summary: s.changeSummary,
      created_at: s.createdAt,
    })),
    aggregated_text: aggregatedText,
    since: reviewedAt,
  });
}

async function refineSummariesWithLLM(rawSummaries: string): Promise<string> {
  if (!DEEPSEEK_API_KEY) {
    return rawSummaries;
  }

  try {
    const resp = await axios.post(
      `${DEEPSEEK_BASE_URL}/chat/completions`,
      {
        model: "deepseek-chat",
        messages: [
          {
            role: "system",
            content:
              "你是一个制度文件管理助手。用户会给你一份文档的多次版本更新摘要，请你整合为一段简洁、清晰的「更新说明」，用于提交审核时填写。" +
              "要求：1）合并重复/相近的改动；2）按逻辑分点列出，使用序号；3）语言正式简练；4）只输出整理后的更新说明，不要加任何前缀或解释。",
          },
          {
            role: "user",
            content: rawSummaries,
          },
        ],
        temperature: 0.3,
        max_tokens: 1024,
      },
      {
        headers: {
          Authorization: `Bearer ${DEEPSEEK_API_KEY}`,
          "Content-Type": "application/json",
        },
        timeout: 30_000,
      }
    );

    const content = resp.data?.choices?.[0]?.message?.content;
    return content?.trim() || rawSummaries;
  } catch {
    // LLM unavailable — fall back to raw concatenation
    return rawSummaries;
  }
}
