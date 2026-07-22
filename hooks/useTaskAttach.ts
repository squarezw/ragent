"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type {
  ActiveWorkflowRunEntry,
  TaskNode,
  TaskState,
  WorkflowEventPayload,
  WorkflowEventType,
} from "@/types/workflow-run";

/**
 * Hook that subscribes a chat-session to backend workflow-run events.
 *
 *  - On `conversationId` change → fetch `/api/v1/conversations/{cid}/active-workflow-runs`,
 *    then open one SSE stream per active run (resuming with `since=last_event_seq`).
 *  - External `attachRun(runId, kind)` is called by useChatSession when the chat
 *    token-buffer contains a `_workflow_run_started` JSON marker — we open a fresh
 *    SSE stream for that run (since=0).
 *  - Reconnect: on stream error or premature EOF (status non-terminal) we retry
 *    `_subscribe(runId, kind, lastSeq)` with exponential backoff capped at 30s.
 *  - Cleanup: on unmount or conversation change we abort all in-flight streams.
 *
 *  Notes:
 *  - We use `fetch` + `ReadableStream` instead of `EventSource` because the project
 *    authenticates with a Bearer token from localStorage; `EventSource` cannot
 *    inject custom headers.
 *  - SSE event format: `event: <type>\ndata: <json>\n\n`; comments start with `:`
 *    (heartbeat) and are silently dropped.
 */
