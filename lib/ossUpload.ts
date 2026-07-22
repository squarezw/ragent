import axios from "@/lib/axios";

interface UploadFileOptions {
  file: File;
  category: string;
  onProgress?: (percent: number) => void;
  signal?: AbortSignal;
}

/**
 * Three-step browser upload: presign → XHR PUT with progress → return objectKey.
 */
export async function uploadFile({
  file,
  category,
  onProgress,
  signal,
}: UploadFileOptions): Promise<string> {
  // Step 1: Get presigned URL from our proxy
  const { data } = await axios.post("/api/oss/presign", {
    filename: file.name,
    contentType: file.type || "application/octet-stream",
    category,
  });

  const { objectKey, uploadUrl, headers } = data;

  // Step 2: Upload directly to storage via XHR (for progress tracking)
  await new Promise<void>((resolve, reject) => {
    if (signal?.aborted) {
      reject(new Error("Upload aborted"));
      return;
    }

    const xhr = new XMLHttpRequest();

    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable && onProgress) {
        const percent = Math.round((event.loaded / event.total) * 100);
        onProgress(percent);
      }
    };

    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve();
      } else {
        reject(new Error(`Upload failed: ${xhr.status}`));
      }
    };

    xhr.onerror = () => reject(new Error("Upload network error"));
    xhr.onabort = () => reject(new Error("Upload aborted"));

    if (signal) {
      signal.addEventListener("abort", () => xhr.abort(), { once: true });
    }

    xhr.open("PUT", uploadUrl);
    for (const [key, value] of Object.entries(headers as Record<string, string>)) {
      xhr.setRequestHeader(key, value);
    }
    xhr.send(file);
  });

  return objectKey;
}

/**
 * Get the download URL for an OSS object via our proxy endpoint.
 */
export function getFileUrl(objectKey: string): string {
  return `/api/oss/${objectKey}`;
}
