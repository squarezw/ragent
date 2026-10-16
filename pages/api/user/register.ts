import type { NextApiRequest, NextApiResponse } from "next";
// Only the verified-phone endpoint may create public accounts.
export default function handler(req: NextApiRequest, res: NextApiResponse) {
  if (process.env.OIDC_ENABLED === "true") {
    res.setHeader("Cache-Control", "no-store");
    return res.status(410).json({ errorCode: "UNIFIED_IDENTITY_REQUIRED" });
  }
  return res
    .status(req.method === "POST" ? 410 : 405)
    .json({ errorCode: "PHONE_REGISTRATION_REQUIRED" });
}
