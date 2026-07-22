import axios from "axios";
import pool from "@/lib/db";
import { ossClient } from "@/lib/ossClient";
import { convertDocxToPdf } from "@/lib/docxToPdf";

const DOCX_CONTENT_TYPE = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const PDF_CONTENT_TYPE = "application/pdf";

const PROCESS_MGMT_BASE_URL = process.env.PROCESS_MGMT_BASE_URL || "http://localhost:8030";
const EXTERNAL_API_BASE_URL = process.env.EXTERNAL_API_BASE_URL || "http://localhost:8010";

// 版本状态机：
//   active         正常版本（默认；promoteDraftToVersion / ensureLatestVersion bootstrap 创建）
//   pending_review ragent /ingest-prepared-pdf 落盘的 prepared docx，等待 OA 审核结果
//   active         OA 审核通过后由 markVersionStatus 置位
//   rejected       OA 审核驳回后由 markVersionStatus 置位，不参与 latest 查询
// 只有 active 版本被 getLatestVersion / ensureLatestVersion / saveDraft 的 stale 判断使用。
export type VersionStatus = "active" | "pending_review" | "rejected";
const ACTIVE_STATUS: VersionStatus = "active";

// ─── Auto-migration (lazy, once per process) ───

let ensured: Promise<void> | null = null;

function ensureOnce(): Promise<void> {
  if (!ensured) {
    ensured = pool
      .query(
        `
        CREATE TABLE IF NOT EXISTS document_file_versions (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          document_id UUID NOT NULL,
          version INTEGER NOT NULL DEFAULT 1,
          object_key VARCHAR(1000) NOT NULL,
          file_size BIGINT DEFAULT 0,
          created_by VARCHAR(100),
          created_at TIMESTAMPTZ DEFAULT NOW(),
          UNIQUE(document_id, version)
        );
        CREATE INDEX IF NOT EXISTS idx_dfv_document_id
          ON document_file_versions (document_id);
        CREATE INDEX IF NOT EXISTS idx_dfv_doc_version
          ON document_file_versions (document_id, version DESC);
        CREATE TABLE IF NOT EXISTS document_drafts (
          document_id UUID NOT NULL,
          object_key VARCHAR(1000) NOT NULL,
          file_size BIGINT DEFAULT 0,
          updated_at TIMESTAMPTZ DEFAULT NOW()
        );
        ALTER TABLE document_drafts ADD COLUMN IF NOT EXISTS source_version INTEGER;
        UPDATE document_drafts SET source_version = 0 WHERE source_version IS NULL;
        ALTER TABLE document_drafts ALTER COLUMN source_version SET NOT NULL;
        ALTER TABLE document_drafts DROP CONSTRAINT IF EXISTS document_drafts_pkey;
        DO $$ BEGIN
          IF NOT EXISTS (
            SELECT 1 FROM pg_constraint
            WHERE conname = 'document_drafts_pkey'
          ) THEN
            ALTER TABLE document_drafts ADD PRIMARY KEY (document_id, source_version);
          END IF;
        END $$;
        ALTER TABLE document_file_versions ADD COLUMN IF NOT EXISTS change_summary TEXT;
        ALTER TABLE document_file_versions ADD COLUMN IF NOT EXISTS pdf_object_key VARCHAR(1000);
        ALTER TABLE document_file_versions ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'active';
        DO $$ BEGIN
          IF NOT EXISTS (
            SELECT 1 FROM pg_constraint WHERE conname = 'document_file_versions_status_check'
          ) THEN
            ALTER TABLE document_file_versions ADD CONSTRAINT document_file_versions_status_check
              CHECK (status IN ('active', 'pending_review', 'rejected'));
          END IF;
        END $$;
        CREATE INDEX IF NOT EXISTS idx_dfv_doc_status_version
          ON document_file_versions (document_id, status, version DESC);
        `
      )
      .then(() => {});
  }
  return ensured;
}

// ─── Public API ───

