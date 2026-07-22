import type { NextApiRequest, NextApiResponse } from "next";
import axios from "axios";
import { getUserIdFromRequest } from "@/lib/auth";
import { getUserTenantId, getOaUserIdByTenantId } from "@/lib/tenantMapping";
import {
  ensureLatestVersion,
  getSignedUrl,
  promoteDraftToVersion,
} from "@/lib/documentFileVersions";

const PROCESS_MGMT_BASE_URL = process.env.PROCESS_MGMT_BASE_URL || "http://localhost:8030";

/** 7 days — matches the maximum presigned URL TTL supported by common S3/OSS gateways. */
const DOCX_URL_TTL_SECONDS = 7 * 24 * 60 * 60;

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const userId = getUserIdFromRequest(req);
  if (!userId) {
    return res.status(401).json({ detail: "Unauthorized" });
  }

  if (req.method !== "POST") {
    res.setHeader("Allow", ["POST"]);
    return res.status(405).json({ detail: "Method not allowed" });
  }

  const { id } = req.query;
  const docId = String(id);

  // file_name / attachment 字段不再往 zn 传：zn 的 submitReview 会在 docfuse
  // prepare-for-review 之后调 ragent /ingest-prepared-pdf 基于 prepared docx
  // 自行生成 PDF 附件（不变量：OA 附件 ≡ 审核通过后入库的版本）。
  const { file_name: _ignoredFileName, attachment: _ignoredAttachment, ...rest } = req.body ?? {};

  try {
    console.log(
      `[DIAG-review] review.ts start doc=${docId} userId=${userId} bodyKeys=${Object.keys(
        rest,
      ).join(",")}`,
    );
    // 先把 draft 固化成 version，让 docfuse prepare-for-review 能拉到用户最新编辑。
    const [promoted, tenantId] = await Promise.all([
      promoteDraftToVersion(docId, `user:${userId}`),
      getUserTenantId(userId),
    ]);
    const version = promoted ?? (await ensureLatestVersion(docId, req.headers.authorization));
    console.log(
      `[DIAG-review] review.ts doc=${docId} promoted=${promoted ? "YES" : "NO"} finalVersion=v${version.version} objectKey=${version.objectKey}`,
    );

    // 仅签 docx URL 给 docfuse 作加盖的输入源；PDF 由 zn 在 prepare-for-review
    // 之后通过 ragent /ingest-prepared-pdf 生成。
    const docxUrl = await getSignedUrl(version.objectKey, DOCX_URL_TTL_SECONDS);
    const oaUserId = tenantId ? getOaUserIdByTenantId(tenantId) : undefined;

    console.log(
      `[DIAG-review] review.ts doc=${docId} docxUrl=${docxUrl.slice(0, 200)}... oaUserId=${oaUserId ?? "n/a"}`,
    );

    const body = {
      ...rest,
      ...(oaUserId ? { oa_userid: oaUserId } : {}),
      docx_url: docxUrl,
    };

    const response = await axios.post(
      `${PROCESS_MGMT_BASE_URL}/api/v1/process-documents/${docId}/review`,
      body,
      {
        headers: { "Content-Type": "application/json" },
        // 与 zn Bun.serve idleTimeout=255s 对齐。
        timeout: 255_000,
      },
    );
    console.log(
      `[DIAG-review] review.ts doc=${docId} zn-response status=${response.status} oa_request_id=${response.data?.oa_request_id ?? response.data?.data?.oa_request_id ?? "n/a"}`,
    );
    return res.status(200).json(response.data);
  } catch (error: any) {
    console.error(`process-document [${docId}] review error:`, error?.message);
    if (error.response) {
      return res
        .status(error.response.status)
        .json(error.response.data || { detail: "Request failed" });
    }
    return res.status(500).json({ detail: "Internal server error" });
  }
}
