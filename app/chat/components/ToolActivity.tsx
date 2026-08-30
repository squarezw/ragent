"use client";
import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { ChevronDown, ChevronRight, Check, X, Loader2 } from "lucide-react";

export interface ToolStep {
  /** Stable identity within a turn. Backend has no per-call id on these frames,
   *  so we mint one — two calls to the same tool must not collapse into one row. */
  id: number;
  label: string;
  /** undefined while running; true/false once the finished frame arrives. */
  ok?: boolean;
  startedAt: number;
  endedAt?: number;
}

/** Wall-clock, formatted the way a person reads it: 45s, 3m51s. */
function fmt(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return m > 0 ? `${m}m${String(s).padStart(2, "0")}s` : `${s}s`;
}

/**
 * The tool calls of one turn, as a list.
 *
 * Before this, each `tool_status` frame replaced the whole indicator — a turn
 * that called five tools showed only the fifth, and the first four left no
 * trace. The frames were always there; the UI was throwing them away.
 *
 * Expanded while the turn is running, so the user can see it is alive and which
 * step it is on. Collapsed once finished, because by then the answer is the
 * thing worth reading — collapsed rather than removed, since "what did it
 * actually do" is exactly the question asked when a result looks wrong.
 */
export default function ToolActivity({
  steps,
  running,
}: {
  steps: ToolStep[];
  running: boolean;
}) {
  const t = useTranslations("chat");
  // Follows `running`, but only as the initial value per turn — a user who
  // collapses it mid-run should not have it spring open again on the next frame.
  const [expanded, setExpanded] = useState(true);
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [running]);

  useEffect(() => {
    if (!running) setExpanded(false);
  }, [running]);

  if (steps.length === 0) return null;

  const first = steps[0];
  const last = steps[steps.length - 1];
  const total = (running ? now : (last.endedAt ?? now)) - first.startedAt;
  const anyFailed = steps.some((s) => s.ok === false);

  return (
    <div data-testid="tool-activity" className="text-xs">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="flex items-center gap-1.5 text-muted-foreground hover:text-foreground"
      >
        {expanded ? (
          <ChevronDown className="h-3 w-3 shrink-0" />
        ) : (
          <ChevronRight className="h-3 w-3 shrink-0" />
        )}
        <span className={anyFailed ? "text-destructive" : undefined}>
          {running ? t("activityRunning") : t("activityDone")}
        </span>
        <span className="tabular-nums">{fmt(total)}</span>
      </button>

      {expanded && (
        <div className="mt-1 space-y-1 border-l pl-3 ml-1.5">
          {steps.map((s) => {
            const dur = (s.endedAt ?? now) - s.startedAt;
            return (
              <div key={s.id} className="flex items-center gap-1.5">
                {s.ok === undefined ? (
                  <Loader2 className="h-3 w-3 shrink-0 animate-spin text-muted-foreground" />
                ) : s.ok ? (
                  <Check className="h-3 w-3 shrink-0 text-emerald-600" />
                ) : (
                  <X className="h-3 w-3 shrink-0 text-destructive" />
                )}
                <span
                  className={
                    s.ok === false ? "text-destructive" : "text-muted-foreground"
                  }
                >
                  {s.label}
                </span>
                {/* A step that finishes instantly needs no duration; one that
                    runs for minutes is exactly where the user is looking. */}
                {dur >= 1000 && (
                  <span className="tabular-nums text-muted-foreground/70">{fmt(dur)}</span>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
