// ---- Configuration ----

export interface RagentOssConfig {
  /** Base URL of the ragent-oss service, e.g. "https://oss.ragents.net" */
  baseUrl: string;
  /** API key for authentication (sent as X-API-Key header) */
  apiKey: string;
}

// ---- Health ----

export interface HealthResponse {
  status: string;
  storage: string;
}

// ---- Presign ----

export interface PresignRequest {
  /** Original filename (used to extract extension) */
  filename: string;
  /** MIME type, e.g. "application/pdf" */
  contentType: string;
  /** Storage category, e.g. "knowledge", "attachments" */
  category: string;
}

export interface PresignResponse {
  /** Generated object key, e.g. "knowledge/202602/uuid.pdf" */
  objectKey: string;
  /** Presigned PUT URL for direct upload */
  uploadUrl: string;
  /** Headers to include in the PUT request */
  headers: Record<string, string>;
}

// ---- Sign ----

export interface SignRequest {
  /** Object key to generate download URL for */
  objectKey: string;
  /** URL expiration in seconds (default: 86400 = 24h) */
  expiresIn?: number;
}

export interface SignResponse {
  /** Signed download URL */
  url: string;
}

// ---- Delete ----

export interface DeleteRequest {
  /** Object key to delete */
  objectKey: string;
}

export interface DeleteResponse {
  success: boolean;
}

// ---- Upload helper ----

export interface UploadOptions {
  /** File to upload */
  file: Blob;
  /** Storage category */
  category: string;
  /** Progress callback, called with percentage 0-100 */
  onProgress?: (percent: number) => void;
  /** AbortSignal to cancel the upload */
  signal?: AbortSignal;
}

export interface UploadResult {
  /** Generated object key for the uploaded file */
  objectKey: string;
}
