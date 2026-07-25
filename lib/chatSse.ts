/**
 * Pure helpers for the chat SSE stream (`/api/chat/qa`, parsed in
 * `hooks/useChatSession.ts`). Kept free of React/axios imports so they can be
 * unit-tested with `node --test` + `--experimental-strip-types`.
 */

/**
 * Backend contract (ragent-service):
 *   event: tool_status
 *   data: {"name":"<tool>","skill":"<skill, optional>","phase":"started"|"finished","ok":<bool, finished only>}
 */
export interface ToolStatusEvent {
  name: string;
  skill?: string;
  phase: "started" | "finished";
  ok?: boolean;
}

/** Validates a parsed `event: tool_status` data payload. Returns null when malformed. */
export function parseToolStatusPayload(parsed: unknown): ToolStatusEvent | null {
  if (typeof parsed !== "object" || parsed === null) return null;
  const obj = parsed as Record<string, unknown>;
  if (typeof obj.name !== "string" || obj.name === "") return null;
  if (obj.phase !== "started" && obj.phase !== "finished") return null;

  const event: ToolStatusEvent = { name: obj.name, phase: obj.phase };
  if (typeof obj.skill === "string" && obj.skill !== "") {
    event.skill = obj.skill;
  }
  if (typeof obj.ok === "boolean") {
    event.ok = obj.ok;
  }
  return event;
}

/**
 * Extracts a human-readable message from an `event: error` data payload.
 * The backend may send a bare string or an object keyed by message/error/detail.
 */
export function extractSseErrorMessage(parsed: unknown): string {
  if (typeof parsed === "string" && parsed !== "") return parsed;
  if (typeof parsed === "object" && parsed !== null) {
    const obj = parsed as Record<string, unknown>;
    for (const key of ["message", "error", "detail"]) {
      const value = obj[key];
      if (typeof value === "string" && value !== "") return value;
    }
  }
  try {
    return JSON.stringify(parsed);
  } catch {
    return String(parsed);
  }
}

/** SSE comment lines (heartbeats like `: ping`) must be skipped, not parsed. */
export function isSseCommentLine(trimmedLine: string): boolean {
  return trimmedLine.startsWith(":");
}
