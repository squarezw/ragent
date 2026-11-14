import { parseRunSnapshot, reduceRun, RunSseDecoder, terminalRun } from "./chatRun";
import type { ChatRunSnapshot } from "../types/chat-run";
import type { RunEvent } from "./chatRun";
export interface RunTransport {
  get: (path: string) => Promise<unknown>;
  post: (path: string, body: unknown) => Promise<unknown>;
  stream: (path: string, signal: AbortSignal) => Promise<Response>;
}
export type RunConnection = "connected" | "reconnecting" | "detached";
/** One view subscription, never the owner of generation. Detach performs no business POST. */
export class ChatRunClient {
  private generation = 0;
  private controller: AbortController | null = null;
  private current: ChatRunSnapshot | null = null;
  private update: ((snapshot: ChatRunSnapshot) => void) | null = null;
  constructor(
    private transport: RunTransport,
    private wait = (ms: number, signal: AbortSignal) =>
      new Promise<void>((resolve) => {
        const finish = () => {
          clearTimeout(timer);
          signal.removeEventListener("abort", finish);
          resolve();
        };
        const timer = setTimeout(finish, ms);
        signal.addEventListener("abort", finish, { once: true });
        if (signal.aborted) finish();
      })
  ) {}
  detach() {
    this.generation++;
    this.controller?.abort();
    this.controller = null;
    this.update = null;
  }
  async snapshot(id: string) {
    return parseRunSnapshot(await this.transport.get(`/api/chat/turns/${encodeURIComponent(id)}`));
  }
  async active(session?: string, request?: string) {
    const query = new URLSearchParams();
    if (session) query.set("session_id", session);
    if (request) query.set("client_request_id", request);
    const result = (await this.transport.get(
      `/api/chat/turns/current${query.size ? `?${query}` : ""}`
    )) as { items?: unknown[] };
    return (result.items ?? []).map(parseRunSnapshot);
  }
  async start(body: Record<string, unknown>, requestId: string): Promise<ChatRunSnapshot> {
    try {
      return parseRunSnapshot(
        await this.transport.post("/api/chat/turns", { ...body, client_request_id: requestId })
      );
    } catch (error) {
      // Admission may have committed even when its response was lost. Query, never replay the question.
      const found = await this.active(undefined, requestId).catch(() => []);
      if (found.length) return found[0];
      throw error;
    }
  }
  async stop() {
    const run = this.current;
    if (!run || terminalRun(run.status)) return run;
    const result = parseRunSnapshot(
      await this.transport.post(`/api/chat/turns/${encodeURIComponent(run.run_id)}/stop`, {})
    );
    if (this.current?.run_id === result.run_id && result.cursor >= this.current.cursor) {
      this.current = result;
      this.update?.(result);
    }
    return result;
  }
  subscribe(
    initial: ChatRunSnapshot,
    update: (snapshot: ChatRunSnapshot) => void,
    event?: (event: RunEvent) => void,
    connection?: (state: RunConnection) => void
  ) {
    this.detach();
    const generation = this.generation;
    const controller = new AbortController();
    this.controller = controller;
    this.current = initial;
    this.update = update;
    update(initial);
    const valid = () => generation === this.generation && !controller.signal.aborted;
    void (async () => {
      let failures = 0;
      while (valid() && this.current && !terminalRun(this.current.status)) {
        let reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
        try {
          const response = await this.transport.stream(
            `/api/chat/turns/${encodeURIComponent(initial.run_id)}/events?after=${this.current.cursor}`,
            controller.signal
          );
          if (!response.ok || !response.body) throw new Error("Subscription unavailable");
          if (!valid()) break;
          connection?.("connected");
          reader = response.body.getReader();
          const decoder = new TextDecoder();
          const frames = new RunSseDecoder();
          while (valid()) {
            const { done, value } = await reader.read();
            if (done) break;
            if (!valid()) break;
            for (const frame of frames.push(decoder.decode(value, { stream: true }))) {
              if (!this.current || !valid()) break;
              const previous: ChatRunSnapshot = this.current;
              this.current = reduceRun(previous, frame);
              if (this.current !== previous) {
                update(this.current);
                event?.(frame);
                failures = 0;
              }
            }
            if (this.current && terminalRun(this.current.status)) break;
          }
        } catch {
          /* EOF/network errors detach transport only; snapshot/replay resolves state. */
        } finally {
          if (reader) {
            try {
              await reader.cancel();
            } catch {
            } finally {
              reader.releaseLock();
            }
          }
        }
        if (!valid() || !this.current || terminalRun(this.current.status)) break;
        connection?.("reconnecting");
        await this.wait(Math.min(1000 * 2 ** Math.min(failures++, 4), 15000), controller.signal);
        if (!valid()) break;
        try {
          const before = this.current?.cursor;
          const fresh = await this.snapshot(initial.run_id);
          if (
            valid() &&
            this.current &&
            (this.current.cursor === before || fresh.cursor >= this.current.cursor)
          ) {
            this.current = fresh;
            update(fresh);
          }
        } catch {
          /* retry read only */
        }
      }
      if (valid() && this.current && terminalRun(this.current.status)) {
        try {
          const final = await this.snapshot(initial.run_id);
          if (valid() && this.current && final.cursor >= this.current.cursor) {
            this.current = final;
            update(final);
          }
        } catch {
          /* The committed terminal state remains visible if hydration is unavailable. */
        }
      }
    })();
    return () => {
      if (generation === this.generation) this.detach();
    };
  }
}
