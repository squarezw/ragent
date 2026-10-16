import type { NextApiRequest, NextApiResponse } from "next";
export default function handler(req: NextApiRequest, res: NextApiResponse) {
  res.setHeader("Cache-Control", "no-store");
  const env = process.env.CLOUDBASE_ENV_ID;
  res.json({ envId: env && /^[a-z0-9-]+$/i.test(env) ? env : null });
}
