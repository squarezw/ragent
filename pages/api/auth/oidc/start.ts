import { LOCAL_LOGOUT_COOKIE, isLocallySignedOut } from "@/lib/localLogout";
import type { NextApiRequest, NextApiResponse } from "next";
import { RENEWAL_TRANSACTION_COOKIE } from "@/lib/oidcPolicy";
import { renewalResponse, type RenewalContext } from "@/lib/oidcRenewal";
import {
  readOidcSettings,
  startOidc,
  TRANSACTION_COOKIE,
  TRANSACTION_PATH,
  TRANSACTION_TTL,
} from "@/lib/oidcClient";
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "GET") return res.status(405).end();
  let renewal: RenewalContext | undefined;
  let origin = "";
  try {
    const settings = readOidcSettings();
    if (!settings) return res.status(404).json({ errorCode: "NOT_FOUND" });
    if (req.query.mode !== undefined) {
      origin = new URL(settings.redirectUri).origin;
      const { mode, requestId, expectedUserId } = req.query;
      if (!['silent', 'popup'].includes(String(mode)) || typeof mode !== 'string' ||
        typeof requestId !== 'string' || !/^[a-f0-9]{32}$/.test(requestId) ||
        typeof expectedUserId !== 'string' || !/^[1-9][0-9]{0,9}$/.test(expectedUserId) ||
        Number(expectedUserId) > 2147483647)
        return res.status(400).json({ errorCode: 'INVALID_RENEWAL_REQUEST' });
      // This ID is only an equality constraint, never an authentication assertion.
      renewal = { mode: mode as 'silent' | 'popup', requestId, expectedUserId: Number(expectedUserId) };
      let sameOrigin = req.headers['sec-fetch-site'] === 'same-origin';
      if (!sameOrigin) {
        try { sameOrigin = new URL(String(req.headers.origin || req.headers.referer || '')).origin === origin; } catch {}
      }
      if (!sameOrigin) return renewalResponse(res, origin, renewal, false, 'SESSION_UNAVAILABLE');
      if (isLocallySignedOut(req.cookies)) return renewalResponse(res, origin, renewal, false, 'SIGNED_OUT');
    }
    const start = await startOidc(settings, req.query.returnTo, isLocallySignedOut(req.cookies) ? req.cookies[LOCAL_LOGOUT_COOKIE] : "", req.query.reauth === "1", renewal);
    res.setHeader(
      "Set-Cookie",
      `${renewal ? RENEWAL_TRANSACTION_COOKIE : TRANSACTION_COOKIE}=${start.cookie}; Path=${TRANSACTION_PATH}; HttpOnly; SameSite=Lax; Max-Age=${TRANSACTION_TTL}${process.env.NODE_ENV === "production" ? "; Secure" : ""}`
    );
    return res.redirect(303, start.redirectTo);
  } catch {
    if (renewal && origin) return renewalResponse(res, origin, renewal, false);
    return res.status(503).json({ errorCode: "OIDC_UNAVAILABLE" });
  }
}
