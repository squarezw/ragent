import type { NextApiRequest, NextApiResponse } from "next";
import axios from "axios";
import { pipeline } from "node:stream/promises";
import { getTokenFromRequest, requireAuth } from "@/lib/auth";
import { watchQaDisconnect } from "@/lib/qaCancellation";

export async function proxySpeechSynthesis(
  req: NextApiRequest,
  res: NextApiResponse,
  action: "settings" | "synthesize"
) {
  res.setHeader("Cache-Control", "private, no-store");
  const method = action === "settings" ? "GET" : "POST";
  if (req.method !== method) {
    res.setHeader("Allow", method);
    return res.status(405).end();
  }
  if (!requireAuth(req, res)) return;
  if (action === "synthesize" && (typeof req.body?.text !== "string" || !req.body.text.trim())) {
    return res.status(400).json({ error: "Missing speech text" });
  }

  const tenant = req.headers["x-workspace-tenant-id"];
  const headers = {
    Authorization: `Bearer ${getTokenFromRequest(req)}`,
    ...(typeof tenant === "string" ? { "X-Workspace-Tenant-ID": tenant } : {}),
  };
  const base = process.env.EXTERNAL_API_BASE_URL || "http://localhost:8010";
  const disconnect = watchQaDisconnect(req, res);
  try {
    const upstream = await axios.request({
      method,
      url: `${base}/api/v1/tts/${action}`,
      headers,
      data: action === "synthesize" ? { text: req.body.text } : undefined,
      responseType: action === "synthesize" ? "stream" : "json",
      timeout: 30000,
      signal: disconnect.signal,
      maxRedirects: 0,
      validateStatus: () => true,
    });
    if (upstream.status !== 200) {
      if (action === "synthesize") upstream.data.destroy();
      return res.status(upstream.status >= 400 && upstream.status < 500 ? upstream.status : 502)
        .json({ error: "Speech synthesis unavailable" });
    }
    if (action === "settings") {
      const mode = upstream.data?.tts_model_mode;
      if (mode !== "remote" && mode !== "local") {
        return res.status(502).json({ error: "Speech settings unavailable" });
      }
      return res.json({ tts_model_mode: mode });
    }
    if (!/^audio\/mpeg(?:;|$)/i.test(upstream.headers["content-type"] || "")) {
      upstream.data.destroy();
      return res.status(502).json({ error: "Invalid speech audio" });
    }
    res.setHeader("Content-Type", "audio/mpeg");
    await pipeline(upstream.data, res, { signal: disconnect.signal });
  } catch {
    if (disconnect.signal.aborted || res.destroyed || res.writableEnded) return;
    if (res.headersSent) res.end();
    else res.status(502).json({ error: "Speech synthesis unavailable" });
  } finally {
    disconnect.dispose();
  }
}
