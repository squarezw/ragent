"use client";

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { Layers, Grid3X3, LayoutGrid, Hash, Plus, Trash2 } from "lucide-react";
import type { ProcessNode } from "../types/process";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { checkSuperAdmin } from "@/lib/clientPermissions";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import L3DetailModal from "./L3DetailModal";

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function countNodes(nodes: ProcessNode[]) {
  let l1 = 0,
    l2 = 0,
    l3 = 0;
  function walk(list: ProcessNode[]) {
    for (const n of list) {
      if (n.level === 1) l1++;
      else if (n.level === 2) l2++;
      else if (n.level === 3) l3++;
      if (n.children) walk(n.children);
    }
  }
  walk(nodes);
  return { l1, l2, l3, total: l1 + l2 + l3 };
}

function collectL1(nodes: ProcessNode[]): ProcessNode[] {
  const result: ProcessNode[] = [];
  for (const cat of nodes) {
    if (cat.children) {
      for (const child of cat.children) {
        if (child.level === 1) result.push(child);
      }
    }
  }
  return result;
}

/* ------------------------------------------------------------------ */
/*  Main Component                                                     */
/* ------------------------------------------------------------------ */

interface ProcessArchitectureTabProps {
  onBack?: () => void;
  tree?: ProcessNode[];
  onSelectNode?: (nodeId: string) => void;
  onAddChild?: (parent: ProcessNode) => void;
  onDeleteNode?: (node: ProcessNode) => void;
}

export function countDocumentsRecursive(node: ProcessNode): number {
  let total = node.document_count ?? 0;
  if (node.children) {
    for (const child of node.children) {
      total += countDocumentsRecursive(child);
    }
  }
  return total;
}

