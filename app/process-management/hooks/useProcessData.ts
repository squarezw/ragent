"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ProcessNode } from "../types/process";
import {
  fetchProcessTree as apiFetchTree,
  createNode as apiCreateNode,
  updateNode as apiUpdateNode,
  deleteNode as apiDeleteNode,
} from "../services/api";

const deepClone = <T>(obj: T): T => structuredClone(obj);

function flattenNodes(nodes: ProcessNode[]): Record<string, ProcessNode> {
  const map: Record<string, ProcessNode> = {};
  function walk(list: ProcessNode[]) {
    for (const n of list) {
      map[n.id] = n;
      if (n.children) walk(n.children);
    }
  }
  walk(nodes);
  return map;
}

function findPath(
  nodes: ProcessNode[],
  targetId: string,
  trail: ProcessNode[] = []
): ProcessNode[] | null {
  for (const n of nodes) {
    const newTrail = [...trail, n];
    if (n.id === targetId) return newTrail;
    if (n.children) {
      const result = findPath(n.children, targetId, newTrail);
      if (result) return result;
    }
  }
  return null;
}

function countByLevel(nodes: ProcessNode[]): {
  l1: number;
  l2: number;
  l3: number;
} {
  const counts = { l1: 0, l2: 0, l3: 0 };
  function walk(list: ProcessNode[]) {
    for (const n of list) {
      if (n.level === 1) counts.l1++;
      else if (n.level === 2) counts.l2++;
      else if (n.level === 3) counts.l3++;
      if (n.children) walk(n.children);
    }
  }
  walk(nodes);
  return counts;
}

/** Apply saved expansion state to a freshly fetched tree */
function applyExpansionState(nodes: ProcessNode[], expandedIds: Set<string>): void {
  for (const n of nodes) {
    if (expandedIds.has(n.id)) {
      n._expanded = true;
    }
    if (n.children) applyExpansionState(n.children, expandedIds);
  }
}

/** Collect all expanded node IDs from the tree */
function collectExpandedIds(nodes: ProcessNode[]): Set<string> {
  const ids = new Set<string>();
  function walk(list: ProcessNode[]) {
    for (const n of list) {
      if (n._expanded) ids.add(n.id);
      if (n.children) walk(n.children);
    }
  }
  walk(nodes);
  return ids;
}

/** Filter tree to only keep nodes matching query and their ancestor chain.
 *  A matching node keeps its entire subtree intact. */
function filterTree(nodes: ProcessNode[], query: string): ProcessNode[] {
  if (!query) return nodes;
  const q = query.toLowerCase();

  function filter(list: ProcessNode[]): ProcessNode[] {
    const result: ProcessNode[] = [];
    for (const node of list) {
      if (node.name.toLowerCase().includes(q)) {
        // Node matches → keep it with full subtree, force expanded
        result.push({ ...node, _expanded: true });
      } else if (node.children?.length) {
        const filteredChildren = filter(node.children);
        if (filteredChildren.length > 0) {
          // Has matching descendants → keep as ancestor, force expanded
          result.push({ ...node, children: filteredChildren, _expanded: true });
        }
      }
    }
    return result;
  }

  return filter(nodes);
}

const SELECTED_KEY = "ragent-process-selected";
const EXPANDED_KEY = "ragent-process-expanded";

function loadFromStorage<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = localStorage.getItem(key);
    if (raw) return JSON.parse(raw);
  } catch {
    /* ignore */
  }
  return fallback;
}

