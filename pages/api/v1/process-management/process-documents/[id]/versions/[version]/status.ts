import type { NextApiRequest, NextApiResponse } from "next";
import { markVersionStatus } from "@/lib/documentFileVersions";

/**
 * 内部端点：zn 在 E9 失败（OA 还未创建工单）/ingest 后 DB 写失败等回滚路径调
 * 本端点，把已入库的 pending_review 版本标成 rejected（不再污染 latest_active 查询 +
 * 审计可追踪）。
 *
 * 只接受 status="rejected"：
 *   - active 由 /zn-oa/callback 的 runApprovePostProcessing 内部直接调 markVersionStatus，
 *     不经由 HTTP 端点（攻击面最小化）。
 *   - pending_review 由 /ingest-prepared-pdf 的 createVersion 创建，不需要外部 flip。
 *
 * 依赖环境变量：
 *   ZN_INTERNAL_API_KEY  与 zn 侧 RAGENT_INTERNAL_API_KEY 同值
 */

const INTERNAL_API_KEY = process.env.ZN_INTERNAL_API_KEY;

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  if (req.method !== "PUT") {
    res.setHeader("Allow", ["PUT"]);
    return res.status(405).json({ detail: "Method not allowed" });
  }

  if (!INTERNAL_API_KEY) {
    console.error("mark version status: ZN_INTERNAL_API_KEY 未配置");
    return res.status(500).json({ detail: "Server misconfigured" });
  }
  if (req.headers["x-api-key"] !== INTERNAL_API_KEY) {
    return res.status(401).json({ detail: "Invalid X-API-Key" });
  }

  const { id, version } = req.query;
  const docId = String(id);
  const versionNum = Number(version);
  if (!Number.isInteger(versionNum) || versionNum <= 0) {
    return res.status(400).json({ detail: "version must be positive integer" });
  }

  const { status } = req.body ?? {};
  if (status !== "rejected") {
    return res
      .status(400)
      .json({ detail: "status must be 'rejected' (only supported value)" });
  }

  try {
    await markVersionStatus(docId, versionNum, "rejected");
    return res.status(200).json({ document_id: docId, version: versionNum, status });
  } catch (err: any) {
    console.error(
      `[DIAG-review] mark-status doc=${docId} v=${versionNum} status=rejected FAILED msg=${err?.message}`,
    );
    return res
      .status(500)
      .json({ detail: `mark-version-status failed: ${err?.message ?? "unknown"}` });
  }
}
