import axios from "@/lib/axios";
import { AxiosError } from "axios";
import type {
  ProcessNode,
  BackendProcessNode,
  BackendDocument,
  RelatedDoc,
} from "../types/process";

const BASE = "/api/v1/process-management";

// ─── Type Mappers ───

function mapBackendNodeToFrontend(node: BackendProcessNode): ProcessNode {
  return {
    id: node.id,
    name: node.name,
    level: node.level,
    type: node.level === 0 ? "category" : undefined,
    desc: node.description || undefined,
    role: node.responsible_role || undefined,
    org: node.involved_orgs || undefined,
    owner: node.owner || undefined,
    docs: node.document_count > 0 ? `${node.document_count} 份关联文件` : undefined,
    updated: node.updated_at || node.created_at,
    children: (node.children || []).map(mapBackendNodeToFrontend),
    parent_id: node.parent_id,
    company_code: node.company_code,
    category: node.category,
    sort_order: node.sort_order,
    document_count: node.document_count,
  };
}

function mapBackendDocToRelatedDoc(doc: BackendDocument): RelatedDoc {
  return {
    id: doc.id,
    name: doc.name,
    aiSummary: doc.ai_summary || "",
    nodeId: doc.node_id,
    dept: doc.department || "",
    status: doc.status,
    owner: doc.created_by_name || doc.created_by || "",
    createdAt: doc.created_at,
    docNumber: doc.doc_number || "",
    sessionId: doc.session_id || undefined,
    filePath: doc.file_path || undefined,
    createdBy: doc.created_by || undefined,
  };
}

// ─── Process Tree ───

export async function fetchProcessTree(companyCode?: string): Promise<ProcessNode[]> {
  const params: Record<string, string> = {};
  if (companyCode) params.company_code = companyCode;

  const resp = await axios.get(`${BASE}/process-tree`, { params });
  const nodes: BackendProcessNode[] = resp.data.data ?? resp.data;
  return nodes.map(mapBackendNodeToFrontend);
}

export async function importProcessTree(
  file: File,
  options?: { replace?: boolean; companyCode?: string }
): Promise<{ import_log_id: string; node_count: Record<string, number> }> {
  const formData = new FormData();
  formData.append("file", file);
  if (options?.replace) formData.append("replace", "true");
  if (options?.companyCode) formData.append("company_code", options.companyCode);

  const resp = await axios.post(`${BASE}/process-tree`, formData, {
    headers: { "Content-Type": "multipart/form-data" },
  });
  return resp.data.data ?? resp.data;
}

export async function exportProcessTree(
  companyCode?: string,
  format: "json" | "xlsx" = "xlsx"
): Promise<Blob | ProcessNode[]> {
  const params: Record<string, string> = { format };
  if (companyCode) params.company_code = companyCode;

  if (format === "xlsx") {
    const resp = await axios.get(`${BASE}/process-tree`, {
      params,
      responseType: "blob",
    });
    return resp.data;
  }
  const resp = await axios.get(`${BASE}/process-tree`, { params });
  return resp.data.data ?? resp.data;
}

// ─── Node CRUD ───

export async function fetchNode(id: string): Promise<ProcessNode> {
  const resp = await axios.get(`${BASE}/process-nodes/${id}`);
  const node: BackendProcessNode = resp.data.data ?? resp.data;
  return mapBackendNodeToFrontend(node);
}

export async function createNode(payload: {
  parent_id: string;
  company_code: string;
  name: string;
  level?: number;
  description?: string;
  owner?: string;
  responsible_role?: string;
  involved_orgs?: string;
  sort_order?: number;
}): Promise<ProcessNode> {
  const resp = await axios.post(`${BASE}/process-nodes`, payload);
  const node: BackendProcessNode = resp.data.data ?? resp.data;
  return mapBackendNodeToFrontend(node);
}

export async function updateNode(
  id: string,
  updates: Partial<{
    name: string;
    description: string;
    owner: string;
    responsible_role: string;
    involved_orgs: string;
    sort_order: number;
  }>
): Promise<ProcessNode> {
  const resp = await axios.put(`${BASE}/process-nodes/${id}`, updates);
  const node: BackendProcessNode = resp.data.data ?? resp.data;
  return mapBackendNodeToFrontend(node);
}

