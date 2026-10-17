import { LOCAL_LOGOUT_COOKIE, isLocallySignedOut } from "@/lib/localLogout";
import type { NextApiRequest, NextApiResponse } from "next";
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
  try {
    const settings = readOidcSettings();
    if (!settings) return res.status(404).json({ errorCode: "NOT_FOUND" });
    const start = await startOidc(settings, req.query.returnTo, isLocallySignedOut(req.cookies) ? req.cookies[LOCAL_LOGOUT_COOKIE] : "", req.query.reauth === "1");
    res.setHeader(
      "Set-Cookie",
      `${TRANSACTION_COOKIE}=${start.cookie}; Path=${TRANSACTION_PATH}; HttpOnly; SameSite=Lax; Max-Age=${TRANSACTION_TTL}${process.env.NODE_ENV === "production" ? "; Secure" : ""}`
    );
    return res.redirect(303, start.redirectTo);
  } catch {
    return res.status(503).json({ errorCode: "OIDC_UNAVAILABLE" });
  }
}
