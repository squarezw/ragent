import axios from "axios";

const PROCESS_MGMT_BASE_URL =
  process.env.PROCESS_MGMT_BASE_URL || "http://localhost:8030";

export interface KbSyncRecord {
  documentId: string;
  kbFileId: number;
  datasetId: string;
  syncedAt: string;
}

interface KbSyncResponseRow {
  document_id: string;
  kb_file_id: number;
  dataset_id: string;
  synced_at: string;
}

function fromResponse(row: KbSyncResponseRow): KbSyncRecord {
  return {
    documentId: row.document_id,
    kbFileId: row.kb_file_id,
    datasetId: row.dataset_id,
    syncedAt: row.synced_at,
  };
}

export async function getKbSync(
  documentId: string,
): Promise<KbSyncRecord | null> {
  const resp = await axios.get<{ data: KbSyncResponseRow | null }>(
    `${PROCESS_MGMT_BASE_URL}/api/v1/process-documents/${documentId}/kb-sync`,
    { timeout: 10_000 },
  );
  return resp.data?.data ? fromResponse(resp.data.data) : null;
}

export async function putKbSync(
  documentId: string,
  kbFileId: number,
  datasetId: string,
): Promise<KbSyncRecord> {
  const resp = await axios.put<{ data: KbSyncResponseRow }>(
    `${PROCESS_MGMT_BASE_URL}/api/v1/process-documents/${documentId}/kb-sync`,
    { kb_file_id: kbFileId, dataset_id: datasetId },
    { timeout: 10_000 },
  );
  return fromResponse(resp.data.data);
}
