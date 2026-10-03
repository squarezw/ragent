import type { RagentOssClient } from "./client";
import { UploadError, NetworkError } from "./errors";
import type { UploadOptions, UploadResult } from "./types";

/**
 * Upload a file using presigned URL with progress tracking.
 *
 * Uses XMLHttpRequest for progress events (not available with fetch).
 * Designed for browser environments.
 *
 * Flow: presign → PUT to uploadUrl → return objectKey
 */
export function upload(
  client: RagentOssClient,
  options: UploadOptions,
): Promise<UploadResult> {
  const { file, category, onProgress, signal } = options;

  // Extract filename from File object, or use a default
  const filename = (file as File).name || "file";
  const contentType = file.type || "application/octet-stream";

  return new Promise(async (resolve, reject) => {
    // Check if already aborted
    if (signal?.aborted) {
      reject(new UploadError("Upload aborted"));
      return;
    }

    // Step 1: Get presigned URL
    let presignResult;
    try {
      presignResult = await client.presign({ filename, contentType, category });
    } catch (err) {
      reject(err);
      return;
    }

    const { objectKey, uploadUrl, headers } = presignResult;

    // Step 2: Upload via XHR for progress tracking
    const xhr = new XMLHttpRequest();

    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable && onProgress) {
        const percent = Math.round((event.loaded / event.total) * 100);
        onProgress(percent);
      }
    };

    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve({ objectKey });
      } else {
        reject(new UploadError(`Upload failed: ${xhr.status}`, xhr.status));
      }
    };

    xhr.onerror = () => {
      reject(new NetworkError("Upload network error"));
    };

    xhr.onabort = () => {
      reject(new UploadError("Upload aborted"));
    };

    // Handle AbortSignal
    if (signal) {
      signal.addEventListener("abort", () => xhr.abort(), { once: true });
    }

    xhr.open("PUT", uploadUrl);
    for (const [key, value] of Object.entries(headers)) {
      xhr.setRequestHeader(key, value);
    }
    xhr.send(file);
  });
}
