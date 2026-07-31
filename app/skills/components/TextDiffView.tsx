"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { ChevronDown, ChevronUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  diffHunkStarts,
  diffTexts,
  groupDiffRows,
  type DiffRow,
  type DiffRowType,
} from "@/lib/textDiff";

interface TextDiffViewProps {
  /** 左栏 = 旧版本（已发布） */
  left: string;
  /** 右栏 = 新版本（草稿） */
  right: string;
  leftLabel: string;
  rightLabel: string;
  /** 滚动区高度，长正文与资产片段用不同值 */
  maxHeightClass?: string;
}

/** 颜色之外的第二重信号：行号列的标记字符 */
const ROW_MARKER: Record<DiffRowType, string> = {
  equal: "",
  add: "+",
  remove: "-",
  modify: "~",
};

const GUTTER_BASE =
  "flex items-start justify-end gap-1 px-1.5 py-0.5 tabular-nums select-none border-r border-border/60 text-[10px] leading-5";

const TEXT_BASE = "px-2 py-0.5 min-h-[1.25rem] leading-5 whitespace-pre-wrap break-words";

function sideTone(row: DiffRow, side: "left" | "right"): string {
  if (row.type === "modify") return "bg-amber-500/10 text-amber-900 dark:text-amber-200";
  if (row.type === "remove") {
    return side === "left"
      ? "bg-red-500/10 text-red-900 dark:text-red-200"
      : "bg-muted/40 text-muted-foreground";
  }
  if (row.type === "add") {
    return side === "right"
      ? "bg-emerald-500/10 text-emerald-900 dark:text-emerald-200"
      : "bg-muted/40 text-muted-foreground";
  }
  return "";
}

/** 行内高亮：比行底色更深 + 下划线，不依赖颜色也能看出边界 */
const SEGMENT_TONE = {
  remove:
    "bg-red-500/30 underline decoration-red-700 dark:decoration-red-300 decoration-2 underline-offset-2 rounded-[2px]",
  add: "bg-emerald-500/30 underline decoration-emerald-700 dark:decoration-emerald-300 decoration-2 underline-offset-2 rounded-[2px]",
} as const;

function LineContent({ row, side }: { row: DiffRow; side: "left" | "right" }) {
  const text = side === "left" ? row.leftText : row.rightText;
  if (text === null) return null;
  if (row.type !== "modify" || !row.segments) return <>{text}</>;
  const dropped = side === "left" ? "add" : "remove";
  return (
    <>
      {row.segments.map((segment, index) => {
        if (segment.type === dropped) return null;
        const key = `${index}-${segment.type}`;
        if (segment.type === "equal") return <span key={key}>{segment.text}</span>;
        return (
          <mark key={key} className={`text-inherit ${SEGMENT_TONE[segment.type]}`}>
            {segment.text}
          </mark>
        );
      })}
    </>
  );
}

/**
 * 草稿 vs 已发布的并排 diff（左=已发布，右=草稿，与通用 diff 工具的新旧方位一致）。
 * 行级 + 字符级标注由 lib/textDiff 计算；这里只负责对齐渲染、折叠与改动跳转。
 */
