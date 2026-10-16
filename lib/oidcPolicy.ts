import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
export const TRANSACTION_COOKIE = "ragent_oidc_tx";
export const TRANSACTION_PATH = "/api/auth/oidc";
export const TRANSACTION_TTL = 300;
export type OidcTransaction = {
  state: string;
  nonce: string;
  verifier: string;
  returnTo: string;
  createdAt: number;
};
export function safeReturnTo(value: unknown): string {
  if (
    typeof value !== "string" ||
    !value.startsWith("/") ||
    value.startsWith("//") ||
    /[\\\x00-\x20]/.test(value) ||
    /%2f|%5c|%0[ad]/i.test(value)
  )
    return "/";
  const url = new URL(value, "https://local.invalid");
  if (
    url.origin !== "https://local.invalid" ||
    url.pathname.startsWith("/api/auth/") ||
    url.pathname.startsWith("/identity-login")
  )
    return "/";
  return url.pathname + url.search + url.hash;
}
export function readOidcSettings(env: Record<string, string | undefined> = process.env) {
  if (env.OIDC_ENABLED !== "true") return null;
  const required = (name: string) => {
    const value = env[name];
    if (!value) throw new Error(`Missing ${name}`);
    return value;
  };
  const issuer = new URL(required("OIDC_ISSUER"));
  const redirect = new URL(required("OIDC_REDIRECT_URI"));
  const testHttp = env.NODE_ENV === "test" && env.OIDC_ALLOW_INSECURE_TEST_HTTP === "true";
  if (
    issuer.username ||
    issuer.password ||
    issuer.search ||
    issuer.hash ||
    issuer.pathname !== "/" ||
    redirect.username ||
    redirect.password ||
    redirect.search ||
    redirect.hash ||
    redirect.pathname !== "/api/auth/oidc/callback"
  )
    throw new Error("Invalid OIDC URLs");
  if (
    [issuer, redirect].some(
      (u) =>
        u.protocol !== "https:" &&
        !(testHttp && u.protocol === "http:" && ["127.0.0.1", "localhost"].includes(u.hostname))
    )
  )
    throw new Error("OIDC requires HTTPS");
  const secret = required("OIDC_CLIENT_SECRET");
  const transactionKey = required("OIDC_TRANSACTION_KEY");
  if (
    secret.length < 32 ||
    !/^[0-9a-f]{64}$/i.test(transactionKey) ||
    transactionKey === secret ||
    transactionKey === env.JWT_SECRET
  )
    throw new Error("Independent OIDC credentials required");
  return {
    issuer: issuer.href.replace(/\/$/, ""),
    redirectUri: redirect.href,
    clientId: required("OIDC_CLIENT_ID"),
    secret,
    transactionKey,
    testHttp,
  };
}
export function sealTransaction(payload: OidcTransaction, key: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", Buffer.from(key, "hex"), iv);
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(payload)), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString("base64url");
}
export function openTransaction(
  value: string,
  key: string,
  now = Math.floor(Date.now() / 1000)
): OidcTransaction {
  const buffer = Buffer.from(value, "base64url");
  if (buffer.length < 29 || buffer.length > 4096) throw Error("Invalid transaction");
  const decipher = createDecipheriv("aes-256-gcm", Buffer.from(key, "hex"), buffer.subarray(0, 12));
  decipher.setAuthTag(buffer.subarray(12, 28));
  const transaction = JSON.parse(
    Buffer.concat([decipher.update(buffer.subarray(28)), decipher.final()]).toString()
  );
  if (
    !Number.isFinite(transaction.createdAt) ||
    now < transaction.createdAt ||
    now - transaction.createdAt > TRANSACTION_TTL ||
    ["state", "nonce", "verifier"].some(
      (k) => typeof transaction[k] !== "string" || !transaction[k]
    )
  )
    throw Error("Expired transaction");
  transaction.returnTo = safeReturnTo(transaction.returnTo);
  return transaction;
}
export function localSessionTtl(
  claims: { exp?: number },
  expiresIn: number | undefined,
  now = Math.floor(Date.now() / 1000)
): number {
  if (!Number.isFinite(claims.exp)) throw Error("ID token expiry required");
  const ttl = Math.floor(Math.min(claims.exp! - now, expiresIn ?? 3600, 3600));
  if (ttl <= 0) throw Error("Expired identity proof");
  return ttl;
}
