import type { NextApiRequest, NextApiResponse } from "next";
import { getUserIdFromRequest } from "@/lib/auth";
import { ossClient } from "@/lib/ossClient";

const SIGN_CONCURRENCY = 10;

async function signOne(key: string): Promise<string> {
  try {
    const { url } = await ossClient.sign({ objectKey: key });
    return url;
  } catch (err) {
    if ((err as Error)?.name !== "NetworkError") throw err;
    await new Promise((r) => setTimeout(r, 100 + Math.random() * 150));
    const { url } = await ossClient.sign({ objectKey: key });
    return url;
  }
}

/**
 * POST /api/oss/sign-urls
 * Body: { keys: string[] }
 * Returns: { urls: Record<string, string> }
 *
 * Batch-sign OSS object keys into publicly accessible URLs.
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const userId = getUserIdFromRequest(req);
  if (!userId) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const { keys } = req.body;
  if (!Array.isArray(keys) || keys.length === 0) {
    return res.status(400).json({ error: "Missing keys array" });
  }

  try {
    const urls: Record<string, string> = {};
    for (let i = 0; i < keys.length; i += SIGN_CONCURRENCY) {
      const chunk = keys.slice(i, i + SIGN_CONCURRENCY);
      await Promise.all(
        chunk.map(async (key: string) => {
          urls[key] = await signOne(key);
        }),
      );
    }
    return res.status(200).json({ urls });
  } catch (error: any) {
    console.error("[OSS Sign URLs] Error:", error.message);
    return res.status(500).json({ error: error.message || "Sign failed" });
  }
}
