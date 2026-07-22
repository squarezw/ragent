import type { NextApiRequest, NextApiResponse } from "next";
import axios from "axios";
import { uploadApprovedDocToKnowledgeBase } from "@/lib/knowledgeAutoUpload";
import {
  deleteDraft,
  markVersionStatus,
  updateVersionSummary,
} from "@/lib/documentFileVersions";

const PROCESS_MGMT_BASE_URL =
  process.env.PROCESS_MGMT_BASE_URL || "http://localhost:8030";

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  if (req.method !== "PUT") {
    res.setHeader("Allow", ["PUT"]);
    return res.status(405).json({ detail: "Method not allowed" });
  }

  const apiKey = req.headers["x-api-key"];
  if (!apiKey) {
    return res.status(401).json({ detail: "Missing X-API-Key header" });
  }

  const { oa_request_id } = req.query;

  try {
    console.log(
      `[DIAG-review] oa-callback proxy enter oa_request_id=${oa_request_id} body=${JSON.stringify(req.body)}`,
    );
    const response = await axios.put(
      `${PROCESS_MGMT_BASE_URL}/api/v1/oa/callback/${oa_request_id}`,
      req.body,
      {
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        validateStatus: () => true,
      },
    );

    // Strip internal fields before returning to OA caller
    const {
      document_id,
      document_name,
      company_code,
      already_processed,
      consumed_change_summary,
      download_url,
      file_path,
      approved_name,
      approved_version_number,
      rejected_version_number,
      ...safeData
    } = response.data ?? {};
    console.log(
      `[DIAG-review] oa-callback zn status=${response.status} state=${response.data?.state} doc=${document_id} already_processed=${already_processed} approved_version=${approved_version_number ?? "null"} rejected_version=${rejected_version_number ?? "null"} consumed_change_summary=${JSON.stringify(consumed_change_summary ?? "")} file_path=${file_path ?? "n/a"}`,
    );
    res.status(response.status).json(safeData);

    // Async post-processing: 根据 state 分派
    if (response.status === 200 && !already_processed && document_id) {
      if (response.data?.state === "approval" && approved_version_number != null) {
        console.log(
          `[DIAG-review] oa-callback dispatching runApprovePostProcessing doc=${document_id} v=${approved_version_number}`,
        );
        runApprovePostProcessing({
          documentId: document_id,
          documentName: approved_name,
          companyCode: company_code,
          approvedVersionNumber: approved_version_number,
          consumedChangeSummary: consumed_change_summary,
        }).catch((err) => {
          console.error(
            `[DIAG-review] oa-callback approve post-processing FAILED doc=${document_id} name=${err?.name} msg=${err?.message} code=${err?.code} stack=${err?.stack}`,
          );
        });
      } else if (
        response.data?.state === "reject" &&
        rejected_version_number != null
      ) {
        console.log(
          `[DIAG-review] oa-callback dispatching runRejectPostProcessing doc=${document_id} v=${rejected_version_number}`,
        );
        runRejectPostProcessing({
          documentId: document_id,
          rejectedVersionNumber: rejected_version_number,
        }).catch((err) => {
          console.error(
            `[DIAG-review] oa-callback reject post-processing FAILED doc=${document_id} name=${err?.name} msg=${err?.message} code=${err?.code} stack=${err?.stack}`,
          );
        });
      } else {
        console.log(
          `[DIAG-review] oa-callback NOT dispatching post-processing (status=${response.status} state=${response.data?.state} already_processed=${already_processed} approved_version=${approved_version_number ?? "null"} rejected_version=${rejected_version_number ?? "null"} doc=${document_id})`,
        );
      }
    }
  } catch (error: any) {
    console.error(`oa callback [${oa_request_id}] proxy error:`, error);
    if (error.response) {
      return res
        .status(error.response.status)
        .json(error.response.data || { detail: "Request failed" });
    }
    return res.status(502).json({ detail: "Upstream service unavailable" });
  }
}

/**
 * 审核通过的 ragent 侧后置处理（异步）：
 *
 * Step 1（同步，必须成功）：markVersionStatus(approvedVersion, 'active')
 *   —— 让 ensureLatestVersion 开始看到这个版本。失败则 **throw 中断**，
 *   **不再执行后续步骤**，避免出现 "KB 已前进但 OSS latest 还停在旧版" 的漂移。
 *
 * Step 2（并行 + allSettled，可失败）：
 *   - updateVersionSummary：记录变更说明（本地 UPDATE，失败只影响元数据）
 *   - deleteDraft：清理 OnlyOffice 草稿（失败只影响编辑器残留）
 *   - uploadApprovedDocToKnowledgeBase：KB 同步（失败由 KB 侧重试机制兜底）
 *
 * 注：不再 createVersion —— prepared docx 在 submitReview 阶段由 ragent
 * /ingest-prepared-pdf 落盘为 pending_review；这里只需切到 active。
 */
async function runApprovePostProcessing(params: {
  documentId: string;
  documentName: string;
  companyCode: string;
  approvedVersionNumber: number;
  consumedChangeSummary: string | null;
}): Promise<void> {
  const {
    documentId,
    documentName,
    companyCode,
    approvedVersionNumber,
    consumedChangeSummary,
  } = params;
  const tag = `[DIAG-review] approve-post doc=${documentId} v=${approvedVersionNumber}`;
  const summaryTrimmed = consumedChangeSummary?.trim();
  console.log(
    `${tag} START summary=${!!summaryTrimmed} consumedChangeSummary=${JSON.stringify(consumedChangeSummary ?? "")}`,
  );

  // Step 1: 必须先成功。失败则抛，阻断 KB 上传，防止 KB-vs-OSS 漂移。
  await markVersionStatus(documentId, approvedVersionNumber, "active");
  console.log(`${tag} step=markVersionStatus ok`);

  // Step 2: 其余三步可独立失败，不互阻断。
  const results = await Promise.allSettled([
    summaryTrimmed
      ? updateVersionSummary(documentId, approvedVersionNumber, summaryTrimmed)
      : Promise.resolve(),
    deleteDraft(documentId),
    uploadApprovedDocToKnowledgeBase({
      documentId,
      documentName,
      companyCode,
    }),
  ]);
  const steps = ["updateVersionSummary", "deleteDraft", "uploadKB"];
  results.forEach((r, idx) => {
    if (r.status === "rejected") {
      console.error(
        `${tag} step=${steps[idx]} REJECTED reason=${(r.reason as any)?.message ?? r.reason}`,
      );
    } else {
      console.log(`${tag} step=${steps[idx]} ok`);
    }
  });
  const failed = results.filter((r) => r.status === "rejected").length;
  console.log(`${tag} END failed=${failed}/${results.length}`);
}

/**
 * 审核驳回的 ragent 侧后置处理（异步）：
 *   1. markVersionStatus(rejectedVersion, 'rejected') —— 让 ensureLatestVersion 回落到
 *      用户提交审核前的 draft 快照（上一个 active 版本），用户打开 OnlyOffice 可以
 *      在自己的编辑状态上继续改。
 *
 * 不清 draft —— 用户可能想从编辑状态继续。
 */
async function runRejectPostProcessing(params: {
  documentId: string;
  rejectedVersionNumber: number;
}): Promise<void> {
  const { documentId, rejectedVersionNumber } = params;
  const tag = `[DIAG-review] reject-post doc=${documentId} v=${rejectedVersionNumber}`;
  console.log(`${tag} START`);
  await markVersionStatus(documentId, rejectedVersionNumber, "rejected");
  console.log(`${tag} END markVersionStatus(rejected) OK`);
}
