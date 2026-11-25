import type { NextApiRequest, NextApiResponse } from "next";
import { resolveChatArtifact } from "@/lib/chatArtifactRedirect";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  res.setHeader("Cache-Control", "private, no-store");
  res.setHeader("Referrer-Policy", "no-referrer");
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).end();
  }
  const { id, artifactId } = req.query;
  if (typeof id !== "string" || typeof artifactId !== "string") return res.status(400).end();
  const target = await resolveChatArtifact(req, res, `/api/chat/sessions/${encodeURIComponent(id)}/artifacts/${encodeURIComponent(artifactId)}/download`);
  if (target) {
    res.setHeader("Location", target.href);
    res.status(307).end();
  }
}
