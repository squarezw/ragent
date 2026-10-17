import { randomBytes } from "node:crypto";
import type { NextApiResponse } from "next";
import type { OidcTransaction } from "./oidcPolicy";

export type RenewalContext = NonNullable<OidcTransaction["renewal"]>;
export function renewalResponse(res: NextApiResponse, origin: string, context: RenewalContext,
  ok: boolean, errorCode = "SESSION_UNAVAILABLE") {
  const nonce = randomBytes(18).toString("base64");
  const message = JSON.stringify({ type: "ragent:session-renewal", requestId: context.requestId,
    ok, ...(!ok ? { errorCode } : {}) }).replace(/</g, "\\u003c");
  const destination = JSON.stringify(new URL(origin).origin).replace(/</g, "\\u003c");
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.setHeader("X-Frame-Options", "SAMEORIGIN");
  res.setHeader("Content-Security-Policy", `default-src 'none'; script-src 'nonce-${nonce}'; frame-ancestors 'self'; base-uri 'none'`);
  const receiver = context.mode === "silent" ? "window.parent" : "window.opener";
  return res.status(ok ? 200 : 401).end(`<!doctype html><meta charset="utf-8"><script nonce="${nonce}">const target=${receiver};if(target&&target!==window)target.postMessage(${message},${destination});${context.mode === "popup" && ok ? "window.close();" : ""}</script>`);
}