export async function deleteNode(id: string): Promise<void> {
  await axios.delete(`${BASE}/process-nodes/${id}`);
}

// ─── Documents ───

export async function fetchNodeDocuments(
  nodeId: string,
  params?: { page?: number; page_size?: number; status?: string }
): Promise<{ data: RelatedDoc[]; total: number }> {
  const resp = await axios.get(`${BASE}/process-nodes/${nodeId}/documents`, {
    params,
  });
  const body = resp.data;
  const docs: BackendDocument[] = body.data ?? [];
  return {
    data: docs.map(mapBackendDocToRelatedDoc),
    total: body.total ?? docs.length,
  };
}

export async function fetchDocument(
  docId: string,
  options?: { signal?: AbortSignal }
): Promise<BackendDocument> {
  const resp = await axios.get(`${BASE}/process-documents/${docId}`, {
    signal: options?.signal,
  });
  return resp.data.data ?? resp.data;
}

export async function createDocument(payload: {
  node_id: string;
  name: string;
  doc_number?: string;
  department?: string;
  owner?: string;
  content?: string;
  file_path?: string;
}): Promise<BackendDocument> {
  const resp = await axios.post(`${BASE}/process-documents`, payload);
  return resp.data.data ?? resp.data;
}

/** Copy a knowledge-base file into process-document OSS storage (v1) */
export async function copyKnowledgeFileToDoc(
  docId: string,
  kbFileId: string
): Promise<{ ok: boolean; version: number; skipped?: boolean }> {
  const resp = await axios.post(`${BASE}/process-documents/${docId}/file`, null, {
    params: { from_knowledge_file: kbFileId },
  });
  return resp.data;
}

export async function updateDocument(
  id: string,
  updates: Partial<{
    name: string;
    doc_number: string;
    department: string;
    owner: string;
    content: string;
  }>
): Promise<BackendDocument> {
  const resp = await axios.put(`${BASE}/process-documents/${id}`, updates);
  return resp.data.data ?? resp.data;
}

export async function deleteDocument(id: string): Promise<void> {
  await axios.delete(`${BASE}/process-documents/${id}`);
}

export async function updateDocumentStatus(docId: string, status: string): Promise<void> {
  await axios.put(`${BASE}/process-documents/${docId}/status`, { status });
}

/** 把文件关联到另一个节点（L1/L2/L3 任意层级） */
export async function moveDocument(
  docId: string,
  targetNodeId: string
): Promise<BackendDocument> {
  const resp = await axios.post(`${BASE}/process-documents/${docId}/move`, {
    target_node_id: targetNodeId,
  });
  return resp.data.data ?? resp.data;
}

export async function submitDocumentReview(
  docId: string,
  payload: {
    doc_number: string;
    file_name: string;
    update_description?: string;
    oa_userid?: string;
  }
): Promise<void> {
  await axios.post(`${BASE}/process-documents/${docId}/review`, payload);
}

/** 已发布 → 修订中：在打开 OnlyOffice 编辑器之前调用 */
export async function startDocumentRevision(docId: string): Promise<void> {
  await axios.post(`${BASE}/process-documents/${docId}/new-revision`);
}

/** 修订中 → 已发布：放弃本轮修改（删除 draft + 清 pending 版本号） */
export async function discardDocumentRevision(docId: string): Promise<void> {
  await axios.post(`${BASE}/process-documents/${docId}/discard-revision`);
}

// ─── Handbook DOCX → HTML ───

export async function fetchHandbookDocHtml(sessionId: string): Promise<string> {
  const resp = await axios.get(`${BASE}/handbook/convert`, {
    params: { session_id: sessionId },
  });
  return resp.data.html;
}

// ─── Handbook Analyze / Generate ───

export interface HandbookAnalyzeRequest {
  node_id: string;
  /** Knowledge file IDs — used to resolve download URLs server-side */
  source_file_ids: string[];
  /** OSS object keys — fallback, signed server-side by the proxy */
  source_file_keys: string[];
  /** 原始文件名，按 source_file_ids/source_file_keys 顺序对齐（proxy 也会补充 DB 里的 originalname） */
  source_file_names?: string[];
  company_code: string;
  /** L3 node ID where merge was initiated */
  source_node_id?: string;
  /** 文件编制部门（必填）：当前登录用户的所属部门（从 useCurrentUser().user.dept_name 读取）。
   *  docfuse-agent 不再从流程架构反推，缺失或空串会 400。 */
  authoring_dept: string;
  management_doc_name?: string;
  l1_owner_name?: string;
}