export function useProcessData(companyCode?: string | null) {
  const [tree, setTree] = useState<ProcessNode[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(() =>
    loadFromStorage<string | null>(SELECTED_KEY, null)
  );
  const [searchQuery, setSearchQuery] = useState("");
  const expandedIdsRef = useRef<Set<string>>(new Set(loadFromStorage<string[]>(EXPANDED_KEY, [])));

  const allNodes = flattenNodes(tree);
  const selectedNode = selectedNodeId ? allNodes[selectedNodeId] : null;
  const counts = countByLevel(tree);
  const filteredTree = useMemo(() => filterTree(tree, searchQuery), [tree, searchQuery]);

  const loadTree = useCallback(async () => {
    // undefined = user still loading; skip until resolved
    if (companyCode === undefined) return;
    setIsLoading(true);
    setError(null);
    try {
      const data = await apiFetchTree(companyCode || undefined);
      // Save current expansion state before replacing tree
      if (tree.length > 0) {
        expandedIdsRef.current = collectExpandedIds(tree);
      }
      applyExpansionState(data, expandedIdsRef.current);
      // Auto-expand path to previously selected node
      const savedId = loadFromStorage<string | null>(SELECTED_KEY, null);
      if (savedId) {
        const path = findPath(data, savedId);
        if (path) {
          for (const n of path) {
            if (n.children && n.children.length > 0) {
              n._expanded = true;
            }
          }
        }
      }
      setTree(data);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Failed to load process tree";
      console.error("Failed to fetch process tree:", e);
      setError(msg);
      setTree([]);
    } finally {
      setIsLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companyCode]);

  // Initial load
  useEffect(() => {
    loadTree();
  }, [loadTree]);

  const selectNode = useCallback((id: string) => {
    setSelectedNodeId(id);
    try {
      localStorage.setItem(SELECTED_KEY, JSON.stringify(id));
    } catch {
      /* ignore */
    }
  }, []);

  const getBreadcrumb = useCallback(
    (nodeId: string) => {
      return findPath(tree, nodeId) || [];
    },
    [tree]
  );

  const updateNode = useCallback(
    async (id: string, updates: Partial<ProcessNode>) => {
      // Optimistic local update
      setTree((prev) => {
        const next = deepClone(prev);
        const map = flattenNodes(next);
        const node = map[id];
        if (node) {
          Object.assign(node, updates);
          node.updated = new Date().toISOString().replace("T", " ").slice(0, 19);
        }
        return next;
      });

      try {
        // Map frontend field names to backend field names
        const backendUpdates: Record<string, string | number | undefined> = {};
        if (updates.name !== undefined) backendUpdates.name = updates.name;
        if (updates.desc !== undefined) backendUpdates.description = updates.desc;
        if (updates.role !== undefined) backendUpdates.responsible_role = updates.role;
        if (updates.org !== undefined) backendUpdates.involved_orgs = updates.org;
        if (updates.owner !== undefined) backendUpdates.owner = updates.owner;
        if (updates.sort_order !== undefined) backendUpdates.sort_order = updates.sort_order;

        await apiUpdateNode(id, backendUpdates);
      } catch (e: unknown) {
        console.error("Failed to update node:", e);
        // Revert on failure by reloading
        await loadTree();
        throw e;
      }
    },
    [loadTree]
  );

  const deleteNodeFn = useCallback(
    async (id: string) => {
      await apiDeleteNode(id);
      // Clear selection if we deleted the selected node
      if (selectedNodeId === id) {
        setSelectedNodeId(null);
      }
      await loadTree();
    },
    [loadTree, selectedNodeId]
  );

  const createChildNode = useCallback(
    async (
      parent: ProcessNode,
      values: { name: string; desc: string; role: string; org: string; owner: string },
    ) => {
      if (!parent.company_code) {
        throw new Error("parent.company_code missing");
      }
      const created = await apiCreateNode({
        parent_id: parent.id,
        company_code: parent.company_code,
        name: values.name,
        level: parent.level + 1,
        description: values.desc || undefined,
        owner: values.owner || undefined,
        responsible_role: values.role || undefined,
        involved_orgs: values.org || undefined,
      });
      // expand the parent so the new child is visible after reload
      expandedIdsRef.current.add(parent.id);
      await loadTree();
      return created;
    },
    [loadTree],
  );

  const persistExpanded = useCallback((nodes: ProcessNode[]) => {
    const ids = collectExpandedIds(nodes);
    expandedIdsRef.current = ids;
    try {
      localStorage.setItem(EXPANDED_KEY, JSON.stringify([...ids]));
    } catch {
      /* ignore */
    }
  }, []);

  const toggleExpand = useCallback(
    (id: string) => {
      setTree((prev) => {
        const next = deepClone(prev);
        const map = flattenNodes(next);
        const node = map[id];
        if (node) {
          node._expanded = node._expanded === false ? true : false;
        }
        persistExpanded(next);
        return next;
      });
    },
    [persistExpanded]
  );

  const collapseAll = useCallback(() => {
    setTree((prev) => {
      const next = deepClone(prev);
      function collapse(nodes: ProcessNode[]) {
        for (const n of nodes) {
          if (n.children && n.children.length > 0) {
            n._expanded = false;
            collapse(n.children);
          }
        }
      }
      collapse(next);
      persistExpanded(next);
      return next;
    });
  }, [persistExpanded]);

  const expandAll = useCallback(() => {
    setTree((prev) => {
      const next = deepClone(prev);
      function expand(nodes: ProcessNode[]) {
        for (const n of nodes) {
          n._expanded = true;
          if (n.children) expand(n.children);
        }
      }
      expand(next);
      persistExpanded(next);
      return next;
    });
  }, [persistExpanded]);

  return {
    tree,
    filteredTree,
    allNodes,
    selectedNode,
    selectedNodeId,
    searchQuery,
    counts,
    isLoading,
    error,
    selectNode,
    setSearchQuery,
    getBreadcrumb,
    updateNode,
    deleteNode: deleteNodeFn,
    createChildNode,
    refreshTree: loadTree,
    toggleExpand,
    collapseAll,
    expandAll,
  };
}
