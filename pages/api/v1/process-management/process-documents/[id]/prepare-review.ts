import type { NextApiRequest, NextApiResponse } from "next";
import axios from "axios";
import FormData from "form-data";
import pool from "@/lib/db";
import { getUserIdFromRequest } from "@/lib/auth";
import { getLatestVersion, getSignedUrl } from "@/lib/documentFileVersions";

const PROCESS_MGMT_BASE_URL = process.env.PROCESS_MGMT_BASE_URL || "http://localhost:8030";

/**
 * 提交审核对话框打开时调用，返回 AI 建议的"更新说明"。
 * 首次发布 / 无 draft / 无已固化版本 → 直接返回空，由用户自填。
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const userId = getUserIdFromRequest(req);
  if (!userId) return res.status(401).json({ detail: "Unauthorized" });

  if (req.method !== "POST") {
    res.setHeader("Allow", ["POST"]);
    return res.status(405).json({ detail: "Method not allowed" });
  }

  const docId = req.query.id as string;

  // 1. 拉 firstApprovedAt 判断是否首次发布
  const docResp = await axios.get(
    `${PROCESS_MGMT_BASE_URL}/api/v1/process-documents/${docId}`,
    { timeout: 10_000 },
  );
  const doc = docResp.data?.data ?? docResp.data;
  const firstApprovedAt: string | null = doc?.first_approved_at ?? null;

  if (!firstApprovedAt) {
    // 首次发布：没有 prev 可比；用源文件列表拼「由《A》《B》合并」作为默认值
    const sourceNames: string[] = Array.isArray(doc?.source_file_names)
      ? doc.source_file_names
      : [];
    const suggestedSummary =
      sourceNames.length > 0
        ? "由" + sourceNames.map((n) => `《${n}》`).join("、") + "合并"
        : "首次发布";
    return res.status(200).json({
      suggested_summary: suggestedSummary,
      reason: "first_publish",
    });
  }

  // 2. 取最新版本作为 prev；draft 必须是基于这个版本编辑的，才是"真正有效"的草稿
  const latest = await getLatestVersion(docId);
  if (!latest) {
    return res.status(200).json({ suggested_summary: "", reason: "no_prev_version" });
  }

  const { rows: draftRows } = await pool.query(
    "SELECT object_key FROM document_drafts WHERE document_id = $1 AND source_version = $2",
    [docId, latest.version],
  );
  if (draftRows.length === 0) {
    // 没有匹配最新版的 draft = OnlyOffice 尚未落盘（前端应先触发 forceSave），或确实没编辑
    return res.status(200).json({ suggested_summary: "", reason: "no_draft" });
  }

  // 3. 签 OSS URL
  const [prevUrl, currUrl] = await Promise.all([
    getSignedUrl(latest.objectKey),
    getSignedUrl(draftRows[0].object_key),
  ]);

  // 5. 转发到 zn /handbook/update（docfuse 跑 LLM 对比）
  const form = new FormData();
  form.append("prev_url", prevUrl);
  form.append("curr_url", currUrl);

  const compareResp = await axios.post(
    `${PROCESS_MGMT_BASE_URL}/api/v1/handbook/update`,
    form,
    {
      headers: form.getHeaders(),
      timeout: 120_000, // LLM 对比约 18s，放宽
    },
  );
  const result = compareResp.data?.data ?? compareResp.data;
  return res.status(200).json({
    suggested_summary: result.summary ?? "",
    has_changes: result.has_changes ?? false,
    reason: result.has_changes ? "compared" : "no_changes_detected",
  });
}
