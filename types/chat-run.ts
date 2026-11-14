export type ChatRunStatus =
  | "queued"
  | "running"
  | "stopping"
  | "completed"
  | "cancelled"
  | "failed"
  | "interrupted";
export interface ChatRunSnapshot {
  run_id: string;
  session_id: string;
  detail_id: number;
  app_id: number | null;
  status: ChatRunStatus;
  cursor: number;
  answer: string;
  tool_steps: Record<string, unknown>[];
  pending_confirmations: Record<string, unknown>[];
  usage: Record<string, unknown> | null;
  result: Record<string, unknown> | null;
  error: { message: string; code: string } | null;
  updated_at: string;
}
