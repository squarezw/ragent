/**
 * Workflow run type definitions — Stage 3b (long-task subsystem).
 *
 * Mirrors the backend contract:
 *   `/Users/zhaowei/Documents/SuperAgent/runs/2026-05-10-ragent-service-long-task-subsystem/api-contract.md`
 *
 * Endpoints covered:
 *   GET    /api/v1/workflow-runs/:id
 *   GET    /api/v1/workflow-runs/:id/events    (SSE)
 *   POST   /api/v1/workflow-runs/:id/cancel
 *   GET    /api/v1/conversations/:cid/active-workflow-runs
 */

export type WorkflowRunStatus = "queued" | "running" | "succeeded" | "failed" | "cancelled";

export type WorkflowNodeStatus = "queued" | "running" | "succeeded" | "failed";

/** GET /workflow-runs/:id response */
export interface WorkflowRunDetail {
  id: number;
  kind: string;
  status: WorkflowRunStatus;
  progress_pct: number | null;
  current_node: string | null;
  started_at: string | null;
  completed_at: string | null;
  outputs: Record<string, unknown>;
  error: Record<string, unknown>;
  recent_nodes: Array<{
    node_index: number;
    node_name: string;
    status: WorkflowNodeStatus;
    elapsed_ms: number | null;
    started_at: string | null;
    completed_at: string | null;
  }>;
}

/** GET /conversations/:cid/active-workflow-runs entry */
export interface ActiveWorkflowRunEntry {
  id: number;
  kind: string;
  status: WorkflowRunStatus;
  progress_pct: number | null;
  started_at: string | null;
  last_event_seq: number;
}

/** All possible SSE event types (matches backend `EventType`). */
export type WorkflowEventType =
  | "run.queued"
  | "run.started"
  | "node.started"
  | "node.progress"
  | "node.succeeded"
  | "node.failed"
  | "run.succeeded"
  | "run.failed"
  | "run.cancelled"
  | "synthetic_terminal";

/** Generic SSE event envelope (matches backend `WorkflowEvent`). */
export interface WorkflowEventPayload {
  run_id: number;
  seq: number;
  type: WorkflowEventType;
  payload: Record<string, unknown>;
  ts: string;
}

/** Client-side aggregated state for a single run (one per runId). */
export interface TaskNode {
  name: string;
  status: WorkflowNodeStatus;
  startedAt: string | null;
  completedAt: string | null;
  error?: Record<string, unknown> | null;
}

export interface TaskState {
  runId: number;
  kind: string;
  status: WorkflowRunStatus;
  progressPct: number | null;
  currentNode: string | null;
  nodes: TaskNode[];
  /** `run.succeeded` payload.outputs */
  finalOutput: Record<string, unknown> | null;
  /** `run.failed` payload.error */
  error: Record<string, unknown> | null;
  /** Highest `seq` observed; reconnect resumes with `?since=lastEventSeq`. */
  lastEventSeq: number;
  /** Server timestamps */
  startedAt: string | null;
  completedAt: string | null;
}
