import type { NextApiRequest, NextApiResponse } from "next";
// Only the verified-phone endpoint may create public accounts.
export default function handler(req: NextApiRequest, res: NextApiResponse) {
  return res
    .status(req.method === "POST" ? 410 : 405)
    .json({ errorCode: "PHONE_REGISTRATION_REQUIRED" });
}