export async function createVersion(
  documentId: string,
  buffer: Buffer,
  createdBy?: string,
  options?: { status?: VersionStatus }
): Promise<{ objectKey: string; version: number }> {
  await ensureOnce();

  // MAX(version) 不按 status 过滤：pending_review / rejected 也要占号，避免复用
  const { rows } = await pool.query(
    "SELECT COALESCE(MAX(version), 0) AS max_version FROM document_file_versions WHERE document_id = $1",
    [documentId]
  );
  const nextVersion: number = rows[0].max_version + 1;
  const status: VersionStatus = options?.status ?? ACTIVE_STATUS;

  const objectKey = await ossClient.upload({
    filename: `${documentId}_v${nextVersion}.docx`,
    content: new Uint8Array(buffer),
    contentType: DOCX_CONTENT_TYPE,
    category: "process-documents",
  });

  await pool.query(
    `INSERT INTO document_file_versions (document_id, version, object_key, file_size, created_by, status)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [documentId, nextVersion, objectKey, buffer.length, createdBy ?? null, status]
  );

  console.log(
    `[DIAG-review] createVersion doc=${documentId} v=${nextVersion} status=${status} bytes=${buffer.length} createdBy=${createdBy ?? "null"} objectKey=${objectKey}`
  );

  return { objectKey, version: nextVersion };
}

/** 幂等地把一个已存在版本的 status 切到目标值。未命中抛异常。 */
export async function markVersionStatus(
  documentId: string,
  version: number,
  status: VersionStatus
): Promise<void> {
  await ensureOnce();
  const { rowCount } = await pool.query(
    `UPDATE document_file_versions SET status = $3
     WHERE document_id = $1 AND version = $2`,
    [documentId, version, status]
  );
  if (rowCount === 0) {
    throw new Error(
      `markVersionStatus: no row for doc=${documentId} v=${version} (expected to exist)`
    );
  }
  console.log(`[DIAG-review] markVersionStatus doc=${documentId} v=${version} → ${status}`);
}

export interface FileVersion {
  id: string;
  version: number;
  objectKey: string;
  fileSize: number;
  createdAt: string;
}

export async function getLatestVersion(documentId: string): Promise<FileVersion | null> {
  await ensureOnce();

  // 只看 active：pending_review 是 OA 审核中还不能当"最新"，rejected 更不能
  const { rows } = await pool.query(
    `SELECT id, version, object_key, file_size, created_at
     FROM document_file_versions
     WHERE document_id = $1 AND status = 'active'
     ORDER BY version DESC
     LIMIT 1`,
    [documentId]
  );

  if (rows.length === 0) return null;

  const row = rows[0];
  return {
    id: row.id,
    version: row.version,
    objectKey: row.object_key,
    fileSize: row.file_size,
    createdAt: row.created_at,
  };
}

export async function getVersionByNumber(
  documentId: string,
  version: number
): Promise<FileVersion | null> {
  await ensureOnce();

  const { rows } = await pool.query(
    `SELECT id, version, object_key, file_size, created_at
     FROM document_file_versions
     WHERE document_id = $1 AND version = $2`,
    [documentId, version]
  );

  if (rows.length === 0) return null;

  const row = rows[0];
  return {
    id: row.id,
    version: row.version,
    objectKey: row.object_key,
    fileSize: row.file_size,
    createdAt: row.created_at,
  };
}

/** Update change_summary for a specific version record. */
export async function updateVersionSummary(
  documentId: string,
  version: number,
  changeSummary: string
): Promise<void> {
  await ensureOnce();
  await pool.query(
    `UPDATE document_file_versions SET change_summary = $3
     WHERE document_id = $1 AND version = $2`,
    [documentId, version, changeSummary]
  );
}

/** Return change summaries for versions created after `since` (or all if omitted). */
export async function getChangeSummariesSince(
  documentId: string,
  since?: string | null
): Promise<Array<{ version: number; changeSummary: string; createdAt: string }>> {
  await ensureOnce();

  const params: unknown[] = [documentId];
  let whereClause =
    "WHERE document_id = $1 AND change_summary IS NOT NULL AND change_summary != ''";

  if (since) {
    params.push(since);
    whereClause += ` AND created_at > $${params.length}`;
  }

  const { rows } = await pool.query(
    `SELECT version, change_summary, created_at
     FROM document_file_versions
     ${whereClause}
     ORDER BY version ASC`,
    params
  );

  return rows.map((row: any) => ({
    version: row.version,
    changeSummary: row.change_summary,
    createdAt: row.created_at,
  }));
}

export async function getSignedUrl(objectKey: string, expiresIn = 3600): Promise<string> {
  const { url } = await ossClient.sign({ objectKey, expiresIn });
  return url;
}

/**
 * 按版本缓存 PDF：命中返回缓存 key，未命中则转换→上传→条件性回写。
 * 并发调用由 `WHERE pdf_object_key IS NULL` 的条件 UPDATE 去重，败者的
 * OSS 对象异步清理。
 */
export async function ensureVersionPdf(documentId: string, version: number): Promise<string> {
  await ensureOnce();

  const { rows } = await pool.query(
    `SELECT object_key, pdf_object_key FROM document_file_versions
     WHERE document_id = $1 AND version = $2`,
    [documentId, version]
  );
  if (rows.length === 0) {
    throw new Error(`document_file_versions row missing for ${documentId} v${version}`);
  }
  if (rows[0].pdf_object_key) {
    return rows[0].pdf_object_key;
  }

  const docxObjectKey: string = rows[0].object_key;
  const sourceUrl = await getSignedUrl(docxObjectKey, 3600);
  const pdfBuffer = await convertDocxToPdf({ sourceUrl });

  const pdfObjectKey = await ossClient.upload({
    filename: `${documentId}_v${version}.pdf`,
    content: new Uint8Array(pdfBuffer),
    contentType: PDF_CONTENT_TYPE,
    category: "process-documents",
  });

  const { rows: updated } = await pool.query(
    `UPDATE document_file_versions SET pdf_object_key = $3
     WHERE document_id = $1 AND version = $2 AND pdf_object_key IS NULL
     RETURNING pdf_object_key`,
    [documentId, version, pdfObjectKey]
  );
  if (updated.length > 0) {
    return pdfObjectKey;
  }

  // 并发竞争输了：保留先到者的结果，丢弃自己上传的 PDF
  ossClient.delete({ objectKey: pdfObjectKey }).catch(() => {});
  const { rows: winner } = await pool.query(
    `SELECT pdf_object_key FROM document_file_versions
     WHERE document_id = $1 AND version = $2`,
    [documentId, version]
  );
  return winner[0].pdf_object_key;
}

/**
 * Return the latest OSS version for a document, bootstrapping from the upstream
 * source (handbook session or KB file) on first call. Throws if no source is known.
 */
export async function ensureLatestVersion(
  documentId: string,
  authHeader?: string
): Promise<Pick<FileVersion, "objectKey" | "version">> {
  const existing = await getLatestVersion(documentId);
  if (existing) return existing;

  const docResp = await axios.get(
    `${PROCESS_MGMT_BASE_URL}/api/v1/process-documents/${documentId}`
  );
  const filePath: string = docResp.data?.data?.file_path || "";
  if (!filePath) {
    throw new Error(`Document ${documentId} has no file source (empty file_path, no OSS version)`);
  }

  const handbookMatch = filePath.match(/handbook_([a-f0-9]+)\.docx$/);
  const kbMatch = filePath.match(/^kb_file_(.+)$/);

  let buffer: Buffer;
  if (handbookMatch) {
    const resp = await axios.get(
      `${PROCESS_MGMT_BASE_URL}/api/v1/handbook/download/${handbookMatch[1]}`,
      { responseType: "arraybuffer", timeout: 120000 }
    );
    buffer = Buffer.from(resp.data);
  } else if (kbMatch) {
    const headers: Record<string, string> = {};
    if (authHeader) headers.Authorization = authHeader;
    const resp = await axios.get(`${EXTERNAL_API_BASE_URL}/api/v1/files/${kbMatch[1]}/download`, {
      headers,
      responseType: "arraybuffer",
      timeout: 120000,
    });
    buffer = Buffer.from(resp.data);
  } else {
    throw new Error(`Document ${documentId} has unrecognized file_path: ${filePath}`);
  }

  return createVersion(documentId, buffer);
}

export async function downloadLatest(documentId: string): Promise<Buffer | null> {
  const version = await getLatestVersion(documentId);
  if (!version) return null;

  const arrayBuffer = await ossClient.download(version.objectKey);
  return Buffer.from(arrayBuffer);
}

// ─── Draft (auto-save, version-scoped) ───
// draft 按 (document_id, source_version) 绑定：延迟到达的 OnlyOffice 保存只会落到
// 它自己的旧 source_version slot，永远不会污染最新版的编辑；读路径也只认 latest 对应的 draft。

/** Latest committed ACTIVE version number, 0 if none.
 *
 * 只看 active：draft 写入/读取都要以 active 版为 source_version 基准，不能被
 * pending_review / rejected 污染。
 */
async function getLatestVersionNumber(documentId: string): Promise<number> {
  const { rows } = await pool.query<{ version: number }>(
    "SELECT COALESCE(MAX(version), 0) AS version FROM document_file_versions WHERE document_id = $1 AND status = 'active'",
    [documentId]
  );
  return rows[0]?.version ?? 0;
}

/**
 * Save/overwrite draft — called by OnlyOffice auto-save callback.
 * 拒绝来自已过期 session 的写入（sourceVersion < 最新版）—— 这是 stale save
 * 污染最新版的根本来源。返回 null 表示被拒绝。
 */
export async function saveDraft(
  documentId: string,
  sourceVersion: number,
  buffer: Buffer
): Promise<string | null> {
  await ensureOnce();

  const latest = await getLatestVersionNumber(documentId);
  if (sourceVersion < latest) {
    console.warn(
      `[saveDraft] REJECT stale draft doc=${documentId} sourceVersion=${sourceVersion} latest=${latest} bytes=${buffer.length}`
    );
    return null;
  }

  const { rows: old } = await pool.query<{ object_key: string }>(
    "SELECT object_key FROM document_drafts WHERE document_id = $1 AND source_version = $2",
    [documentId, sourceVersion]
  );

  const objectKey = await ossClient.upload({
    filename: `${documentId}_v${sourceVersion}_draft.docx`,
    content: new Uint8Array(buffer),
    contentType: DOCX_CONTENT_TYPE,
    category: "process-documents",
  });

  await pool.query(
    `INSERT INTO document_drafts (document_id, source_version, object_key, file_size)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (document_id, source_version)
     DO UPDATE SET object_key = $3, file_size = $4, updated_at = NOW()`,
    [documentId, sourceVersion, objectKey, buffer.length]
  );

  for (const row of old) {
    if (row.object_key !== objectKey) {
      ossClient.delete({ objectKey: row.object_key }).catch(() => {});
    }
  }

  return objectKey;
}

/**
 * 提交审核前固化 draft：只认最新 version 对应的 draft，过期 session 的 draft 忽略。
 * 无 draft 返回 null，由调用方走 bootstrap。
 */
export async function promoteDraftToVersion(
  documentId: string,
  createdBy?: string
): Promise<{ objectKey: string; version: number } | null> {
  await ensureOnce();

  const latest = await getLatestVersionNumber(documentId);
  const { rows } = await pool.query<{ object_key: string }>(
    "SELECT object_key FROM document_drafts WHERE document_id = $1 AND source_version = $2",
    [documentId, latest]
  );
  if (rows.length === 0) {
    console.log(
      `[DIAG-review] promoteDraftToVersion doc=${documentId} NO_DRAFT@v${latest} (fall back to ensureLatestVersion)`
    );
    return null;
  }

  const draftObjectKey = rows[0].object_key;
  const ab = await ossClient.download(draftObjectKey);
  const buffer = Buffer.from(ab);
  console.log(
    `[DIAG-review] promoteDraftToVersion doc=${documentId} source=v${latest} draftKey=${draftObjectKey} bytes=${buffer.length}`
  );

  const result = await createVersion(documentId, buffer, createdBy);

  await pool.query("DELETE FROM document_drafts WHERE document_id = $1 AND source_version = $2", [
    documentId,
    latest,
  ]);
  ossClient.delete({ objectKey: draftObjectKey }).catch(() => {});

  return result;
}

/** Delete all drafts for the document (any source_version) + their OSS objects. */
export async function deleteDraft(documentId: string): Promise<void> {
  await ensureOnce();
  const { rows } = await pool.query<{ object_key: string }>(
    "DELETE FROM document_drafts WHERE document_id = $1 RETURNING object_key",
    [documentId]
  );
  for (const row of rows) {
    ossClient.delete({ objectKey: row.object_key }).catch(() => {});
  }
}

/** Latest-version-scoped draft updated_at; used by force-save barrier. */
export async function getDraftUpdatedAtForLatest(documentId: string): Promise<Date | null> {
  await ensureOnce();
  const latest = await getLatestVersionNumber(documentId);
  const { rows } = await pool.query<{ updated_at: Date }>(
    "SELECT updated_at FROM document_drafts WHERE document_id = $1 AND source_version = $2",
    [documentId, latest]
  );
  return rows[0]?.updated_at ?? null;
}

/** Whether a draft exists for the document at the latest version. */
export async function hasDraftForLatest(documentId: string): Promise<boolean> {
  await ensureOnce();
  const latest = await getLatestVersionNumber(documentId);
  const { rows } = await pool.query(
    "SELECT 1 FROM document_drafts WHERE document_id = $1 AND source_version = $2 LIMIT 1",
    [documentId, latest]
  );
  return rows.length > 0;
}

/**
 * Download current content: draft-for-latest-version if exists, else latest version itself.
 * Stale drafts (for earlier source_versions) are ignored — they can only have been written
 * by expired OnlyOffice sessions and are not editable content anymore.
 */
export async function downloadCurrent(documentId: string): Promise<Buffer | null> {
  await ensureOnce();

  const latest = await getLatestVersionNumber(documentId);
  const { rows: drafts } = await pool.query<{ object_key: string }>(
    "SELECT object_key FROM document_drafts WHERE document_id = $1 AND source_version = $2",
    [documentId, latest]
  );
  if (drafts.length > 0) {
    try {
      const ab = await ossClient.download(drafts[0].object_key);
      return Buffer.from(ab);
    } catch {
      // Draft object missing — fall through to version
    }
  }

  return downloadLatest(documentId);
}
