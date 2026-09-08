import jwt from "jsonwebtoken";
import { extractSseErrorMessage, isSseCommentLine } from "@/lib/chatSse";

export interface AutomationExecutionResult {
  answer: string;
  reference: unknown;
  segment_ids: number[];
  detail_id: number | null;
}

function requiredEnv(name: string) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

export async function executeAutomationAgent(params: {
  userId: number;
  appId: number;
  question: string;
}): Promise<AutomationExecutionResult> {
  const jwtSecret = requiredEnv("JWT_SECRET");
  const backendUrl = requiredEnv("EXTERNAL_API_BASE_URL").replace(/\/+$/, "");

  const token = jwt.sign({ userId: params.userId }, jwtSecret, { expiresIn: "15m" });

  const response = await fetch(`${backendUrl}/api/v1/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      messages: [{ role: "user", content: params.question }],
      app_id: params.appId,
    }),
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(detail || `ragent-service returned HTTP ${response.status}`);
  }

  if (!response.body) {
    throw new Error("ragent-service returned no response body");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();

  let buffer = "";
  let currentEvent: string | null = null;
  let answer = "";
  let reference: unknown = null;
  let segmentIds: number[] = [];
  let detailId: number | null = null;

  const consumeLine = (line: string) => {
    const trimmedLine = line.trim();
    if (!trimmedLine || isSseCommentLine(trimmedLine)) return false;

    if (trimmedLine.startsWith("event: ")) {
      currentEvent = trimmedLine.slice(7).trim();
      return false;
    }

    if (!trimmedLine.startsWith("data: ")) return false;

    const data = trimmedLine.slice(6);
    if (data === "[DONE]") return true;

    let parsed: any;
    try {
      parsed = JSON.parse(data);
    } catch {
      return false;
    }

    if (currentEvent === "error") {
      currentEvent = null;
      throw new Error(extractSseErrorMessage(parsed));
    }

    // ragent-service 当前 SSE 文本增量字段是 v，不是 OpenAI choices。
    if (parsed?.v !== undefined) {
      answer += String(parsed.v);
      return false;
    }

    if (currentEvent === "finish") {
      if (parsed?.references !== undefined) reference = parsed.references;
      else if (parsed?.reference !== undefined) reference = parsed.reference;

      if (Array.isArray(parsed?.segment_ids)) segmentIds = parsed.segment_ids;
      if (typeof parsed?.detail_id === "number") detailId = parsed.detail_id;

      currentEvent = null;
      return false;
    }

    if (currentEvent) currentEvent = null;
    return false;
  };

  try {
    while (true) {
      const { done, value } = await reader.read();

      if (done) {
        if (buffer.trim()) consumeLine(buffer);
        break;
      }

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";

      let finished = false;
      for (const line of lines) {
        if (consumeLine(line)) {
          finished = true;
          break;
        }
      }
      if (finished) break;
    }
  } finally {
    reader.releaseLock();
  }

  return {
    answer: answer.trim(),
    reference,
    segment_ids: segmentIds,
    detail_id: detailId,
  };
}
