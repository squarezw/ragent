import { LOCAL_LOGOUT_COOKIE, isLocallySignedOut, localLogoutCookie } from "@/lib/localLogout";
import type { NextApiRequest, NextApiResponse } from "next";
import jwt from "jsonwebtoken";
import {
  readOidcSettings,
  completeOidc,
  TRANSACTION_COOKIE,
  TRANSACTION_PATH,
} from "@/lib/oidcClient";
import pool from "@/lib/db";
import { requireEnv } from "@/lib/env";
import { setAuthCookie } from "@/lib/auth";
import { openTransaction, RENEWAL_TRANSACTION_COOKIE } from "@/lib/oidcPolicy";
import { renewalResponse, type RenewalContext } from "@/lib/oidcRenewal";
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  res.setHeader("Cache-Control", "no-store");
  let cookieName = TRANSACTION_COOKIE;
  let clear = `${cookieName}=; Path=${TRANSACTION_PATH}; HttpOnly; SameSite=Lax; Max-Age=0${process.env.NODE_ENV === "production" ? "; Secure" : ""}`;
  if (req.method !== "GET") return res.status(405).end();
  let renewal: RenewalContext | undefined;
  let origin = "";
  try {
    const settings = readOidcSettings();
    if (!settings) return res.status(404).json({ errorCode: "NOT_FOUND" });
    let encrypted = req.cookies[TRANSACTION_COOKIE];
    if (req.cookies[RENEWAL_TRANSACTION_COOKIE]) {
      try {
        const candidate = openTransaction(req.cookies[RENEWAL_TRANSACTION_COOKIE], settings.transactionKey);
        const state = new URL(req.url || '/', settings.redirectUri).searchParams.get('state');
        if (candidate.renewal && state === candidate.state) {
          renewal = candidate.renewal;
          origin = new URL(settings.redirectUri).origin;
          encrypted = req.cookies[RENEWAL_TRANSACTION_COOKIE];
          cookieName = RENEWAL_TRANSACTION_COOKIE;
          clear = `${cookieName}=; Path=${TRANSACTION_PATH}; HttpOnly; SameSite=Lax; Max-Age=0${process.env.NODE_ENV === "production" ? "; Secure" : ""}`;
        }
      } catch { /* Invalid renewal transactions never become interactive login transactions. */ }
      if (!renewal) {
        // A stale iframe callback must not consume an unrelated interactive login.
        try {
          const interactive = encrypted && openTransaction(encrypted, settings.transactionKey);
          const state = new URL(req.url || '/', settings.redirectUri).searchParams.get('state');
          if (!interactive || interactive.renewal || interactive.state !== state)
            return res.status(400).json({ errorCode: 'OIDC_TRANSACTION_REQUIRED' });
        } catch { return res.status(400).json({ errorCode: 'OIDC_TRANSACTION_REQUIRED' }); }
      }
    }
    if (!encrypted) return res.status(400).json({ errorCode: "OIDC_TRANSACTION_REQUIRED" });
    res.setHeader('Set-Cookie', [clear]);
    if (renewal && isLocallySignedOut(req.cookies)) return renewalResponse(res, origin, renewal, false, 'SIGNED_OUT');
    const verified = await completeOidc(
      settings,
      (req.url || "").split("?").slice(1).join("?"),
      encrypted,
      isLocallySignedOut(req.cookies) ? req.cookies[LOCAL_LOGOUT_COOKIE] : ""
    );
    if (verified.renewal && !renewal)
      return res.status(401).json({ errorCode: "OIDC_TRANSACTION_REQUIRED" });
    const result = await pool.query(
      "SELECT u.id,u.status FROM identity_subjects s JOIN users u ON u.id=s.user_id WHERE s.subject=$1",
      [verified.sub]
    );
    if (result.rows.length !== 1 || result.rows[0].status !== "active") {
      if (renewal) return renewalResponse(res, origin, renewal, false, 'REAUTHENTICATION_REQUIRED');
      return res.status(403).json({ errorCode: "ACCOUNT_UNAVAILABLE" });
    }
    if (renewal && result.rows[0].id !== renewal.expectedUserId)
      return renewalResponse(res, origin, renewal, false, 'ACCOUNT_CHANGED');
    const token = jwt.sign({ userId: result.rows[0].id }, requireEnv("JWT_SECRET"), {
      expiresIn: verified.ttl,
    });
    setAuthCookie(res, token);
    // Preserve transaction deletion even when the legacy cookie helper replaces Set-Cookie.
    const existing = res.getHeader("Set-Cookie");
    res.setHeader("Set-Cookie", [
      ...(Array.isArray(existing) ? existing : existing ? [String(existing)] : []).filter(
        (v) => !v.startsWith(cookieName + "=")
      ),
      clear,
      // An older in-flight callback without this marker must never erase a later logout.
      ...(!renewal && isLocallySignedOut(req.cookies) ? [localLogoutCookie(true)] : []),
    ]);
    if (renewal) return renewalResponse(res, origin, renewal, true);
    return res.redirect(303, verified.returnTo);
  } catch {
    if (renewal) return renewalResponse(res, origin, renewal, false, 'REAUTHENTICATION_REQUIRED');
    return res.status(401).json({ errorCode: "OIDC_AUTHENTICATION_FAILED" });
  }
}