export default function ProcessArchitectureTab({
  onBack,
  tree: treeProp,
  onSelectNode,
  onAddChild,
  onDeleteNode,
}: ProcessArchitectureTabProps) {
  const t = useTranslations("processManagement");
  const tc = useTranslations("common");
  const { user } = useCurrentUser();
  const isSuperAdmin = checkSuperAdmin(user);

  const [activeCategory, setActiveCategory] = useState<string>("all");
  const [activeL1, setActiveL1] = useState<string | null>(null);
  const [detailNode, setDetailNode] = useState<ProcessNode | null>(null);

  const treeData = treeProp ?? [];

  /* Stats from full data */
  const stats = useMemo(() => countNodes(treeData), [treeData]);

  /* Filtered categories */
  const filteredCategories = useMemo(() => {
    if (activeCategory === "all") return treeData;
    return treeData.filter((cat) => cat.id === activeCategory);
  }, [activeCategory, treeData]);

  /* All L1 nodes for the pill selector (from filtered categories) */
  const l1Nodes = useMemo(() => collectL1(filteredCategories), [filteredCategories]);

  /* Visible L1 nodes after L1 filter */
  const visibleL1 = useMemo(() => {
    if (!activeL1) return l1Nodes;
    return l1Nodes.filter((n) => n.id === activeL1);
  }, [l1Nodes, activeL1]);

  /* Category tabs — dynamically built from tree data */
  const categoryTabs = useMemo(() => {
    const tabs: { key: string; label: string }[] = [{ key: "all", label: t("architecture.all") }];
    for (const cat of treeData) {
      if (cat.level === 0 || cat.type === "category") {
        tabs.push({ key: cat.id, label: cat.name });
      }
    }
    return tabs;
  }, [treeData, t]);

  /* Stat badges config */
  const statBadges = [
    {
      icon: Layers,
      label: t("architecture.statsL1"),
      value: stats.l1,
      color: "bg-teal-100 text-teal-800 dark:bg-teal-900 dark:text-teal-200",
    },
    {
      icon: Grid3X3,
      label: t("architecture.statsL2"),
      value: stats.l2,
      color: "bg-sky-100 text-sky-800 dark:bg-sky-900 dark:text-sky-200",
    },
    {
      icon: LayoutGrid,
      label: t("architecture.statsL3"),
      value: stats.l3,
      color: "bg-violet-100 text-violet-800 dark:bg-violet-900 dark:text-violet-200",
    },
    {
      icon: Hash,
      label: t("architecture.statsTotal"),
      value: stats.total,
      color: "bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200",
    },
  ];

  return (
    <div className="space-y-6 p-6">
      {/* ---- Header ---- */}
      <div>
        <h2 className="text-xl font-semibold">{t("architecture.title")}</h2>
        <p className="text-sm text-muted-foreground mt-1">{t("architecture.subtitle")}</p>
      </div>

      {/* ---- Stats row ---- */}
      <div className="flex flex-wrap gap-3">
        {statBadges.map((s) => (
          <span
            key={s.label}
            className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium ${s.color}`}
          >
            <s.icon className="h-3.5 w-3.5" />
            {s.label}: {s.value}
          </span>
        ))}
      </div>

      {/* ---- Category tabs ---- */}
      <div className="flex gap-2">
        {categoryTabs.map((tab) => (
          <button
            key={tab.key}
            type="button"
            onClick={() => {
              setActiveCategory(tab.key);
              setActiveL1(null);
            }}
            className={`rounded-md px-4 py-1.5 text-sm font-medium transition-colors ${
              activeCategory === tab.key
                ? "bg-primary text-primary-foreground shadow-sm"
                : "bg-muted text-muted-foreground hover:bg-muted/80"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* ---- L1 selector pills ---- */}
      <div className="flex gap-2 overflow-x-auto pb-1">
        <button
          type="button"
          onClick={() => setActiveL1(null)}
          className={`shrink-0 rounded-full px-3 py-1 text-xs font-medium border transition-colors ${
            activeL1 === null
              ? "border-teal-500 bg-teal-50 text-teal-700 dark:bg-teal-950 dark:text-teal-300 dark:border-teal-700"
              : "border-border text-muted-foreground hover:bg-muted"
          }`}
        >
          {t("architecture.all")}
        </button>
        {l1Nodes.map((l1) => (
          <button
            key={l1.id}
            type="button"
            onClick={() => setActiveL1(l1.id === activeL1 ? null : l1.id)}
            className={`shrink-0 rounded-full px-3 py-1 text-xs font-medium border transition-colors ${
              activeL1 === l1.id
                ? "border-teal-500 bg-teal-50 text-teal-700 dark:bg-teal-950 dark:text-teal-300 dark:border-teal-700"
                : "border-border text-muted-foreground hover:bg-muted"
            }`}
          >
            {l1.name}
          </button>
        ))}
      </div>

      {/* ---- Architecture grid ---- */}
      <TooltipProvider delayDuration={200}>
        <div className="space-y-6">
          {visibleL1.map((l1) => (
            <div key={l1.id} className="rounded-lg border overflow-hidden">
              {/* L1 bar */}
              <div className="bg-gradient-to-r from-teal-600 to-teal-500 dark:from-teal-700 dark:to-teal-600 px-4 py-2.5">
                <div className="flex items-center gap-3">
                  <span className="text-xs font-bold text-white/70 uppercase tracking-wider">
                    L1
                  </span>
                  <span className="text-sm font-semibold text-white">{l1.name}</span>
                  {isSuperAdmin && onAddChild && (
                    <button
                      type="button"
                      onClick={() => onAddChild(l1)}
                      className="ml-auto inline-flex items-center gap-1 rounded-md border border-white/30 bg-white/10 px-2 py-0.5 text-[11px] font-medium text-white hover:bg-white/20 transition-colors"
                    >
                      <Plus className="h-3 w-3" />
                      {t("architecture.addL2")}
                    </button>
                  )}
                </div>
              </div>

              {/* L2 row */}
              {l1.children && l1.children.length > 0 && (
                <div>
                  <div className="flex border-b">
                    {l1.children.map((l2) => {
                      const l2HasChildren = (l2.children?.length ?? 0) > 0;
                      const l2DocCount = l2HasChildren
                        ? countDocumentsRecursive(l2)
                        : (l2.document_count ?? 0);
                      const canDeleteL2 = !l2HasChildren && l2DocCount === 0;
                      return (
                        <div
                          key={l2.id}
                          className="flex-1 min-w-0 border-r last:border-r-0 bg-teal-50/60 dark:bg-teal-950/30 px-3 py-2 group/l2"
                        >
                          <div className="flex items-center gap-2">
                            <span className="text-[10px] font-bold text-teal-600/60 dark:text-teal-400/60 uppercase tracking-wider">
                              L2
                            </span>
                            <span className="text-xs font-medium text-foreground truncate flex-1">
                              {l2.name}
                            </span>
                            {isSuperAdmin && (
                              <div className="flex items-center gap-1 opacity-0 group-hover/l2:opacity-100 transition-opacity">
                                {onAddChild && (
                                  <Tooltip>
                                    <TooltipTrigger asChild>
                                      <button
                                        type="button"
                                        onClick={() => onAddChild(l2)}
                                        className="inline-flex h-5 w-5 items-center justify-center rounded hover:bg-teal-200/50 dark:hover:bg-teal-900/50 text-teal-700 dark:text-teal-300"
                                      >
                                        <Plus className="h-3 w-3" />
                                      </button>
                                    </TooltipTrigger>
                                    <TooltipContent>{t("architecture.addL3")}</TooltipContent>
                                  </Tooltip>
                                )}
                                {onDeleteNode && (
                                  <Tooltip>
                                    <TooltipTrigger asChild>
                                      <button
                                        type="button"
                                        disabled={!canDeleteL2}
                                        onClick={() => onDeleteNode(l2)}
                                        className="inline-flex h-5 w-5 items-center justify-center rounded hover:bg-red-200/50 dark:hover:bg-red-900/50 text-red-600 dark:text-red-400 disabled:opacity-40 disabled:cursor-not-allowed"
                                      >
                                        <Trash2 className="h-3 w-3" />
                                      </button>
                                    </TooltipTrigger>
                                    <TooltipContent>
                                      {canDeleteL2
                                        ? t("architecture.deleteNode")
                                        : l2HasChildren
                                          ? t("architecture.deleteHasChildren")
                                          : t("architecture.deleteHasDocs", { count: l2DocCount })}
                                    </TooltipContent>
                                  </Tooltip>
                                )}
                              </div>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  {/* L3 area */}
                  <div className="flex">
                    {l1.children.map((l2) => (
                      <div
                        key={l2.id}
                        className="flex-1 min-w-0 border-r last:border-r-0 p-2 space-y-1.5"
                      >
                        {l2.children && l2.children.length > 0 ? (
                          l2.children.map((l3) => {
                            const l3DocCount = l3.document_count ?? 0;
                            const canDeleteL3 = l3DocCount === 0;
                            return (
                              <div
                                key={l3.id}
                                className="relative w-full rounded-md border bg-background p-2 text-xs hover:border-teal-400 hover:shadow-sm transition-all group/l3"
                              >
                                <button
                                  type="button"
                                  onClick={() => setDetailNode(l3)}
                                  className="w-full text-left"
                                >
                                  <span className="text-[10px] font-bold text-muted-foreground/50 uppercase tracking-wider">
                                    L3
                                  </span>
                                  <p className="mt-0.5 font-medium text-foreground group-hover/l3:text-teal-700 dark:group-hover/l3:text-teal-300 leading-snug pr-6">
                                    {l3.name}
                                  </p>
                                  {l3.role && (
                                    <p className="mt-1 text-[10px] text-muted-foreground truncate">
                                      {l3.role}
                                    </p>
                                  )}
                                </button>
                                {isSuperAdmin && onDeleteNode && (
                                  <div className="absolute right-1 top-1 opacity-0 group-hover/l3:opacity-100 transition-opacity">
                                    <Tooltip>
                                      <TooltipTrigger asChild>
                                        <button
                                          type="button"
                                          disabled={!canDeleteL3}
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            onDeleteNode(l3);
                                          }}
                                          className="inline-flex h-5 w-5 items-center justify-center rounded hover:bg-red-200/50 dark:hover:bg-red-900/50 text-red-600 dark:text-red-400 disabled:opacity-40 disabled:cursor-not-allowed"
                                        >
                                          <Trash2 className="h-3 w-3" />
                                        </button>
                                      </TooltipTrigger>
                                      <TooltipContent>
                                        {canDeleteL3
                                          ? t("architecture.deleteNode")
                                          : t("architecture.deleteHasDocs", { count: l3DocCount })}
                                      </TooltipContent>
                                    </Tooltip>
                                  </div>
                                )}
                              </div>
                            );
                          })
                        ) : (
                          <div className="flex items-center justify-center h-16 text-[10px] text-muted-foreground/50 italic">
                            {tc("none")}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      </TooltipProvider>

      {/* ---- L3 Detail Modal ---- */}
      <L3DetailModal
        node={detailNode}
        open={detailNode !== null}
        onClose={() => setDetailNode(null)}
        onViewInManagement={onSelectNode}
      />
    </div>
  );
}
