import type { NextApiRequest, NextApiResponse } from "next";
export default function handler(req: NextApiRequest, res: NextApiResponse) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "POST") return res.status(405).end();
  try {
    const origin = new URL(req.headers.origin || "");
    const expected =
      process.env.OIDC_ENABLED === "true"
        ? new URL(process.env.OIDC_REDIRECT_URI || "").origin
        : `${origin.protocol}//${req.headers.host}`;
    if (origin.origin !== expected) return res.status(403).end();
  } catch {
    return res.status(403).end();
  }
  res.setHeader(
    "Set-Cookie",
    `ragent_token=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${process.env.NODE_ENV === "production" ? "; Secure" : ""}`
  );
  return res.status(204).end();
}