export function useTaskAttach(conversationId: number | string | null | undefined) {
  const [activeRuns, setActiveRuns] = useState<Record<number, TaskState>>({});

  // Track per-run AbortControllers so we can tear down on unmount / re-attach.
  const controllersRef = useRef<Map<number, AbortController>>(new Map());
  // Track per-run reconnect timer handles.
  const reconnectTimersRef = useRef<Map<number, ReturnType<typeof setTimeout>>>(new Map());
  // Avoid double-subscribe within one mount.
  const subscribedRef = useRef<Set<number>>(new Set());
  // Track the last conversationId we bootstrapped for, so we can distinguish
  // "first attach (null → value)" from "real switch (A → B)".
  const lastBootstrappedCidRef = useRef<number | string | null>(null);

  // Latest activeRuns ref to read inside async callbacks (no re-subscribe-on-change).
  const activeRunsRef = useRef<Record<number, TaskState>>({});
  useEffect(() => {
    activeRunsRef.current = activeRuns;
  }, [activeRuns]);

  const cancelReconnect = useCallback((runId: number) => {
    const t = reconnectTimersRef.current.get(runId);
    if (t) {
      clearTimeout(t);
      reconnectTimersRef.current.delete(runId);
    }
  }, []);

  const tearDownRun = useCallback(
    (runId: number) => {
      const ctrl = controllersRef.current.get(runId);
      if (ctrl) {
        ctrl.abort();
        controllersRef.current.delete(runId);
      }
      cancelReconnect(runId);
      subscribedRef.current.delete(runId);
    },
    [cancelReconnect]
  );

  const tearDownAll = useCallback(() => {
    for (const [runId] of controllersRef.current) {
      tearDownRun(runId);
    }
  }, [tearDownRun]);

  /**
   * Apply a single SSE event to the per-run TaskState.
   * Returns `true` if the run reached a terminal state (caller closes the stream).
   */
  const applyEvent = useCallback(
    (runId: number, kind: string, ev: WorkflowEventPayload): boolean => {
      const type: WorkflowEventType = ev.type;
      const payload = (ev.payload || {}) as Record<string, unknown>;

      setActiveRuns((prev) => {
        const current: TaskState = prev[runId] ?? {
          runId,
          kind,
          status: "queued",
          progressPct: null,
          currentNode: null,
          nodes: [],
          finalOutput: null,
          error: null,
          lastEventSeq: 0,
          startedAt: null,
          completedAt: null,
        };

        const next: TaskState = {
          ...current,
          kind: current.kind || kind,
          lastEventSeq: Math.max(current.lastEventSeq, ev.seq),
        };

        switch (type) {
          case "run.queued":
            next.status = "queued";
            break;

          case "run.started":
            next.status = "running";
            next.startedAt = ev.ts || next.startedAt;
            break;

          case "node.started": {
            const nodeName = String(payload.node ?? "");
            next.currentNode = nodeName || next.currentNode;
            next.status = "running";
            const nodes = current.nodes.slice();
            const existingIdx = nodes.findIndex((n) => n.name === nodeName);
            const fresh: TaskNode = {
              name: nodeName,
              status: "running",
              startedAt: ev.ts,
              completedAt: null,
            };
            if (existingIdx >= 0) {
              nodes[existingIdx] = { ...nodes[existingIdx], ...fresh };
            } else {
              nodes.push(fresh);
            }
            next.nodes = nodes;
            break;
          }

          case "node.progress": {
            const pct = payload.progress_pct;
            if (typeof pct === "number") {
              next.progressPct = pct;
            }
            const cn = payload.current_node ?? payload.node;
            if (typeof cn === "string" && cn) {
              next.currentNode = cn;
            }
            break;
          }

          case "node.succeeded": {
            const nodeName = String(payload.node ?? "");
            const nodes = current.nodes.slice();
            const idx = nodes.findIndex((n) => n.name === nodeName);
            if (idx >= 0) {
              nodes[idx] = {
                ...nodes[idx],
                status: "succeeded",
                completedAt: ev.ts,
              };
            } else {
              nodes.push({
                name: nodeName,
                status: "succeeded",
                startedAt: null,
                completedAt: ev.ts,
              });
            }
            next.nodes = nodes;
            break;
          }

          case "node.failed": {
            const nodeName = String(payload.node ?? "");
            const errPayload = (payload.error as Record<string, unknown> | undefined) ?? null;
            const nodes = current.nodes.slice();
            const idx = nodes.findIndex((n) => n.name === nodeName);
            if (idx >= 0) {
              nodes[idx] = {
                ...nodes[idx],
                status: "failed",
                completedAt: ev.ts,
                error: errPayload,
              };
            } else {
              nodes.push({
                name: nodeName,
                status: "failed",
                startedAt: null,
                completedAt: ev.ts,
                error: errPayload,
              });
            }
            next.nodes = nodes;
            break;
          }

          case "run.succeeded":
            next.status = "succeeded";
            next.finalOutput = (payload.outputs as Record<string, unknown> | undefined) ?? null;
            next.completedAt = ev.ts || next.completedAt;
            next.progressPct = 100;
            break;

          case "run.failed":
            next.status = "failed";
            next.error = (payload.error as Record<string, unknown> | undefined) ?? null;
            next.completedAt = ev.ts || next.completedAt;
            break;

          case "run.cancelled":
            next.status = "cancelled";
            next.completedAt = ev.ts || next.completedAt;
            break;

          case "synthetic_terminal": {
            // Backend's belt-and-suspenders stream-close marker.
            // payload may include `status`; trust it as final source of truth if non-terminal.
            const finalStatus = payload.status as TaskState["status"] | undefined;
            if (
              finalStatus &&
              (finalStatus === "succeeded" ||
                finalStatus === "failed" ||
                finalStatus === "cancelled")
            ) {
              next.status = finalStatus;
            }
            break;
          }
        }

        return { ...prev, [runId]: next };
      });

      return (
        type === "run.succeeded" ||
        type === "run.failed" ||
        type === "run.cancelled" ||
        type === "synthetic_terminal"
      );
    },
    []
  );

  /**
   * Subscribe to the SSE stream for a single run. Recurses (with backoff) on
   * transient failures. Pass `since=lastSeq` to skip already-applied events.
   *
   * `attempt` is used only for backoff math; reset to 0 after any successful read.
   */
  const subscribe = useCallback(
    async (runId: number, kind: string, since: number, attempt = 0): Promise<void> => {
      // Already torn down — bail.
      if (!controllersRef.current.has(runId)) {
        const ctrl = new AbortController();
        controllersRef.current.set(runId, ctrl);
      }
      const controller = controllersRef.current.get(runId);
      if (!controller || controller.signal.aborted) return;

      const headers: Record<string, string> = { Accept: "text/event-stream" };
      if (typeof window !== "undefined") {
        const token = window.localStorage.getItem("ragent_token");
        if (token) headers.Authorization = `Bearer ${token}`;
      }

      const url = `/api/v1/workflow-runs/${runId}/events?since=${since}`;

      let reachedTerminal = false;
      let sawAnyData = false;
      let lastSeq = since;

      try {
        const resp = await fetch(url, {
          method: "GET",
          headers,
          signal: controller.signal,
          // Keep response open; no body to send.
          cache: "no-store",
        });

        if (!resp.ok || !resp.body) {
          throw new Error(`SSE upstream HTTP ${resp.status}`);
        }

        const reader = resp.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        try {
          while (true) {
            if (controller.signal.aborted) break;
            const { done, value } = await reader.read();
            if (done) break;

            sawAnyData = true;
            buffer += decoder.decode(value, { stream: true });

            // SSE events are separated by `\n\n`. Comments start with ':'.
            // We don't bother stripping single-newline tails for partial events,
            // we just parse complete frames.
            const frames = buffer.split("\n\n");
            buffer = frames.pop() ?? "";

            for (const frame of frames) {
              const trimmed = frame.trim();
              if (!trimmed) continue;
              // Heartbeat / comment frames start with ':'.
              if (trimmed.startsWith(":")) continue;

              let eventType: string | null = null;
              let dataLine = "";
              for (const rawLine of trimmed.split("\n")) {
                const line = rawLine.replace(/\r$/, "");
                if (line.startsWith("event:")) {
                  eventType = line.slice(6).trim();
                } else if (line.startsWith("data:")) {
                  dataLine += line.slice(5).trim();
                }
              }
              if (!dataLine) continue;

              let parsed: WorkflowEventPayload;
              try {
                parsed = JSON.parse(dataLine) as WorkflowEventPayload;
              } catch (e) {
                console.warn("[useTaskAttach] bad SSE data", dataLine, e);
                continue;
              }

              // Backend echoes the type into both the `event:` line and the JSON
              // `type` field; trust the JSON if mismatched.
              if (!parsed.type && eventType) {
                parsed.type = eventType as WorkflowEventType;
              }

              lastSeq = Math.max(lastSeq, parsed.seq ?? 0);
              if (applyEvent(runId, kind, parsed)) {
                reachedTerminal = true;
              }
            }

            if (reachedTerminal) {
              // Tear down on terminal — backend will close the stream too, but we
              // don't want to wait for the network FIN.
              break;
            }
          }
        } finally {
          try {
            reader.releaseLock();
          } catch {
            /* ignore */
          }
        }
      } catch (err) {
        if (controller.signal.aborted) return;
        const msg = err instanceof Error ? err.message : String(err);
        console.warn(`[useTaskAttach] run=${runId} stream error: ${msg}`);
      }

      // Cleanup or reconnect?
      if (controller.signal.aborted) return;

      if (reachedTerminal) {
        controllersRef.current.delete(runId);
        subscribedRef.current.delete(runId);
        return;
      }

      // Stream ended without terminal. Schedule a reconnect using the highest
      // seq we observed; backoff = min(2 * 2^attempt, 30) seconds.
      const backoffSec = Math.min(2 * 2 ** Math.min(attempt, 4), 30);
      const handle = setTimeout(() => {
        reconnectTimersRef.current.delete(runId);
        if (controller.signal.aborted) return;
        // Bump attempt only when we got nothing this round (true outage).
        const nextAttempt = sawAnyData ? 0 : attempt + 1;
        void subscribe(runId, kind, lastSeq, nextAttempt);
      }, backoffSec * 1000);
      reconnectTimersRef.current.set(runId, handle);
    },
    [applyEvent]
  );

  /**
   * Public attach API: idempotent per runId for the lifetime of this hook.
   * Called either from `attachRun(...)` (chat-side detected `_workflow_run_started`)
   * or from the initial `/active-workflow-runs` fetch effect.
   */
  const internalAttach = useCallback(
    (runId: number, kind: string, since: number) => {
      if (subscribedRef.current.has(runId)) return;
      subscribedRef.current.add(runId);
      const ctrl = new AbortController();
      controllersRef.current.set(runId, ctrl);

      // Seed minimal state so the UI shows the card immediately.
      setActiveRuns((prev) => {
        if (prev[runId]) return prev;
        return {
          ...prev,
          [runId]: {
            runId,
            kind,
            status: "queued",
            progressPct: null,
            currentNode: null,
            nodes: [],
            finalOutput: null,
            error: null,
            lastEventSeq: since,
            startedAt: null,
            completedAt: null,
          },
        };
      });

      void subscribe(runId, kind, since, 0);
    },
    [subscribe]
  );

  const attachRun = useCallback(
    (runId: number, kind: string) => {
      internalAttach(runId, kind, 0);
    },
    [internalAttach]
  );

  // On conversation change: tear down everything from the previous conversation
  // (including any terminal-state cards — they belong to that other chat and must
  // not leak across sessions), then fetch active runs for the new cid and resume.
  //
  // Exception: when the cid transitions from null/undefined/"" → real value (the
  // "first attach" path during fresh-chat bootstrap), we keep any in-memory runs
  // that were just attached via `attachRun()` from the chat token-stream marker.
  useEffect(() => {
    const prevCid = lastBootstrappedCidRef.current;
    const cidIsEmpty =
      conversationId === null || conversationId === undefined || conversationId === "";
    const isFirstAttach = prevCid === null && !cidIsEmpty;

    if (!isFirstAttach) {
      // Real switch (A → B, A → null, or initial mount with cid=null): abort
      // every in-flight stream + reconnect timer, then wipe in-memory state so
      // the previous conversation's cards (including terminal ones) don't leak.
      tearDownAll();
      setActiveRuns({});
    }

    if (cidIsEmpty) {
      lastBootstrappedCidRef.current = null;
      return;
    }

    lastBootstrappedCidRef.current = conversationId;

    let cancelled = false;
    const headers: Record<string, string> = { Accept: "application/json" };
    if (typeof window !== "undefined") {
      const token = window.localStorage.getItem("ragent_token");
      if (token) headers.Authorization = `Bearer ${token}`;
    }

    fetch(`/api/v1/conversations/${conversationId}/active-workflow-runs`, { headers })
      .then(async (resp) => {
        if (!resp.ok) {
          console.warn(
            `[useTaskAttach] active-workflow-runs HTTP ${resp.status}`,
            await resp.text().catch(() => "")
          );
          return [] as ActiveWorkflowRunEntry[];
        }
        return (await resp.json()) as ActiveWorkflowRunEntry[];
      })
      .then((rows) => {
        if (cancelled || !Array.isArray(rows)) return;
        for (const row of rows) {
          internalAttach(row.id, row.kind, row.last_event_seq || 0);
        }
      })
      .catch((err) => {
        console.warn("[useTaskAttach] active-workflow-runs fetch failed", err);
      });

    return () => {
      cancelled = true;
    };
    // We only want this to fire on conversation switches.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversationId]);

  // On unmount: abort everything.
  useEffect(() => {
    return () => {
      tearDownAll();
    };
  }, [tearDownAll]);

  const cancelRun = useCallback(async (runId: number) => {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (typeof window !== "undefined") {
      const token = window.localStorage.getItem("ragent_token");
      if (token) headers.Authorization = `Bearer ${token}`;
    }
    try {
      await fetch(`/api/v1/workflow-runs/${runId}/cancel`, {
        method: "POST",
        headers,
      });
    } catch (err) {
      console.warn("[useTaskAttach] cancel failed", err);
    }
    // We do *not* mutate state here; wait for the run.cancelled event over SSE.
  }, []);

  return { activeRuns, attachRun, cancelRun };
}
