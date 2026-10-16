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
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  res.setHeader("Cache-Control", "no-store");
  const clear = `${TRANSACTION_COOKIE}=; Path=${TRANSACTION_PATH}; HttpOnly; SameSite=Lax; Max-Age=0${process.env.NODE_ENV === "production" ? "; Secure" : ""}`;
  res.setHeader("Set-Cookie", [clear]);
  if (req.method !== "GET") return res.status(405).end();
  try {
    const settings = readOidcSettings();
    if (!settings) return res.status(404).json({ errorCode: "NOT_FOUND" });
    const encrypted = req.cookies[TRANSACTION_COOKIE];
    if (!encrypted) return res.status(400).json({ errorCode: "OIDC_TRANSACTION_REQUIRED" });
    const verified = await completeOidc(
      settings,
      (req.url || "").split("?").slice(1).join("?"),
      encrypted
    );
    const result = await pool.query(
      "SELECT u.id,u.status FROM identity_subjects s JOIN users u ON u.id=s.user_id WHERE s.subject=$1",
      [verified.sub]
    );
    if (result.rows.length !== 1 || result.rows[0].status !== "active")
      return res.status(403).json({ errorCode: "ACCOUNT_UNAVAILABLE" });
    const token = jwt.sign({ userId: result.rows[0].id }, requireEnv("JWT_SECRET"), {
      expiresIn: verified.ttl,
    });
    setAuthCookie(res, token);
    // Preserve transaction deletion even when the legacy cookie helper replaces Set-Cookie.
    const existing = res.getHeader("Set-Cookie");
    res.setHeader("Set-Cookie", [
      ...(Array.isArray(existing) ? existing : existing ? [String(existing)] : []).filter(
        (v) => !v.startsWith(TRANSACTION_COOKIE + "=")
      ),
      clear,
    ]);
    return res.redirect(303, verified.returnTo);
  } catch {
    return res.status(401).json({ errorCode: "OIDC_AUTHENTICATION_FAILED" });
  }
}
