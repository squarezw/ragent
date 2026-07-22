"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { ChevronDown } from "lucide-react";
import type { LogLevel, LogSource, ObserveLogItem, OrderState } from "./types";
import { formatDateTimeSeconds } from "./time";

const LEVEL_STYLE: Record<LogLevel, string> = {
  debug: "bg-slate-100 text-slate-600",
  info: "bg-blue-50 text-blue-700",
  warn: "bg-amber-100 text-amber-800",
  error: "bg-red-100 text-red-700",
};

const SOURCE_STYLE: Record<LogSource, string> = {
  "file-agent": "bg-cyan-50 text-cyan-700 border-cyan-200",
  "baidu-agent": "bg-purple-50 text-purple-700 border-purple-200",
  "preview-agent": "bg-emerald-50 text-emerald-700 border-emerald-200",
  system: "bg-slate-50 text-slate-600 border-slate-200",
};

interface LogsPanelProps {
  selectedPhase: OrderState | null;
  logs: ObserveLogItem[];
  errorOnly: boolean;
  onErrorOnlyChange: (v: boolean) => void;
  hasMore: boolean;
  onLoadMore: () => void;
  loading?: boolean;
}

export function LogsPanel({
  selectedPhase,
  logs,
  errorOnly,
  onErrorOnlyChange,
  hasMore,
  onLoadMore,
  loading,
}: LogsPanelProps) {
  const t = useTranslations("zdObserve");

  if (!selectedPhase) {
    return (
      <div className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
        {t("logs.selectNodePrompt")}
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-semibold">
          {t("logs.title")} · {t(`states.${selectedPhase}` as never)}
        </h4>
        <label
          htmlFor="observe-error-only"
          className="flex items-center gap-2 text-xs text-muted-foreground"
        >
          {t("logs.errorOnly")}
          <Switch id="observe-error-only" checked={errorOnly} onCheckedChange={onErrorOnlyChange} />
        </label>
      </div>

      <div className="divide-y">
        {logs.map((log) => (
          <LogRow key={log.id} log={log} />
        ))}
        {logs.length === 0 && (
          <div className="py-6 text-center text-sm text-muted-foreground">
            {loading ? "…" : t("logs.empty")}
          </div>
        )}
      </div>

      {hasMore && (
        <div className="text-center">
          <Button variant="outline" size="sm" onClick={onLoadMore} disabled={loading}>
            {t("logs.loadMore")}
          </Button>
        </div>
      )}
    </div>
  );
}

function LogRow({ log }: { log: ObserveLogItem }) {
  const t = useTranslations("zdObserve");
  const [open, setOpen] = useState(false);
  // 之前直接 slice ISO 串，展示的是 UTC 时间（比东八区慢 8 小时）；统一走东八区格式化
  const time = formatDateTimeSeconds(log.emittedAt || log.createdAt);
  const isError = log.level === "error";

  return (
    <div className="py-2 text-sm first:pt-0 last:pb-0">
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-xs text-muted-foreground tabular-nums">{time}</span>
        <Badge variant="outline" className={`text-[11px] ${SOURCE_STYLE[log.source]}`}>
          {t(`logs.sources.${log.source}` as never)}
        </Badge>
        <Badge className={`text-[11px] ${LEVEL_STYLE[log.level]}`}>
          {t(`logs.levels.${log.level}` as never)}
        </Badge>
        <span className={`flex-1 ${isError ? "text-red-700 font-medium" : ""}`}>{log.message}</span>
        {log.detail && Object.keys(log.detail).length > 0 && (
          <button
            type="button"
            onClick={() => setOpen((o) => !o)}
            className="flex items-center gap-0.5 text-[11px] text-muted-foreground hover:text-foreground"
          >
            {t("logs.viewDetail")}
            <ChevronDown className={`h-3 w-3 transition-transform ${open ? "rotate-180" : ""}`} />
          </button>
        )}
      </div>
      {open && log.detail && (
        <pre className="mt-1.5 max-h-48 overflow-auto whitespace-pre-wrap break-all rounded bg-muted/50 p-2 text-xs">
          {JSON.stringify(log.detail, null, 2)}
        </pre>
      )}
    </div>
  );
}
