import jwt from "jsonwebtoken";
import axios from "axios";
import pool from "@/lib/db";
import { ossClient } from "@/lib/ossClient";
import { getLatestVersion, ensureVersionPdf } from "@/lib/documentFileVersions";
import { stripDocxExtension } from "@/lib/mimeTypes";
import { getTenantIdByCompanyCode, getDatasetIdByCompanyCode } from "@/lib/tenantMapping";
import { getKbSync, putKbSync } from "@/lib/znKbSyncClient";

const EXTERNAL_API_BASE_URL = process.env.EXTERNAL_API_BASE_URL || "http://localhost:8010";
const JWT_SECRET = process.env.JWT_SECRET!;

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * OA 审批通过后自动把制度 PDF 推入 KB。1:1 映射存在 zn 的 process_doc_kb_sync：
 *   - 有映射 → /files/replace 同一 kb_file_id，引用稳定
 *   - 无映射 → /files/register 新文件 + 写入映射
 * 不依赖 filename 匹配，文档改名也能正确归位。
 */
export async function uploadApprovedDocToKnowledgeBase(params: {
  documentId: string;
  documentName: string;
  companyCode: string;
}): Promise<void> {
  const { documentId, documentName, companyCode } = params;
  const tag = `[KB AutoUpload doc=${documentId}]`;

  const datasetId = getDatasetIdByCompanyCode(companyCode);
  if (!datasetId) {
    throw new Error(
      `${tag} No dataset mapping for company_code="${companyCode}". Check ZN_KB_DATASET_MAP env.`
    );
  }

  const pdfFilename = documentName.endsWith(".pdf")
    ? documentName
    : `${stripDocxExtension(documentName)}.pdf`;

  const [version, systemUserId, mapping] = await Promise.all([
    getLatestVersion(documentId),
    resolveSystemUserId(companyCode),
    getKbSync(documentId),
  ]);

  if (!version) {
    throw new Error(`${tag} No file version found`);
  }

  const pdfObjectKey = await ensureVersionPdf(documentId, version.version);
  const { url: downloadUrl } = await ossClient.sign({
    objectKey: pdfObjectKey,
    expiresIn: 3600,
  });

  const token = jwt.sign({ userId: systemUserId }, JWT_SECRET, {
    expiresIn: "5m",
  });
  const headers = {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  };

  const commonBody = {
    download_url: downloadUrl,
    object_key: pdfObjectKey,
    original_filename: pdfFilename,
    content_type: "application/pdf",
    size: 0,
  };

  let fileId: number;
  if (mapping) {
    fileId =
      (await postKbFilesApi(tag, "replace", headers, {
        file_id: mapping.kbFileId,
        ...commonBody,
      })) ?? mapping.kbFileId;
  } else {
    const newId = await postKbFilesApi(tag, "register", headers, {
      ...commonBody,
      dataset_id: datasetId,
      tags: "",
    });
    if (newId == null) {
      throw new Error(`${tag} files/register returned no file_id`);
    }
    fileId = newId;
  }

  console.log(`${tag} ${mapping ? "Replaced" : "Registered"} file_id=${fileId}`);

  // object_key 与 originalname 拆成两条 UPDATE：originalname 万一撞唯一/长度约束
  // 不能连累 object_key 一起回滚（否则 KB 还指向旧 PDF）。
  // 但失败必须可见——本地缓存与 KB 服务端 (commonBody.original_filename) 不一致会让
  // 前端列表显示旧文件名直到下次入库覆盖。所以两次失败都收集起来，确保 vectorization
  // 跑完后再抛给上游 (callback Promise.allSettled 会把它打成 step=uploadKB REJECTED)。
  const dbErrors: string[] = [];
  await Promise.all([
    putKbSync(documentId, fileId, datasetId),
    pool
      .query("UPDATE knowledge_files SET object_key = $1 WHERE id = $2", [pdfObjectKey, fileId])
      .catch((err: unknown) => {
        const msg = errorMessage(err);
        console.error(`${tag} Failed to update object_key:`, msg);
        dbErrors.push(`object_key=${msg}`);
      }),
    pool
      .query("UPDATE knowledge_files SET originalname = $1 WHERE id = $2", [pdfFilename, fileId])
      .catch((err: unknown) => {
        const msg = errorMessage(err);
        console.error(`${tag} Failed to update originalname:`, msg);
        dbErrors.push(`originalname=${msg}`);
      }),
  ]);

  try {
    await axios.post(
      `${EXTERNAL_API_BASE_URL}/api/v1/files/embed`,
      { file_ids: [fileId], force: true },
      { headers, timeout: 300_000 }
    );
    console.log(`${tag} Vectorization triggered for file ${fileId}`);
  } catch (err: unknown) {
    console.error(`${tag} Vectorization failed:`, errorMessage(err));
  }

  if (dbErrors.length > 0) {
    throw new Error(
      `${tag} knowledge_files metadata UPDATE failed for file_id=${fileId} pdfFilename=${JSON.stringify(pdfFilename)}: ${dbErrors.join("; ")}`
    );
  }
}

async function postKbFilesApi(
  tag: string,
  endpoint: "replace" | "register",
  headers: Record<string, string>,
  body: Record<string, unknown>
): Promise<number | undefined> {
  const resp = await axios.post(`${EXTERNAL_API_BASE_URL}/api/v1/files/${endpoint}`, body, {
    headers,
    timeout: 300_000,
  });
  if (!resp.data?.success) {
    throw new Error(`${tag} files/${endpoint} failed: ${resp.data?.error || resp.data?.message}`);
  }
  return resp.data.file_id;
}

const systemUserIdCache = new Map<string, number>();

async function resolveSystemUserId(companyCode: string): Promise<number> {
  const cached = systemUserIdCache.get(companyCode);
  if (cached != null) return cached;

  const tenantId = getTenantIdByCompanyCode(companyCode);
  if (tenantId == null) {
    throw new Error(
      `No tenant mapping for company_code="${companyCode}". Check ZN_TENANT_MAPPING env.`
    );
  }

  const { rows } = await pool.query(
    `SELECT u.id FROM users u
     JOIN user_roles ur ON u.id = ur.user_id
     JOIN roles r ON ur.role_id = r.id
     WHERE u.tenant_id = $1 AND r.name = '超级管理员'
     ORDER BY (u.username = 'admin') DESC, u.id ASC
     LIMIT 1`,
    [tenantId]
  );

  if (rows.length === 0) {
    throw new Error(`No admin user found for tenant_id=${tenantId} (company_code=${companyCode})`);
  }

  systemUserIdCache.set(companyCode, rows[0].id);
  return rows[0].id;
}
