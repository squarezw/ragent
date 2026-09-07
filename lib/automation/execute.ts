import jwt from "jsonwebtoken";
import { extractSseErrorMessage, isSseCommentLine } from "@/lib/chatSse";

export interface AutomationResultAttachment {
  filename: string;
  object_key: string;
  content_type?: string;
  size?: number;
}

export interface AutomationExecutionResult {
  answer: string;
  reference: unknown;
  segment_ids: number[];
  detail_id: number | null;
  attachments: AutomationResultAttachment[];
}

function extractAutomationResultAttachments(value: unknown): AutomationResultAttachment[] {
  const found: AutomationResultAttachment[] = [];
  const seenObjects = new Set<object>();

  const walk = (node: unknown) => {
    if (!node || typeof node !== "object") return;
    if (seenObjects.has(node as object)) return;
    seenObjects.add(node as object);

    if (Array.isArray(node)) {
      node.forEach(walk);
      return;
    }

    const item = node as Record<string, any>;
    const objectKey = String(
      item.object_key ?? item.objectKey ?? item.storage_key ?? item.storageKey ?? "",
    ).trim();

    if (objectKey) {
      const filename = String(
        item.filename ?? item.file_name ?? item.fileName ?? item.name ?? objectKey.split("/").pop() ?? "attachment",
      ).trim();
      const contentType = String(
        item.content_type ?? item.contentType ?? item.mime_type ?? item.mimeType ?? "",
      ).trim();
      const size = Number(item.size);

      found.push({
        filename: filename || "attachment",
        object_key: objectKey,
        ...(contentType ? { content_type: contentType } : {}),
        ...(Number.isFinite(size) && size >= 0 ? { size } : {}),
      });
    }

    Object.values(item).forEach(walk);
  };

  walk(value);

  const deduped = new Map<string, AutomationResultAttachment>();
  for (const item of found) {
    if (!deduped.has(item.object_key)) deduped.set(item.object_key, item);
  }
  return Array.from(deduped.values()).slice(0, 10);
}

const DEFAULT_AUTOMATION_TIMEOUT_MS = 10 * 60 * 1000;
const MIN_AUTOMATION_TIMEOUT_MS = 30 * 1000;
const MAX_AUTOMATION_TIMEOUT_MS = 60 * 60 * 1000;

function requiredEnv(name: string) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

function executionTimeoutMs() {
  const raw = Number(process.env.AUTOMATION_EXECUTION_TIMEOUT_MS || DEFAULT_AUTOMATION_TIMEOUT_MS);
  if (!Number.isFinite(raw)) return DEFAULT_AUTOMATION_TIMEOUT_MS;
  return Math.min(MAX_AUTOMATION_TIMEOUT_MS, Math.max(MIN_AUTOMATION_TIMEOUT_MS, Math.round(raw)));
}

export class AutomationTimeoutError extends Error {
  readonly code = "AUTOMATION_TIMEOUT";
  readonly timeoutMs: number;
  readonly partialAnswer: string;

  constructor(timeoutMs: number, partialAnswer = "") {
    super(`自动化执行超过 ${Math.max(1, Math.round(timeoutMs / 60000))} 分钟，已自动终止等待`);
    this.name = "AutomationTimeoutError";
    this.timeoutMs = timeoutMs;
    this.partialAnswer = partialAnswer.trim();
  }
}

export function isAutomationTimeoutError(error: unknown): error is AutomationTimeoutError {
  return (
    error instanceof AutomationTimeoutError ||
    (typeof error === "object" &&
      error !== null &&
      ((error as any).code === "AUTOMATION_TIMEOUT" ||
        (error as any).name === "AutomationTimeoutError"))
  );
}

export async function executeAutomationAgent(params: {
  userId: number;
  appId: number;
  question: string;
}): Promise<AutomationExecutionResult> {
  const jwtSecret = requiredEnv("JWT_SECRET");
  const backendUrl = requiredEnv("EXTERNAL_API_BASE_URL").replace(/\/+$/, "");
  const timeoutMs = executionTimeoutMs();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  const token = jwt.sign({ userId: params.userId }, jwtSecret, { expiresIn: "15m" });

  let answer = "";
  let reference: unknown = null;
  let segmentIds: number[] = [];
  let detailId: number | null = null;
  const attachmentMap = new Map<string, AutomationResultAttachment>();

  const collectAttachments = (value: unknown) => {
    for (const attachment of extractAutomationResultAttachments(value)) {
      if (!attachmentMap.has(attachment.object_key)) {
        attachmentMap.set(attachment.object_key, attachment);
      }
    }
  };

  try {
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
      signal: controller.signal,
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

      // Skill/数字员工生成的文件若以 object_key 形式出现在任意 SSE 事件中，
      // 在平台侧收集其文件引用，供运行记录和结果邮件后续使用。
      collectAttachments(parsed);

      // ragent-service 当前 SSE 文本增量字段是 v，不是 OpenAI choices。
      if (parsed?.v !== undefined) {
        answer += String(parsed.v);
        return false;
      }

      if (currentEvent === "finish") {
        if (parsed?.references !== undefined) reference = parsed.references;
        else if (parsed?.reference !== undefined) reference = parsed.reference;
        collectAttachments(reference);

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
      attachments: Array.from(attachmentMap.values()).slice(0, 10),
    };
  } catch (error: any) {
    if (controller.signal.aborted || error?.name === "AbortError") {
      throw new AutomationTimeoutError(timeoutMs, answer);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}
