import type { ChatRunSnapshot, ChatRunStatus } from "../types/chat-run";
export interface RunEvent {
  id: number;
  event: string;
  data: unknown;
}
export const terminalRun = (status: ChatRunStatus) =>
  ["completed", "cancelled", "failed", "interrupted"].includes(status);
const statuses = new Set([
  "queued",
  "running",
  "stopping",
  "completed",
  "cancelled",
  "failed",
  "interrupted",
]);
export function parseRunSnapshot(value: unknown): ChatRunSnapshot {
  if (!value || typeof value !== "object") throw new Error("Invalid chat run");
  const run = value as ChatRunSnapshot;
  if (
    typeof run.run_id !== "string" ||
    !run.run_id ||
    typeof run.session_id !== "string" ||
    !run.session_id ||
    !Number.isSafeInteger(run.detail_id) ||
    run.detail_id < 1 ||
    !Number.isSafeInteger(run.cursor) ||
    run.cursor < 0 ||
    !statuses.has(run.status) ||
    typeof run.answer !== "string"
  )
    throw new Error("Invalid chat run");
  return {
    ...run,
    tool_steps: Array.isArray(run.tool_steps) ? run.tool_steps : [],
    pending_confirmations: Array.isArray(run.pending_confirmations)
      ? run.pending_confirmations
      : [],
  };
}
/** Incremental standard SSE frames. Only terminated frames are committed; EOF is not completion. */
export class RunSseDecoder {
  private buffer = "";
  private trailingCR = false;
  private first = true;
  push(chunk: string): RunEvent[] {
    if (!chunk) return [];
    if (this.first) {
      chunk = chunk.replace(/^\uFEFF/, "");
      this.first = false;
    }
    if (this.trailingCR && chunk.startsWith("\n")) chunk = chunk.slice(1);
    this.trailingCR = chunk.endsWith("\r");
    this.buffer += chunk.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
    if (this.buffer.length > 2 * 1024 * 1024) throw new Error("Chat event too large");
    const frames: RunEvent[] = [];
    while (true) {
      const match = /\r?\n\r?\n/.exec(this.buffer);
      if (!match) break;
      const frame = this.buffer.slice(0, match.index);
      this.buffer = this.buffer.slice(match.index + match[0].length);
      let event = "message";
      let id: number | null = null;
      const data: string[] = [];
      for (const line of frame.split(/\r?\n/)) {
        if (!line || line.startsWith(":")) continue;
        const colon = line.indexOf(":");
        const field = colon < 0 ? line : line.slice(0, colon);
        let value = colon < 0 ? "" : line.slice(colon + 1);
        if (value.startsWith(" ")) value = value.slice(1);
        if (field === "event") event = value;
        if (field === "id" && /^\d+$/.test(value) && Number.isSafeInteger(Number(value)))
          id = Number(value);
        if (field === "data") data.push(value);
      }
      if (data.length && id !== null) frames.push({ id, event, data: JSON.parse(data.join("\n")) });
    }
    return frames;
  }
}
export function reduceRun(run: ChatRunSnapshot, event: RunEvent): ChatRunSnapshot {
  const data = (event.data && typeof event.data === "object" ? event.data : {}) as Record<
    string,
    unknown
  >;
  if (event.event === "snapshot") {
    const next = parseRunSnapshot(data);
    if (next.run_id !== run.run_id || next.cursor !== event.id)
      throw new Error("Mismatched chat snapshot");
    return next;
  }
  if (event.id <= run.cursor) return run;
  if (data.run_id && data.run_id !== run.run_id) throw new Error("Mismatched chat event");
  const next = { ...run, cursor: event.id };
  if (terminalRun(run.status) && !["finish", "error"].includes(event.event)) return next;
  if (event.event === "delta" && typeof data.v === "string") next.answer += data.v;
  if (event.event === "tool_status") {
    const id = data.tool_call_id;
    const index =
      typeof id === "string" ? run.tool_steps.findIndex((step) => step.tool_call_id === id) : -1;
    next.tool_steps = [...run.tool_steps];
    if (index >= 0) next.tool_steps[index] = { ...next.tool_steps[index], ...data };
    else next.tool_steps.push(data);
  }
  if (event.event === "knowledge_write_confirmation" && typeof data.request_id === "string") {
    next.pending_confirmations = [
      ...run.pending_confirmations.filter((item) => item.request_id !== data.request_id),
      data,
    ];
  }
  if (event.event === "status" && typeof data.status === "string" && statuses.has(data.status))
    next.status = data.status as ChatRunStatus;
  if (event.event === "finish") {
    // finish carries result metadata; execution cleanup/billing may still be running.
    next.result = data;
    next.usage = (data.usage as Record<string, unknown>) ?? next.usage;
  }
  if (event.event === "error") {
    // Wait for authoritative terminal status after cleanup; error itself is metadata.
    next.error = {
      message:
        typeof data.message === "string"
          ? data.message
          : typeof data.error === "string"
            ? data.error
            : "Chat execution failed",
      code: typeof data.code === "string" ? data.code : "CHAT_STREAM_FAILED",
    };
  }
  return next;
}

const RUN_ERROR_KEYS = {
  insufficient_balance: "insufficientBalance",
  user_credit_account_busy: "creditAccountBusy",
  user_credit_reconciliation_required: "creditReconciliationRequired",
  MODEL_ENDPOINT_UNREACHABLE: "modelEndpointUnreachable",
  MODEL_RESPONSE_TIMEOUT: "modelResponseTimeout",
  MODEL_STREAM_INTERRUPTED: "streamInterrupted",
  CHAT_STREAM_FAILED: "streamFailed",
} as const;
export function chatRunErrorMessageKey(code: string | undefined) {
  return code && code in RUN_ERROR_KEYS
    ? RUN_ERROR_KEYS[code as keyof typeof RUN_ERROR_KEYS]
    : "runFailed";
}
