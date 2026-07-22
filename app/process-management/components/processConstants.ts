// Shared style constants for process management components

export const levelBadgeStyles: Record<number, string> = {
  1: "bg-blue-500/20 text-blue-400 border-blue-500/30",
  2: "bg-blue-400/15 text-blue-300 border-blue-400/25",
  3: "bg-blue-300/10 text-blue-200 border-blue-300/20",
};

export const docStatusStyles: Record<string, string> = {
  draft: "bg-gray-500/15 text-gray-400 border-gray-500/25",
  reviewing: "bg-amber-500/15 text-amber-400 border-amber-500/25",
  approved: "bg-green-500/15 text-green-400 border-green-500/25",
  offline: "bg-gray-500/15 text-gray-400 border-gray-500/25",
  revising: "bg-blue-500/15 text-blue-400 border-blue-500/25",
};

const ACTIVE_SESSION_STATUSES = new Set(["pending", "running", "queued"]);

export function isActiveSessionStatus(status: string): boolean {
  return ACTIVE_SESSION_STATUSES.has(status);
}

export const sessionCardStyles: Record<string, string> = {
  queued: "border-blue-500/30 bg-blue-500/5",
  pending: "border-amber-500/30 bg-amber-500/5",
  running: "border-amber-500/30 bg-amber-500/5",
  failed: "border-red-500/30 bg-red-500/5",
  completed: "border-green-500/30 bg-green-500/5",
};

export function formatFileSize(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${Math.floor(bytes / k ** i)} ${sizes[i]}`;
}
