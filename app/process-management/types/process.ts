export interface ProcessNode {
  id: string;
  name: string;
  level: number; // 0=category, 1=L1, 2=L2, 3=L3
  type?: "category";
  desc?: string;
  role?: string;
  org?: string;
  docs?: string;
  updated?: string;
  children: ProcessNode[];
  _expanded?: boolean;
  // Backend fields
  parent_id?: string | null;
  company_code?: string;
  owner?: string;
  sort_order?: number;
  document_count?: number;
  category?: string;
}

/** Raw response shape from zn-process-management backend */
export interface BackendProcessNode {
  id: string;
  parent_id: string | null;
  company_code: string;
  level: number;
  name: string;
  category: string;
  description: string;
  owner: string;
  responsible_role: string;
  involved_orgs: string;
  sort_order: number;
  created_at: string;
  updated_at?: string;
  document_count: number;
  children: BackendProcessNode[];
}

/** Raw document response from backend */
export interface BackendDocument {
  id: string;
  node_id: string;
  name: string;
  ai_summary?: string;
  doc_number: string;
  department: string;
  status: "draft" | "reviewing" | "approved" | "offline" | "revising";
  owner: string;
  content?: string;
  file_path?: string;
  file_size?: number;
  mime_type?: string;
  version?: number;
  created_at: string;
  updated_at?: string;
  session_id?: string | null;
  created_by?: string;
  /** ragent 代理层补全的展示名（nickname > username），zn 后端不返回 */
  created_by_name?: string;
  reviewed_by?: string;
}

export interface RelatedDoc {
  id: string;
  name: string;
  /** AI 总结（命名规则 §3.7）；用户可修订 */
  aiSummary?: string;
  /** 文件所属节点 id（可能是 L2 或 L3） */
  nodeId: string;
  dept: string;
  status: "draft" | "reviewing" | "approved" | "offline" | "revising";
  owner: string;
  createdAt: string;
  docNumber?: string;
  /** Set when this doc was generated from a handbook session */
  sessionId?: string;
  /** Backend file_path — indicates the document has a downloadable file */
  filePath?: string;
  /** 创建者 user id（字符串形式）。删除权限判断用 */
  createdBy?: string;
}

export interface DocPreview {
  owner: string;
  dept: string;
  date: string;
  status: string;
  body: string;
}

export interface Annotation {
  id: number;
  author: string;
  time: string;
  quote: string;
  content: string;
  resolved: boolean;
}

export interface KnowledgeBase {
  id: string;
  name: string;
  icon: string;
  folders: KnowledgeFolder[];
}

export interface KnowledgeFolder {
  id: string;
  name: string;
  files: KnowledgeFile[];
}

export interface KnowledgeFile {
  id: string;
  name: string;
  size: string;
  date: string;
}

export interface DistributionData {
  owners: { role: string; path: string }[];
  depts: string[];
  roles: string[];
}

export interface ConversionSection {
  num: number;
  title: string;
  desc: string;
  sources: string[];
  tag: "unique" | "duplicate" | "redundant" | "conflict";
  tabIndex?: number;
  sectionId?: string;
  subItems?: {
    num: string;
    title: string;
    tag: "unique" | "duplicate" | "redundant" | "conflict";
    tabIndex: number;
    sectionId: string;
  }[];
  conflict?: {
    title: string;
    versionA: { label: string; text: string };
    versionB: { label: string; text: string };
  };
}

export interface SourceDocument {
  id: string;
  name: string;
  sections: {
    id: string;
    title: string;
    content: string;
  }[];
}

export interface TraceRecord {
  id: string;
  summary: string;
  sourceFile: string;
  sourceChapter: string;
  confidence: number;
  tabIndex: number;
  sectionId: string;
}
