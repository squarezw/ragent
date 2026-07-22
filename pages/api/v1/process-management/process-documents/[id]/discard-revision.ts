import type { NextApiRequest, NextApiResponse } from "next";
import axios from "axios";
import { getUserIdFromRequest } from "@/lib/auth";
import { deleteDraft } from "@/lib/documentFileVersions";

const PROCESS_MGMT_BASE_URL = process.env.PROCESS_MGMT_BASE_URL || "http://localhost:8030";

/**
 * 放弃修订：先删本地 draft（document_drafts + OSS），再透传到 zn-process-management
 * 把 status 切回 approved 并清掉 pending 版本号。
 *
 * 先删草稿再切状态：如果第二步失败，用户还可以再次"放弃修改"兜底；如果顺序反过来，
 * 草稿会成为孤儿（已发布态存在 draft 语义上冲突）。
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const userId = getUserIdFromRequest(req);
  if (!userId) {
    return res.status(401).json({ detail: "Unauthorized" });
  }

  if (req.method !== "POST") {
    res.setHeader("Allow", ["POST"]);
    return res.status(405).json({ detail: "Method not allowed" });
  }

  const docId = String(req.query.id);

  await deleteDraft(docId);

  try {
    const response = await axios.post(
      `${PROCESS_MGMT_BASE_URL}/api/v1/process-documents/${docId}/discard-revision`,
      {},
      { headers: { "Content-Type": "application/json" } }
    );
    return res.status(200).json(response.data);
  } catch (error: any) {
    console.error(`process-document [${docId}] discard-revision error:`, error?.message);
    if (error.response) {
      return res
        .status(error.response.status)
        .json(error.response.data || { detail: "Request failed" });
    }
    return res.status(500).json({ detail: "Internal server error" });
  }
}