export default function TextDiffView({
  left,
  right,
  leftLabel,
  rightLabel,
  maxHeightClass = "max-h-[45vh]",
}: TextDiffViewProps) {
  const t = useTranslations("skills");
  const scrollRef = useRef<HTMLDivElement>(null);
  const rowRefs = useRef(new Map<number, HTMLDivElement>());
  const [expanded, setExpanded] = useState<ReadonlySet<number>>(new Set());
  const [activeHunk, setActiveHunk] = useState(0);

  const { rows, stats, degraded } = useMemo(() => diffTexts(left, right), [left, right]);
  const groups = useMemo(() => groupDiffRows(rows), [rows]);
  const hunks = useMemo(() => diffHunkStarts(rows), [rows]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: rows 变化即内容换了一份，折叠与导航状态必须重置
  useEffect(() => {
    setExpanded(new Set());
    setActiveHunk(0);
    rowRefs.current.clear();
  }, [rows]);

  const jumpTo = useCallback(
    (index: number) => {
      if (hunks.length === 0) return;
      const next = ((index % hunks.length) + hunks.length) % hunks.length;
      setActiveHunk(next);
      rowRefs.current.get(hunks[next])?.scrollIntoView({ block: "nearest" });
      // 把焦点交回对照区，点完按钮就能接着用 n / p
      scrollRef.current?.focus({ preventScroll: true });
    },
    [hunks]
  );

  useEffect(() => {
    const node = scrollRef.current;
    if (!node || hunks.length === 0) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (event.key === "n") {
        event.preventDefault();
        jumpTo(activeHunk + 1);
      } else if (event.key === "p") {
        event.preventDefault();
        jumpTo(activeHunk - 1);
      }
    };
    node.addEventListener("keydown", onKeyDown);
    return () => node.removeEventListener("keydown", onKeyDown);
  }, [activeHunk, hunks, jumpTo]);

  const toggleGroup = (startIndex: number) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(startIndex)) next.delete(startIndex);
      else next.add(startIndex);
      return next;
    });
  };

  const renderRow = (row: DiffRow, index: number) => {
    const isActive = hunks[activeHunk] === index && row.type !== "equal";
    const activeRing = isActive ? "ring-1 ring-inset ring-primary" : "";
    const marker = ROW_MARKER[row.type];
    const markerTitle =
      row.type === "add"
        ? t("diffRowAdded")
        : row.type === "remove"
          ? t("diffRowRemoved")
          : row.type === "modify"
            ? t("diffRowModified")
            : undefined;
    return (
      <div key={`row-${index}`} className="contents">
        <div
          ref={(node) => {
            if (node) rowRefs.current.set(index, node);
            else rowRefs.current.delete(index);
          }}
          className={`${GUTTER_BASE} ${sideTone(row, "left")} ${activeRing}`}
          title={markerTitle}
        >
          <span>{row.leftLineNo ?? ""}</span>
          <span className="w-2 text-center font-bold">{row.leftText === null ? "" : marker}</span>
        </div>
        <div className={`${TEXT_BASE} ${sideTone(row, "left")} ${activeRing}`}>
          <LineContent row={row} side="left" />
        </div>
        <div className={`${GUTTER_BASE} border-l ${sideTone(row, "right")} ${activeRing}`}>
          <span>{row.rightLineNo ?? ""}</span>
          <span className="w-2 text-center font-bold">{row.rightText === null ? "" : marker}</span>
        </div>
        <div className={`${TEXT_BASE} ${sideTone(row, "right")} ${activeRing}`}>
          <LineContent row={row} side="right" />
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
        {stats.hasChanges ? (
          <span className="flex items-center gap-2 font-medium">
            <span className="text-emerald-600 dark:text-emerald-400">
              {t("diffStatAdded", { count: stats.added })}
            </span>
            <span className="text-red-600 dark:text-red-400">
              {t("diffStatRemoved", { count: stats.removed })}
            </span>
            <span className="text-amber-600 dark:text-amber-400">
              {t("diffStatModified", { count: stats.modified })}
            </span>
          </span>
        ) : (
          <span className="font-medium text-muted-foreground">{t("diffNoChanges")}</span>
        )}
        {degraded && <span className="text-muted-foreground">{t("diffDegradedNotice")}</span>}
        {hunks.length > 0 && (
          <span className="ml-auto flex items-center gap-1">
            <span className="text-muted-foreground tabular-nums">
              {t("diffChangePosition", { index: activeHunk + 1, total: hunks.length })}
            </span>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-6 w-6 p-0"
              aria-label={t("diffPrevChange")}
              title={t("diffPrevChange")}
              onClick={() => jumpTo(activeHunk - 1)}
            >
              <ChevronUp className="h-3.5 w-3.5" />
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-6 w-6 p-0"
              aria-label={t("diffNextChange")}
              title={t("diffNextChange")}
              onClick={() => jumpTo(activeHunk + 1)}
            >
              <ChevronDown className="h-3.5 w-3.5" />
            </Button>
          </span>
        )}
      </div>

      {rows.length === 0 ? (
        <p className="text-xs text-muted-foreground bg-muted rounded-md p-3">{t("diffEmpty")}</p>
      ) : (
        <section
          ref={scrollRef}
          // biome-ignore lint/a11y/noNoninteractiveTabindex: 可滚动区域必须可键盘聚焦（WCAG 2.1.1），并承载 n/p 跳转
          tabIndex={0}
          aria-label={t("diffKeyboardHint")}
          className={`rounded-md border overflow-auto ${maxHeightClass} focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring`}
        >
          <div className="grid grid-cols-[auto_minmax(0,1fr)_auto_minmax(0,1fr)] text-xs font-mono">
            <div className="col-span-2 sticky top-0 z-10 bg-muted px-2 py-1 text-[11px] font-sans font-medium border-b">
              {leftLabel}
            </div>
            <div className="col-span-2 sticky top-0 z-10 bg-muted px-2 py-1 text-[11px] font-sans font-medium border-b border-l">
              {rightLabel}
            </div>
            {groups.map((group) =>
              group.type === "visible" ? (
                <div key={`g-${group.startIndex}`} className="contents">
                  {group.rows.map((row, offset) => renderRow(row, group.startIndex + offset))}
                </div>
              ) : (
                <div key={`g-${group.startIndex}`} className="contents">
                  <button
                    type="button"
                    onClick={() => toggleGroup(group.startIndex)}
                    className="col-span-4 border-y bg-muted/40 px-3 py-1 text-left text-[11px] font-sans text-muted-foreground hover:bg-muted hover:text-foreground"
                  >
                    {expanded.has(group.startIndex)
                      ? t("diffCollapseAgain")
                      : t("diffExpandCollapsed", { count: group.rows.length })}
                  </button>
                  {expanded.has(group.startIndex) &&
                    group.rows.map((row, offset) => renderRow(row, group.startIndex + offset))}
                </div>
              )
            )}
          </div>
        </section>
      )}
    </div>
  );
}
