import {
  RagentOssError,
  AuthenticationError,
  ValidationError,
  NetworkError,
} from "./errors";
import type {
  RagentOssConfig,
  HealthResponse,
  PresignRequest,
  PresignResponse,
  SignRequest,
  SignResponse,
  DeleteRequest,
  DeleteResponse,
} from "./types";

export class RagentOssClient {
  private readonly baseUrl: string;
  private readonly apiKey: string;

  constructor(config: RagentOssConfig) {
    // Strip trailing slash
    this.baseUrl = config.baseUrl.replace(/\/+$/, "");
    this.apiKey = config.apiKey;
  }

  /** Check service health (no authentication required). */
  async health(): Promise<HealthResponse> {
    return this.get<HealthResponse>("/api/health");
  }

  /** Get a presigned upload URL. */
  async presign(req: PresignRequest): Promise<PresignResponse> {
    return this.post<PresignResponse>("/api/presign", req);
  }

  /** Get a signed download URL. */
  async sign(req: SignRequest): Promise<SignResponse> {
    return this.post<SignResponse>("/api/sign", req);
  }

  /** Delete an object. */
  async delete(req: DeleteRequest): Promise<DeleteResponse> {
    return this.post<DeleteResponse>("/api/delete", req);
  }

  /** Convenience: presign + fetch PUT to upload content. Returns the objectKey. */
  async upload(options: {
    filename: string;
    content: Blob | ArrayBuffer | Uint8Array;
    contentType: string;
    category: string;
  }): Promise<string> {
    const { filename, content, contentType, category } = options;
    const { objectKey, uploadUrl, headers } = await this.presign({
      filename,
      contentType,
      category,
    });

    let res: Response;
    try {
      res = await fetch(uploadUrl, {
        method: "PUT",
        headers,
        body: content,
      });
    } catch (err) {
      throw new NetworkError("Upload failed", err);
    }
    if (!res.ok) {
      throw new RagentOssError(
        `Upload failed: ${res.status}`,
        res.status,
        await res.text().catch(() => null),
      );
    }
    return objectKey;
  }

  /** Convenience: sign + fetch to download file content as ArrayBuffer. */
  async download(objectKey: string, expiresIn?: number): Promise<ArrayBuffer> {
    const { url } = await this.sign({ objectKey, expiresIn });
    let res: Response;
    try {
      res = await fetch(url);
    } catch (err) {
      throw new NetworkError("Download failed", err);
    }
    if (!res.ok) {
      throw new RagentOssError(
        `Download failed: ${res.status}`,
        res.status,
        await res.text().catch(() => null),
      );
    }
    return res.arrayBuffer();
  }

  private async get<T>(path: string): Promise<T> {
    let res: Response;
    try {
      res = await fetch(`${this.baseUrl}${path}`);
    } catch (err) {
      throw new NetworkError(`Request to ${path} failed`, err);
    }
    return this.handleResponse<T>(res);
  }

  private async post<T>(path: string, body: unknown): Promise<T> {
    let res: Response;
    try {
      res = await fetch(`${this.baseUrl}${path}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-API-Key": this.apiKey,
        },
        body: JSON.stringify(body),
      });
    } catch (err) {
      throw new NetworkError(`Request to ${path} failed`, err);
    }
    return this.handleResponse<T>(res);
  }

  private async handleResponse<T>(res: Response): Promise<T> {
    if (res.ok) {
      return res.json() as Promise<T>;
    }

    const body = await res.json().catch(() => null);

    if (res.status === 401) {
      throw new AuthenticationError(body);
    }
    if (res.status === 422) {
      throw new ValidationError(body);
    }

    throw new RagentOssError(
      `Request failed: ${res.status}`,
      res.status,
      body,
    );
  }
}