export interface ChapterConflictCandidate {
  candidate_id: string;
  source_file: string;
  text: string;
  char_count: number;
}

export interface ChapterConflict {
  chapter: number;
  chapter_name: string;
  candidates: ChapterConflictCandidate[];
  merged_text: string;
}

export interface L3FlowSource {
  source_file: string;
  description_rows: DescriptionRow[];
  interface_rows: Array<Record<string, string>>;
}

export interface L3FlowConflict {
  conflict_id: string;
  l3_code: string;
  l3_name: string;
  severity: string;
  sources: L3FlowSource[];
}

export interface AppendixDedupGroup {
  group_id: string;
  appendix_indices?: number[];
  reason: string;
}

export interface AppendixIndexItem {
  title?: string;
  html?: string;
  text?: string;
  source_file?: string;
}

interface AuxBlockItem extends AppendixIndexItem {
  block_type: "table" | "list" | "image";
  image_path?: string;
  source_page?: number;
}

export interface KeyMgmtItem extends AuxBlockItem {
  associated_step?: string;
}

export interface RelatedAppendix extends AuxBlockItem {
  source_heading?: string;
}

export interface AnalyzeSourceDocument {
  file_name: string;
  file_path: string;
  preview_html?: string;
  blocks?: Array<{
    block_id?: string;
    type: string;
    text?: string;
    html?: string;
    heading_level?: number;
  }>;
}

export interface QualityMetrics {
  structure_completeness: number;
  l2_found: number;
  l2_expected: number;
  l3_found: number;
  l3_expected: number;
  l3_with_description: number;
  l3_with_interface: number;
  source_file_count: number;
  ch1_has_content?: boolean;
  ch1_conflict?: boolean;
  ch2_has_content?: boolean;
  ch2_conflict?: boolean;
  ch3_has_content?: boolean;
  ch3_conflict?: boolean;
  appendix_count?: number;
  appendix_dedup_groups?: number;
}

export interface DescriptionRow {
  l4: string;
  step: string;
  content: string;
  department?: string;
  position?: string;
  input_?: string;
  input?: string;
  output?: string;
  source_file?: string;
  source_block_ids?: string[];
}

export interface L3Section {
  l3_code: string;
  l3_name: string;
  source_file?: string;
  description_table: DescriptionRow[];
  interface_table: Array<Record<string, string>>;
}

export interface L2Chapter {
  l2_code: string;
  l2_name: string;
  arch_diagram_path?: string;
  l3_sections: L3Section[];
}

export interface RoleDuty {
  position: string;
  duties: string[];
  source_files?: string[];
}

export interface HandbookAnalyzeResult {
  session_id: string;
  status: "queued" | "pending" | "running" | "completed" | "failed";
  cover?: {
    l1_name: string;
    /** 本次生成范围节点名（L1/L2/L3）。L2/L3 模式下用于展示"本次范围"。 */
    target_name?: string;
    /** 本次生成范围层级 */
    target_level?: "L1" | "L2" | "L3";
    category?: string;
    departments?: string[];
    /** AI 总结的文件标题（命名规则 §3.7，≤20 显示宽度）；用户可在文档转换 tab 编辑 */
    ai_summary?: string;
    doc_number?: string;
  };
  ch1_text?: string;
  ch2_text?: string;
  ch3_text?: string;
  ch3_roles?: RoleDuty[];
  ch5_arch_path?: string;
  ch6_chapters?: L2Chapter[];
  chapter_conflicts?: ChapterConflict[];
  l3_flow_conflicts?: L3FlowConflict[];
  appendices?: AppendixIndexItem[];
  appendix_dedup_groups?: AppendixDedupGroup[];
  key_mgmt_items?: KeyMgmtItem[];
  related_tables?: AppendixIndexItem[];
  related_files?: AppendixIndexItem[];
  related_appendices?: RelatedAppendix[];
  source_documents?: AnalyzeSourceDocument[];
  quality?: QualityMetrics;
  error?: string;
}

