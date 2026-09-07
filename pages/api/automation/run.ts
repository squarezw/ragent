import { requireAuth } from "@/lib/auth";
import { extractSseErrorMessage, isSseCommentLine } from "@/lib/chatSse";
import { logError } from "@/lib/logError";
import { NextApiRequest, NextApiResponse } from "next";

function getRequestBaseUrl(req: NextApiRequest) {
  const forwardedProto = req.headers["x-forwarded-proto"];
  const protocol = Array.isArray(forwardedProto)
    ? forwardedProto[0]
    : forwardedProto || "http";

  const host = req.headers.host;
  if (!host) {
    throw new Error("Missing request host");
  }

  return `${protocol}://${host}`;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (!requireAuth(req, res)) return;
  if (req.method !== "POST") return res.status(405).end();

  const { question, app_id, attachments } = req.body || {};

  if (!question || typeof question !== "string") {
    return res.status(400).json({ error: "Missing question" });
  }

  if (!app_id) {
    return res.status(400).json({ error: "Missing app_id" });
  }

  try {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };

    if (typeof req.headers.authorization === "string") {
      headers.Authorization = req.headers.authorization;
    }

    const qaResponse = await fetch(`${getRequestBaseUrl(req)}/api/chat/qa`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        question,
        app_id,
        attachments,
        stream: true,
      }),
    });

    if (!qaResponse.ok) {
      const responseText = await qaResponse.text();
      throw new Error(
        responseText || `Chat API request failed with status ${qaResponse.status}`,
      );
    }

    if (!qaResponse.body) {
      throw new Error("Chat API returned no response body");
    }

    const reader = qaResponse.body.getReader();
    const decoder = new TextDecoder();

    let buffer = "";
    let currentEvent: string | null = null;
    let answer = "";
    let reference: unknown = null;
    let segmentIds: number[] = [];
    let detailId: number | null = null;

    const buildResult = () => ({
      answer: answer.trim(),
      reference,
      segment_ids: segmentIds,
      detail_id: detailId,
    });

    while (true) {
      const { done, value } = await reader.read();

      if (done) {
        return res.status(200).json(buildResult());
      }

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";

      for (const line of lines) {
        const trimmedLine = line.trim();

        if (!trimmedLine) continue;
        if (isSseCommentLine(trimmedLine)) continue;

        if (trimmedLine.startsWith("event: ")) {
          currentEvent = trimmedLine.slice(7).trim();
          continue;
        }

        if (!trimmedLine.startsWith("data: ")) continue;

        const data = trimmedLine.slice(6);

        if (data === "[DONE]") {
          return res.status(200).json(buildResult());
        }

        let parsed: any;

        try {
          parsed = JSON.parse(data);
        } catch {
          continue;
        }

        if (currentEvent === "error") {
          currentEvent = null;
          throw new Error(extractSseErrorMessage(parsed));
        }

        if (parsed?.v !== undefined) {
          answer += String(parsed.v);
          continue;
        }

        if (currentEvent === "finish") {
          if (parsed?.references !== undefined) {
            reference = parsed.references;
          } else if (parsed?.reference !== undefined) {
            reference = parsed.reference;
          }

          if (Array.isArray(parsed?.segment_ids)) {
            segmentIds = parsed.segment_ids;
          }

          if (typeof parsed?.detail_id === "number") {
            detailId = parsed.detail_id;
          }

          currentEvent = null;
          continue;
        }

        if (currentEvent) {
          currentEvent = null;
        }
      }
    }
  } catch (error: any) {
    console.error("[Automation Run API] Error:", error);
    logError(error);

    return res.status(500).json({
      error: "Automation execution failed",
      detail:
        process.env.NODE_ENV === "development"
          ? error?.message || "Unknown error"
          : undefined,
    });
  }
}
