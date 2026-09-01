"use client";
import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { ChevronDown, ChevronRight, Check, X, Loader2 } from "lucide-react";

export interface ToolStep {
  /** Stable identity within a turn. Backend has no per-call id on these frames,
   *  so we mint one — two calls to the same tool must not collapse into one row. */
  id: number;
  label: string;
  /** 模型自报的这一步目的。有就跟在名称后，让「一连串飞书套件」变得可读 */
  purpose?: string;
  /** 实际执行的命令行。与 purpose 并列显示——自报意图和实际行为可能不符，
   *  只给前者就成了单方面的说法，用户没有地方能看出来 */
  detail?: string;
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
  // 哪几步被点开看命令。默认全收 —— 命令行是给排查用的，
  // 平时摊在行里既没人看，又把标签挤到换行（"飞书 套件" 断成两行）。
  const [openDetails, setOpenDetails] = useState<Set<number>>(new Set());
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
              const open = openDetails.has(s.id);
              const toggle = () =>
                setOpenDetails((prev) => {
                  const next = new Set(prev);
                  if (next.has(s.id)) next.delete(s.id);
                  else next.add(s.id);
                  return next;
                });
              return (
                <div key={s.id}>
                  {/* 有命令才做成按钮：没有可展开内容的行不该有点击反馈 */}
                  {(() => {
                    const row = (
                      <>
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
                        {s.purpose && (
                          <span className="text-muted-foreground/80">（{s.purpose}）</span>
                        )}
                        {/* A step that finishes instantly needs no duration; one that
                            runs for minutes is exactly where the user is looking. */}
                        {dur >= 1000 && (
                          <span className="tabular-nums text-muted-foreground/70">
                            {fmt(dur)}
                          </span>
                        )}
                        {s.detail && (
                          <ChevronRight
                            className={`h-3 w-3 shrink-0 text-muted-foreground/50 transition-transform ${
                              open ? "rotate-90" : ""
                            }`}
                          />
                        )}
                      </>
                    );
                    return s.detail ? (
                      <button
                        type="button"
                        onClick={toggle}
                        aria-expanded={open}
                        className="flex w-full items-center gap-1.5 text-left"
                      >
                        {row}
                      </button>
                    ) : (
                      <div className="flex items-center gap-1.5">{row}</div>
                    );
                  })()}
                  {open && s.detail && (
                    // 独占一行并允许换行：命令可能很长，截断了就失去了排查价值
                    <code className="mt-0.5 ml-[18px] block whitespace-pre-wrap break-all font-mono text-[11px] text-muted-foreground/60">
                      {s.detail}
                    </code>
                  )}
                </div>
              );
          })}
        </div>
      )}
    </div>
  );
}