export interface HandbookSession {
  id: string;
  sessionId: string;
  nodeId: string;
  l1Name: string;
  phase: string;
  status: string;
  requestBody?: { source_file_urls?: string[]; source_node_id?: string };
  errorMessage?: string;
  createdAt: string;
  updatedAt: string;
}

export async function fetchHandbookSessions(nodeId: string): Promise<HandbookSession[]> {
  const resp = await axios.get(`${BASE}/handbook/sessions`, {
    params: { node_id: nodeId },
  });
  return resp.data.data ?? resp.data;
}

export async function deleteHandbookSession(sessionId: string): Promise<void> {
  await axios.delete(`${BASE}/handbook/sessions/${sessionId}`);
}

export async function startHandbookAnalyze(
  payload: HandbookAnalyzeRequest
): Promise<{ session_id: string; status: string }> {
  const resp = await axios.post(`${BASE}/handbook/analyze`, payload);
  return resp.data.data ?? resp.data;
}

/** Lightweight status-only check — avoids transferring full analyze payload during polling */
export async function getHandbookAnalyzeStatusLight(
  sessionId: string
): Promise<{ status: string; session_id: string }> {
  try {
    const resp = await axios.get(`${BASE}/handbook/analyze/${sessionId}/status`);
    const raw = resp.data.data ?? resp.data;
    return { status: raw.status, session_id: raw.session_id };
  } catch (err) {
    if (err instanceof AxiosError && err.response?.status === 404) {
      return { status: "failed", session_id: sessionId };
    }
    throw err;
  }
}


/** Fetch full analyze result (cached) — call only after status is "completed" */
export async function getHandbookAnalyzeResult(sessionId: string): Promise<HandbookAnalyzeResult> {
  const resp = await axios.get(`${BASE}/handbook/analyze/${sessionId}/result`);
  const raw = resp.data.data ?? resp.data;
  if (raw.response && typeof raw.response === "object") {
    const { response, ...rest } = raw;
    return { ...rest, ...response };
  }
  return raw;
}

export async function startHandbookGenerate(payload: {
  session_id: string;
  decisions: Record<string, unknown>;
  ai_summary_override?: string;
}): Promise<{ session_id: string; status: string }> {
  const resp = await axios.post(`${BASE}/handbook/generate`, payload);
  return resp.data.data ?? resp.data;
}

export async function getHandbookGenerateStatus(
  sessionId: string
): Promise<{ status: string; session_id: string; document_id?: string; doc_number?: string; error?: string }> {
  try {
    const resp = await axios.get(`${BASE}/handbook/generate/${sessionId}/status`);
    return resp.data.data ?? resp.data;
  } catch (err) {
    if (err instanceof AxiosError && err.response?.status === 404) {
      return { status: "failed", session_id: sessionId, error: "session_not_found" };
    }
    throw err;
  }
}

export function getHandbookDownloadUrl(sessionId: string): string {
  return `${BASE}/handbook/download/${sessionId}`;
}

/**
 * 提交审核 dialog 打开时调用：让 docfuse LLM 对比 prev/curr docx，返回建议的变更说明，
 * 预填到 update_description 输入框供用户编辑。首次发布或无新编辑时返回空字符串。
 */
export type PrepareReviewReason =
  | "first_publish"
  | "no_draft"
  | "no_prev_version"
  | "compared"
  | "no_changes_detected"
  | "";

export async function prepareReview(
  docId: string
): Promise<{ suggested_summary: string; has_changes: boolean; reason: PrepareReviewReason }> {
  const resp = await axios.post(
    `${BASE}/process-documents/${docId}/prepare-review`,
    null,
    { timeout: 150_000 },
  );
  return {
    suggested_summary: resp.data?.suggested_summary ?? "",
    has_changes: resp.data?.has_changes ?? false,
    reason: (resp.data?.reason ?? "") as PrepareReviewReason,
  };
}

/** Copy handbook session DOCX into process-document local file storage */
export async function persistSessionDocFile(
  docId: string,
  sessionId: string
): Promise<{ ok: boolean; version: number; skipped?: boolean }> {
  const resp = await axios.post(`${BASE}/process-documents/${docId}/file`, null, {
    params: { from_session: sessionId },
  });
  return resp.data;
}
