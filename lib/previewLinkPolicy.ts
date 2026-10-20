import { createHash } from "node:crypto";
import jwt from "jsonwebtoken";

export const PREVIEW_URL_TTL_SECONDS = 1800;
const MIN_REMAINING_SECONDS = 120;
const MAX_PREVIOUS_TOKEN_LENGTH = 8192;

interface PreviewFile {
  fileId: string;
  objectKey?: string;
  mimetype: string;
  size: string | number | null;
  uploadTime: Date | string | null;
  filename: string | null;
}

export function previewRevision(file: PreviewFile): string {
  return createHash("sha256")
    .update(
      JSON.stringify([
        file.fileId,
        file.objectKey || null,
        file.mimetype,
        file.size == null ? null : String(file.size),
        file.uploadTime instanceof Date ? file.uploadTime.toISOString() : file.uploadTime,
        file.filename,
      ])
    )
    .digest("hex");
}

interface PreviewClaims {
  fileId: string;
  userId: number;
  mimetype: string;
  objectKey?: string;
  revision: string;
}

export function createPreviewLink(
  claims: PreviewClaims,
  previousToken: unknown,
  secret: string,
  nowSeconds = Math.floor(Date.now() / 1000)
): { url: string; expiresIn: number } {
  let token: string | undefined;
  let expiresIn = PREVIEW_URL_TTL_SECONDS;
  if (typeof previousToken === "string" && previousToken.length <= MAX_PREVIOUS_TOKEN_LENGTH) {
    try {
      const previous = jwt.verify(previousToken, secret, {
        algorithms: ["HS256"],
        clockTimestamp: nowSeconds,
      });
      if (typeof previous === "object") {
        const remaining = typeof previous.exp === "number" ? previous.exp - nowSeconds : 0;
        if (
          previous.fileId === claims.fileId &&
          previous.userId === claims.userId &&
          previous.mimetype === claims.mimetype &&
          previous.objectKey === claims.objectKey &&
          previous.revision === claims.revision &&
          remaining > MIN_REMAINING_SECONDS &&
          remaining <= PREVIEW_URL_TTL_SECONDS
        ) {
          token = previousToken;
          expiresIn = remaining;
        }
      }
    } catch {
      // Invalid, expired or obsolete tokens silently receive a fresh link.
    }
  }
  token ??= jwt.sign(
    {
      fileId: claims.fileId,
      userId: claims.userId,
      mimetype: claims.mimetype,
      objectKey: claims.objectKey,
      revision: claims.revision,
      iat: nowSeconds,
    },
    secret,
    { algorithm: "HS256", expiresIn: PREVIEW_URL_TTL_SECONDS }
  );
  return { url: `/api/file-preview/stream?token=${encodeURIComponent(token)}`, expiresIn };
}
