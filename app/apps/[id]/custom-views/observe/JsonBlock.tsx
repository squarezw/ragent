"use client";

import { useMemo, useState } from "react";
import { ChevronDown } from "lucide-react";

/**
 * 「查看 JSON 原文」折叠块：原始外部 JSON 较长，默认折叠，点开才整段展示。
 * 出入参面板的 OA 入参与预审报告弹窗的预审原始 JSON 共用同一交互。
 */
export function JsonBlock({ value, label }: { value: unknown; label: string }) {
  const [open, setOpen] = useState(false);
  // 原始报告可能很大，避免展开后每次重渲染都重新序列化
  const json = useMemo(() => JSON.stringify(value, null, 2), [value]);
  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
      >
        {label}
        <ChevronDown className={`h-3 w-3 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <pre className="mt-1 max-h-64 overflow-auto whitespace-pre-wrap break-all rounded-md border bg-muted/40 p-2 text-xs">
          {json}
        </pre>
      )}
    </div>
  );
}
