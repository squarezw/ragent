import type { NextApiRequest, NextApiResponse } from "next";

const EXTERNAL_API_BASE_URL = process.env.EXTERNAL_API_BASE_URL || "http://localhost:8010";

/**
 * GET /api/v1/workflow-runs/:id/events?since=N (SSE)
 *
 * Proxies the upstream SSE stream byte-for-byte to the browser. We use the
 * runtime `fetch` (Node 18+ ships an undici-based fetch with streaming bodies)
 * and pump chunks straight to `res` — no axios (which buffers) and no JSON
 * parsing on the way through.
 *
 * Critical for SSE behavior in dev:
 *  - `runtime: "nodejs"` — App Router Edge runtime has been known to buffer
 *    streams in Next 15 dev; Pages Router defaults to nodejs but we leave
 *    no doubt by not adding any edge config.
 *  - `X-Accel-Buffering: no` — disables nginx + some reverse proxies.
 *  - `res.flushHeaders()` — sends headers before the first chunk.
 *  - Manual `res.flush()` per chunk where available (compression middleware).
 *
 * Cancellation: when the client disconnects (`req.on('close')`), we abort the
 * upstream fetch so the FastAPI loop can detect `request.is_disconnected()`
 * and tear down its subscription.
 */
export const config = {
  api: {
    // Allow the response to remain open indefinitely; default body parser is
    // unused for GET but disable to be safe.
    bodyParser: false,
    responseLimit: false,
  },
};

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET") {
    res.setHeader("Allow", ["GET"]);
    return res.status(405).json({ detail: "Method not allowed" });
  }

  const { id, since } = req.query;
  if (!id || Array.isArray(id)) {
    return res.status(400).json({ detail: "id is required" });
  }

  const sinceParam = typeof since === "string" && /^\d+$/.test(since) ? `?since=${since}` : "";

  const headers: Record<string, string> = {
    Accept: "text/event-stream",
  };
  if (req.headers.authorization) {
    headers.Authorization = req.headers.authorization as string;
  }

  const upstreamUrl = `${EXTERNAL_API_BASE_URL}/api/v1/workflow-runs/${id}/events${sinceParam}`;

  const abortController = new AbortController();
  const onClientClose = () => {
    abortController.abort();
  };
  req.on("close", onClientClose);
  req.on("aborted", onClientClose);

  let upstream: Response;
  try {
    upstream = await fetch(upstreamUrl, {
      method: "GET",
      headers,
      signal: abortController.signal,
    });
  } catch (err: any) {
    if (abortController.signal.aborted) {
      // Client disconnected before upstream connected — nothing to do.
      return res.end();
    }
    console.error("[workflow-runs SSE] upstream fetch failed:", err?.message || err);
    return res.status(502).json({ detail: "Bad gateway" });
  }

  if (!upstream.ok || !upstream.body) {
    // Non-200; propagate status + body once.
    const text = await upstream.text().catch(() => "");
    res.status(upstream.status);
    res.setHeader("Content-Type", upstream.headers.get("content-type") || "application/json");
    return res.end(text);
  }

  // Headers must be sent BEFORE the first chunk so the browser starts parsing.
  res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  // Disable Next.js / Vercel response compression on this route; gzip can
  // delay buffer flushes by an unbounded amount on small chunks.
  res.setHeader("Content-Encoding", "identity");
  res.flushHeaders?.();

  const reader = upstream.body.getReader();
  const flushIfPossible = () => {
    // Node http.ServerResponse doesn't have .flush, but some compression
    // middleware injects one; call defensively.
    const maybeFlush = (res as unknown as { flush?: () => void }).flush;
    if (typeof maybeFlush === "function") {
      try {
        maybeFlush.call(res);
      } catch {
        /* ignore */
      }
    }
  };

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      // value is Uint8Array — write directly (no decode/encode roundtrip).
      const ok = res.write(Buffer.from(value));
      flushIfPossible();
      if (!ok) {
        // Backpressure: wait for drain before reading more.
        await new Promise<void>((resolve) => res.once("drain", () => resolve()));
      }
      if (abortController.signal.aborted) break;
    }
  } catch (err: any) {
    if (!abortController.signal.aborted) {
      console.warn("[workflow-runs SSE] stream pump error:", err?.message || err);
    }
  } finally {
    req.off("close", onClientClose);
    req.off("aborted", onClientClose);
    try {
      reader.releaseLock();
    } catch {
      /* ignore */
    }
    if (!res.writableEnded) {
      res.end();
    }
  }
}
