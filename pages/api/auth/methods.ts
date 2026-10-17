import { isLocallySignedOut } from "@/lib/localLogout";
import type { NextApiRequest, NextApiResponse } from "next";
export default function handler(req: NextApiRequest, res: NextApiResponse) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "GET") return res.status(405).end();
  return res.json({ oidcEnabled: process.env.OIDC_ENABLED === "true", signedOut: isLocallySignedOut(req.cookies) });
}
