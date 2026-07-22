import type { NextApiRequest, NextApiResponse } from "next";
import axios from "axios";
import {
  createVersion,
  ensureVersionPdf,
  getSignedUrl,
} from "@/lib/documentFileVersions";

/**
 * 内部端点：zn-process-management 的 submitReview() 在调用 docfuse
 * /prepare-for-review 之后立即调用本端点，把 prepared docx 固化为 ragent OSS
 * 的一个 pending_review 版本 + 转 PDF 缓存 + 返回签名 URL 供 E9 当作 OA 附件。
 *
 * OA 审核通过时 markVersionStatus(version, 'active')，入库该版本；
 * OA 审核驳回时 markVersionStatus(version, 'rejected')，最新 active 版本回落
 * 到上一版的 draft 快照，用户能在 OnlyOffice 里继续编辑。
 *
 * 依赖环境变量：
 *   ZN_INTERNAL_API_KEY  与 zn 侧 RAGENT_INTERNAL_API_KEY 同值，用 x-api-key 头传入
 */

const INTERNAL_API_KEY = process.env.ZN_INTERNAL_API_KEY;

/** 7 天，与 review.ts 保持一致 —— 与常见 S3/OSS 预签名 URL 最大 TTL 匹配。 */
const SIGNED_URL_TTL_SECONDS = 7 * 24 * 60 * 60;

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  if (req.method !== "POST") {
    res.setHeader("Allow", ["POST"]);
    return res.status(405).json({ detail: "Method not allowed" });
  }

  if (!INTERNAL_API_KEY) {
    console.error("ingest-prepared-pdf: ZN_INTERNAL_API_KEY 未配置");
    return res.status(500).json({ detail: "Server misconfigured" });
  }
  const apiKey = req.headers["x-api-key"];
  if (apiKey !== INTERNAL_API_KEY) {
    return res.status(401).json({ detail: "Invalid X-API-Key" });
  }

  const { id } = req.query;
  const docId = String(id);

  const { download_url: downloadUrl, filename } = req.body ?? {};
  if (!downloadUrl || typeof downloadUrl !== "string") {
    return res.status(400).json({ detail: "download_url is required" });
  }
  if (!filename || typeof filename !== "string") {
    return res.status(400).json({ detail: "filename is required" });
  }

  const tag = `[DIAG-review] ingest-prepared-pdf doc=${docId}`;
  try {
    // docfuse 的 download_url 对 ragent 宿主是 http://localhost:8010/static/...
    // Docker 里要走 host.docker.internal（与 oa-callback 同模式）
    const internalUrl = downloadUrl.replace(
      "://localhost",
      "://host.docker.internal",
    );
    console.log(
      `${tag} START fetching internalUrl=${internalUrl.slice(0, 200)} filename=${filename}`,
    );

    const fileResp = await axios.get(internalUrl, {
      responseType: "arraybuffer",
      timeout: 120_000,
    });
    const buffer = Buffer.from(fileResp.data);
    console.log(`${tag} fetched bytes=${buffer.length} status=${fileResp.status}`);

    const { version } = await createVersion(
      docId,
      buffer,
      "submit-review",
      { status: "pending_review" },
    );
    console.log(`${tag} createVersion(pending_review) OK v=${version}`);

    const pdfObjectKey = await ensureVersionPdf(docId, version);
    const pdfUrl = await getSignedUrl(pdfObjectKey, SIGNED_URL_TTL_SECONDS);
    const pdfFilename = filename.replace(/\.docx$/i, "") + ".pdf";

    console.log(
      `${tag} END v=${version} pdfFilename=${pdfFilename} pdfUrl=${pdfUrl.slice(0, 200)}`,
    );

    return res.status(200).json({
      version,
      pdf_url: pdfUrl,
      pdf_filename: pdfFilename,
    });
  } catch (err: any) {
    console.error(
      `${tag} FAILED name=${err?.name} msg=${err?.message} code=${err?.code}`,
    );
    return res
      .status(500)
      .json({ detail: `ingest-prepared-pdf failed: ${err?.message ?? "unknown"}` });
  }
}
