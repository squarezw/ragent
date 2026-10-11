import jwt from "jsonwebtoken";

/** Scoped proof for the key returned by the authenticated upload service. */
export function signChatUploadReceipt(
  userId: number,
  objectKey: string,
  contentType: string,
  secret: string
): string {
  return jwt.sign(
    { v: 1, purpose: "chat_image", object_key: objectKey, content_type: contentType },
    secret,
    {
      algorithm: "HS256",
      issuer: "ragent-upload",
      audience: "ragent-chat-image",
      subject: String(userId),
      expiresIn: "2h",
    }
  );
}
