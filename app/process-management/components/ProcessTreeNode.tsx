"use client";

import { memo } from "react";
import { useTranslations } from "next-intl";
import { ChevronRight } from "lucide-react";
import type { ProcessNode } from "../types/process";
import { cn } from "@/lib/utils";
import { levelBadgeStyles } from "./processConstants";

interface ProcessTreeNodeProps {
  node: ProcessNode;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onToggle: (id: string) => void;
  depth: number;
  searchQuery: string;
}

function HighlightText({ text, query }: { text: string; query: string }) {
  if (!query) return <>{text}</>;
  const idx = text.toLowerCase().indexOf(query.toLowerCase());
  if (idx === -1) return <>{text}</>;
  return (
    <>
      {text.slice(0, idx)}
      <mark className="bg-yellow-200 dark:bg-yellow-900/60 text-inherit rounded-sm px-0.5">
        {text.slice(idx, idx + query.length)}
      </mark>
      {text.slice(idx + query.length)}
    </>
  );
}

const ProcessTreeNode = memo(function ProcessTreeNode({
  node,
  selectedId,
  onSelect,
  onToggle,
  depth,
  searchQuery,
}: ProcessTreeNodeProps) {
  const t = useTranslations("processManagement");
  const isExpanded = node._expanded !== false;
  const hasChildren = node.children && node.children.length > 0;
  const isSelected = selectedId === node.id;
  const isCategory = node.type === "category" || node.level === 0;

  return (
    <div>
      <div
        className={cn(
          "flex items-center gap-1.5 py-1.5 px-2 cursor-pointer rounded-md transition-colors group",
          "hover:bg-muted/50",
          isSelected && "bg-muted border-l-2 border-l-blue-500",
          !isSelected && "border-l-2 border-l-transparent",
        )}
        style={{ paddingLeft: `${depth * 20 + 8}px` }}
        onClick={() => {
          if (!isCategory) {
            onSelect(node.id);
          }
          if (hasChildren) {
            onToggle(node.id);
          }
        }}
      >
        {/* Expand/Collapse Chevron */}
        <span
          className="flex-shrink-0 w-4 h-4 flex items-center justify-center"
          onClick={(e) => {
            if (hasChildren) {
              e.stopPropagation();
              onToggle(node.id);
            }
          }}
        >
          {hasChildren && (
            <ChevronRight
              className={cn(
                "h-3.5 w-3.5 text-muted-foreground transition-transform duration-200",
                isExpanded && "rotate-90"
              )}
            />
          )}
        </span>

        {/* Level Badge */}
        {!isCategory && node.level >= 1 && node.level <= 3 && (
          <span
            className={cn(
              "flex-shrink-0 text-[10px] font-semibold px-1.5 py-0.5 rounded border",
              levelBadgeStyles[node.level] || levelBadgeStyles[1]
            )}
          >
            L{node.level}
          </span>
        )}

        {/* Node Name */}
        <span
          className={cn(
            "truncate text-sm",
            isCategory
              ? "font-bold text-foreground uppercase tracking-wide text-xs"
              : "text-muted-foreground group-hover:text-foreground",
            isSelected && !isCategory && "text-foreground font-medium"
          )}
        >
          <HighlightText text={node.name} query={searchQuery} />
        </span>
      </div>

      {/* Children */}
      {hasChildren && isExpanded && (
        <div className="relative">
          {/* Vertical guide line */}
          {!isCategory && (
            <div
              className="absolute top-0 bottom-2 border-l border-border/40"
              style={{ left: `${(depth + 1) * 20 + 14}px` }}
            />
          )}
          {node.children.map((child) => (
            <ProcessTreeNode
              key={child.id}
              node={child}
              selectedId={selectedId}
              onSelect={onSelect}
              onToggle={onToggle}
              depth={depth + 1}
              searchQuery={searchQuery}
            />
          ))}
        </div>
      )}
    </div>
  );
});

export default ProcessTreeNode;
