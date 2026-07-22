"use client";

import { useState, useRef, useCallback, useEffect, useMemo } from "react";
import { useTranslations } from "next-intl";
import {
  ChevronRight,
  FileText,
  AlertTriangle,
  ArrowLeft,
  Sparkles,
  CheckCircle2,
  Loader2,
  Image as ImageIcon,
  Download,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Progress } from "@/components/ui/progress";
import { toast } from "sonner";
import {
  getHandbookAnalyzeStatusLight,
  getHandbookAnalyzeResult,
  startHandbookGenerate,
  getHandbookGenerateStatus,
  getHandbookDownloadUrl,
  persistSessionDocFile,
} from "../services/api";
import { displayWidth, AI_SUMMARY_MAX_WIDTH } from "../lib/display-width";
import type {
  HandbookAnalyzeResult,
  ChapterConflict,
  L3FlowConflict,
  L2Chapter,
  AnalyzeSourceDocument,
  QualityMetrics,
  AppendixDedupGroup,
  DescriptionRow,
  RoleDuty,
} from "../services/api";

// Backend sentinel for auxiliary items with no real source doc — skip the
// click-to-locate link for these rows.
const AUTO_GENERATED_SOURCE = "[自动生成]";

// Structural superset of AppendixIndexItem / KeyMgmtItem / RelatedAppendix —
// the subset of fields AuxItemRow consumes. Lets one config/renderer handle
// all Ch6–Ch10 item shapes without casts.
interface AuxRowItem {
  title?: string;
  html?: string;
  text?: string;
  image_path?: string;
  source_file?: string;
  associated_step?: string;
  source_heading?: string;
}

// ─── Click-to-locate: text normalization & matching ───

const CJK_ALNUM_RE = /[\u4e00-\u9fff\u3400-\u4dbf\uf900-\ufaffA-Za-z0-9]/;

function normalizeText(s: string): string {
  if (!s) return "";
  s = s.normalize("NFKC");
  s = s.replace(/[\uff01-\uff5e]/g, (ch) =>
    String.fromCharCode(ch.charCodeAt(0) - 0xfee0),
  );
  s = s
    .replace(/[，]/g, ",").replace(/[。]/g, ".").replace(/[、]/g, ",")
    .replace(/[；]/g, ";").replace(/[：]/g, ":").replace(/[！]/g, "!")
    .replace(/[？]/g, "?").replace(/[（]/g, "(").replace(/[）]/g, ")")
    .replace(/[【]/g, "[").replace(/[】]/g, "]").replace(/[《]/g, "<").replace(/[》]/g, ">")
    .replace(/[\u201c\u201d]/g, '"').replace(/[\u2018\u2019]/g, "'");
  return s.replace(/\s+/g, " ").trim();
}

/** Pick a snippet that maps to a single DOM element in the source document,
 *  by preferring the first substantial line over a raw multi-line prefix. */
function pickSearchSnippet(text: string, maxLen = 80): string {
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (trimmed.length >= 10) return trimmed.substring(0, maxLen);
  }
  return text.substring(0, maxLen);
}

/** Longest prefix of `b` found as a contiguous substring in `a`. */
function matchPrefixLength(a: string, b: string): number {
  let max = 0;
  for (let i = 0; i < a.length && max < b.length; i++) {
    let k = 0;
    while (i + k < a.length && k < b.length && a[i + k] === b[k]) k++;
    if (k > max) max = k;
  }
  return max;
}

/** Clear all highlights from an iframe document. */
function clearIframeHighlights(doc: Document) {
  // Unwrap <mark> elements
  doc.querySelectorAll("mark.source-text-highlight").forEach((mark) => {
    const parent = mark.parentNode;
    if (!parent) return;
    while (mark.firstChild) parent.insertBefore(mark.firstChild, mark);
    parent.removeChild(mark);
    parent.normalize();
  });
  doc.querySelectorAll("span[data-source-hl]").forEach((s) => {
    s.removeAttribute("data-source-hl");
  });
  // Clear pulse highlights
  doc.querySelectorAll(".docfuse-pulse-hl").forEach((el) => {
    el.classList.remove("docfuse-pulse-hl");
  });
}

/** Ensure the base highlight CSS is injected into the iframe document. */
function ensureHighlightStyles(doc: Document) {
  if (doc.getElementById("docfuse-highlight-styles")) return;
  const style = doc.createElement("style");
  style.id = "docfuse-highlight-styles";
  style.textContent = `
    mark.source-text-highlight,
    span[data-source-hl="1"] {
      font: inherit; color: inherit; background: transparent;
      text-decoration: underline solid #E53935 0.2em !important;
      text-underline-offset: 0.2em !important;
    }
    @keyframes docfuseHighlightPulse {
      0%   { box-shadow: 0 0 0 0 rgba(251,191,36,0.4); }
      50%  { box-shadow: 0 0 20px 4px rgba(251,191,36,0.2); }
      100% { box-shadow: 0 0 0 0 rgba(251,191,36,0); }
    }
    .docfuse-pulse-hl {
      background: rgba(251,191,36,0.08) !important;
      outline: 2px solid rgba(251,191,36,0.35);
      outline-offset: 2px;
      border-radius: 4px;
      animation: docfuseHighlightPulse 1.5s ease-out;
    }
  `;
  doc.head.appendChild(style);
}

/** Highlight matching text inside an iframe's document body. Returns true if found. */
function highlightInIframe(
  iframeEl: HTMLIFrameElement,
  searchText: string,
  blockIds?: string,
): boolean {
  const doc = iframeEl.contentDocument;
  if (!doc?.body) return false;

  clearIframeHighlights(doc);
  ensureHighlightStyles(doc);

  let targetEl: Element | null = null;
  let hlSpans: Element[] = [];

  // Strategy 0: data-blk-id span lookup (backend-injected precise highlights)
  const ids = blockIds ? blockIds.split(" ").filter(Boolean) : [];
  if (ids.length) {
    for (const bid of ids) {
      const anchorId = `blk-${bid}`;
      const spans = doc.querySelectorAll(`span[data-blk-id="${anchorId}"]`);
      if (spans.length > 0) {
        hlSpans.push(...Array.from(spans));
        if (!targetEl) targetEl = spans[0];
      }
    }
    if (!hlSpans.length) {
      for (const bid of ids) {
        const anchorId = `blk-${bid}`;
        targetEl = doc.getElementById(anchorId) ??
          doc.querySelector(`[data-blk-ids~="${anchorId}"]`);
        if (targetEl) break;
      }
    }
  }

  // Strategy 1: text search in the document
  if (!targetEl && !hlSpans.length && searchText) {
    targetEl = findTextInDocument(doc, searchText);
  }

  // Apply highlights
  if (hlSpans.length > 0) {
    highlightSpansInDoc(hlSpans);
    scrollIframeToTarget(iframeEl, hlSpans[0]);
    return true;
  }
  if (targetEl) {
    wrapAndHighlight(doc, targetEl, searchText);
    scrollIframeToTarget(iframeEl, targetEl);
    return true;
  }
  return false;
}

/** Find element in document whose text best matches searchText. */
function findTextInDocument(doc: Document, searchText: string): Element | null {
  const needle = normalizeText(searchText).substring(0, 60);
  if (!needle || needle.length < 8) return null;

  // Strategy 1: individual text nodes (fast, for simple cases)
  const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT);
  let bestMatch: Element | null = null;
  let bestScore = 0;

  while (walker.nextNode()) {
    const nodeText = normalizeText(walker.currentNode.textContent ?? "");
    if (!nodeText || nodeText.length < 4) continue;

    if (nodeText.includes(needle)) {
      return walker.currentNode.parentElement;
    }

    const shortNeedle = needle.substring(0, Math.max(25, Math.floor(needle.length * 0.4)));
    if (shortNeedle.length >= 10 && nodeText.includes(shortNeedle)) {
      const score = matchPrefixLength(nodeText, needle);
      if (score > bestScore) {
        bestScore = score;
        bestMatch = walker.currentNode.parentElement;
      }
    }
  }

  if (bestMatch && bestScore > needle.length * 0.6) return bestMatch;

  // Strategy 2: container elements' textContent (handles text split across child nodes)
  const containers = doc.body.querySelectorAll("p, td, th, li, h1, h2, h3, h4, h5, h6, div");
  let tightest: Element | null = null;
  let tightestLen = Infinity;

  for (const el of containers) {
    const raw = el.textContent ?? "";
    if (raw.length > 5000 || raw.length < needle.length * 0.5) continue;
    const elText = normalizeText(raw);
    if (elText.includes(needle)) {
      if (raw.length < tightestLen) {
        tightest = el;
        tightestLen = raw.length;
      }
    }
  }
  if (tightest) return tightest;

  // Strategy 3: shorter prefix in container elements
  const shortNeedle = needle.substring(0, Math.min(25, needle.length));
  if (shortNeedle.length >= 8) {
    for (const el of containers) {
      const raw = el.textContent ?? "";
      if (raw.length > 5000 || raw.length < 6) continue;
      if (normalizeText(raw).includes(shortNeedle)) {
        return el;
      }
    }
  }

  return null;
}

/** Tag backend-injected spans so the shared stylesheet underlines them
 *  identically to <mark> wrappers, keeping both highlight paths in sync. */
function highlightSpansInDoc(spans: Element[]) {
  spans.forEach((s) => s.setAttribute("data-source-hl", "1"));
}

/** Wrap matched text with <mark> elements for frontend highlighting. */
function wrapAndHighlight(doc: Document, el: Element, searchText?: string) {
  if (searchText && searchText.length >= 6) {
    const firstMark = wrapMatchedTextInDoc(doc, el, searchText);
    if (firstMark) return;
  }
  // Fallback: pulse highlight on the element (no text marking)
  (el as HTMLElement).classList.add("docfuse-pulse-hl");
  setTimeout(() => (el as HTMLElement).classList.remove("docfuse-pulse-hl"), 3000);
}

/** Precise text wrapping using stripped character matching. */
function wrapMatchedTextInDoc(doc: Document, container: Element, searchText: string): Element | null {
  const textNodes: Text[] = [];
  const walker = doc.createTreeWalker(container, NodeFilter.SHOW_TEXT);
  while (walker.nextNode()) textNodes.push(walker.currentNode as Text);
  if (!textNodes.length) return null;

  let concat = "";
  const segments: Array<{ node: Text; offset: number }> = [];
  for (const node of textNodes) {
    segments.push({ node, offset: concat.length });
    concat += node.textContent;
  }

  let concatStripped = "";
  const rawToStripped = new Array<number>(concat.length);
  for (let i = 0; i < concat.length; i++) {
    if (CJK_ALNUM_RE.test(concat[i])) {
      rawToStripped[i] = concatStripped.length;
      concatStripped += concat[i].toLowerCase();
    } else {
      rawToStripped[i] = -1;
    }
  }

  const needleNorm = normalizeText(searchText);
  let needleStripped = "";
  for (let i = 0; i < needleNorm.length; i++) {
    if (CJK_ALNUM_RE.test(needleNorm[i])) needleStripped += needleNorm[i].toLowerCase();
  }
  needleStripped = needleStripped.substring(0, 80);
  if (needleStripped.length < 6) return null;

  let matchStart = concatStripped.indexOf(needleStripped);
  let actualMatchLen = needleStripped.length;
  if (matchStart < 0) {
    const short = needleStripped.substring(0, Math.min(30, needleStripped.length));
    if (short.length >= 10) {
      matchStart = concatStripped.indexOf(short);
      actualMatchLen = short.length; // only mark the short prefix that actually matched
    }
  }
  if (matchStart < 0) return null;
  const matchLen = Math.min(actualMatchLen, concatStripped.length - matchStart);
  const matchEnd = matchStart + matchLen;

  let rawStart = -1;
  let rawEnd = -1;
  for (let i = 0; i < concat.length; i++) {
    if (rawToStripped[i] >= matchStart && rawStart < 0) rawStart = i;
    if (rawToStripped[i] >= 0 && rawToStripped[i] < matchEnd) rawEnd = i + 1;
  }
  if (rawStart < 0 || rawEnd <= rawStart) return null;

  // Wrap each text node segment in <mark> with border-bottom
  let firstMark: Element | null = null;
  for (const seg of segments) {
    const segStart = seg.offset;
    const segEnd = segStart + (seg.node.textContent?.length ?? 0);
    const overlapStart = Math.max(rawStart, segStart) - segStart;
    const overlapEnd = Math.min(rawEnd, segEnd) - segStart;
    if (overlapStart >= overlapEnd) continue;

    const textNode = seg.node;
    const text = textNode.textContent ?? "";
    const parent = textNode.parentNode!;
    const before = text.substring(0, overlapStart);
    const match = text.substring(overlapStart, overlapEnd);
    const after = text.substring(overlapEnd);

    const mark = doc.createElement("mark");
    mark.className = "source-text-highlight";
    mark.textContent = match;

    const frag = doc.createDocumentFragment();
    if (before) frag.appendChild(doc.createTextNode(before));
    frag.appendChild(mark);
    if (after) frag.appendChild(doc.createTextNode(after));
    parent.replaceChild(frag, textNode);

    if (!firstMark) firstMark = mark;
  }
  return firstMark;
}

/** Scroll within the iframe to bring the target element into view. */
function scrollIframeToTarget(iframeEl: HTMLIFrameElement, target: Element) {
  try {
    // scrollIntoView works across iframe boundaries and is the most reliable
    target.scrollIntoView({ behavior: "smooth", block: "center" });
  } catch {
    // Fallback: manual scroll calculation
    const doc = iframeEl.contentDocument;
    if (!doc) return;
    const targetRect = target.getBoundingClientRect();
    const scrollY = doc.documentElement.scrollTop || doc.body.scrollTop;
    const scrollTarget = Math.max(0, scrollY + targetRect.top - 200);
    doc.documentElement.scrollTo({ top: scrollTarget, behavior: "smooth" });
    doc.body.scrollTo({ top: scrollTarget, behavior: "smooth" });
  }
}

/** Highlight matching text in block-based rendering (non-iframe). */
function highlightInBlockContainer(
  container: HTMLElement,
  searchText: string,
  blockId?: string,
): boolean {
  // Clear previous highlights
  container.querySelectorAll("mark.source-text-highlight").forEach((mark) => {
    const parent = mark.parentNode;
    if (!parent) return;
    while (mark.firstChild) parent.insertBefore(mark.firstChild, mark);
    parent.removeChild(mark);
    parent.normalize();
  });

  let targetEl: Element | null = null;

  // Try block_id first
  if (blockId) {
    targetEl = container.querySelector(`[data-block-id="${blockId}"]`);
  }

  // Text search fallback
  if (!targetEl && searchText) {
    const needle = normalizeText(searchText).substring(0, 60);
    if (needle && needle.length >= 6) {
      const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
      while (walker.nextNode()) {
        const nodeText = normalizeText(walker.currentNode.textContent ?? "");
        if (nodeText.includes(needle)) {
          targetEl = walker.currentNode.parentElement;
          break;
        }
      }
    }
  }

  if (targetEl) {
    targetEl.scrollIntoView({ behavior: "smooth", block: "center" });
    // Add temporary pulse highlight
    const htmlEl = targetEl as HTMLElement;
    htmlEl.style.background = "rgba(251,191,36,0.08)";
    htmlEl.style.outline = "2px solid rgba(251,191,36,0.35)";
    htmlEl.style.outlineOffset = "2px";
    htmlEl.style.borderRadius = "4px";
    htmlEl.style.animation = "none";
    setTimeout(() => {
      htmlEl.style.background = "";
      htmlEl.style.outline = "";
      htmlEl.style.outlineOffset = "";
      htmlEl.style.borderRadius = "";
    }, 3000);
    return true;
  }
  return false;
}

// ─── Source document color cycling ───
const SOURCE_COLORS = [
  { dot: "bg-blue-500", bg: "bg-blue-500/10", text: "text-blue-400", border: "border-blue-500" },
  {
    dot: "bg-emerald-500",
    bg: "bg-emerald-500/10",
    text: "text-emerald-400",
    border: "border-emerald-500",
  },
  {
    dot: "bg-amber-500",
    bg: "bg-amber-500/10",
    text: "text-amber-400",
    border: "border-amber-500",
  },
  {
    dot: "bg-purple-500",
    bg: "bg-purple-500/10",
    text: "text-purple-400",
    border: "border-purple-500",
  },
  { dot: "bg-pink-500", bg: "bg-pink-500/10", text: "text-pink-400", border: "border-pink-500" },
  { dot: "bg-cyan-500", bg: "bg-cyan-500/10", text: "text-cyan-400", border: "border-cyan-500" },
];

function getSourceColor(index: number) {
  return SOURCE_COLORS[index % SOURCE_COLORS.length];
}

// ─── Decision types ───
// chapter key 必须是 "ch1"/"ch2"/"ch3"（与 docfuse HandbookDecisions 对齐）。
// 之前用数字 key（1/2/3）导致 JSON 化后变 "1"/"2"/"3"，后端 .get("ch1") 取不到，
// ChapterConflictCard 的 custom 编辑功能实际上从不生效——默默回退到 merged_texts。
const chKey = (n: number) => `ch${n}`;

interface HandbookDecisions {
  chapter_picks: Record<string, string>; // "ch1"/"ch2"/"ch3" -> "merged"|"custom"|candidate_id
  chapter_custom_texts: Record<string, string>; // "ch1"/"ch2"/"ch3" -> edited text
  l3_flow_picks: Record<string, string>; // conflict_id -> source_file|"merge"
  appendix_dedup: Record<string, string>; // group_id -> source_file|"keep_all"
}

const EMPTY_DECISIONS: HandbookDecisions = {
  chapter_picks: {},
  chapter_custom_texts: {},
  l3_flow_picks: {},
  appendix_dedup: {},
};

// ─── Chapter label mapping ───
const CHAPTER_LABEL_KEYS: Record<number, string> = {
  1: "purpose",
  2: "scope",
  3: "responsibility",
};

interface DocumentConversionTabProps {
  onBack?: () => void;
  onGoToEditor?: (docId?: string) => void;
  sessionId?: string | null;
  onStatusChange?: (status: string) => void;
  /** When false, all polling is paused (component stays mounted but hidden) */
  isActive?: boolean;
}

export default function DocumentConversionTab({
  onBack,
  onGoToEditor,
  sessionId,
  onStatusChange,
  isActive = true,
}: DocumentConversionTabProps) {
  const t = useTranslations("processManagement");

  // ─── Polling state for handbook analysis ───
  const [analyzeStatus, setAnalyzeStatus] = useState<string | null>(null);
  const [analyzeError, setAnalyzeError] = useState<string | null>(null);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const pollingRef = useRef<ReturnType<typeof setInterval>>(undefined);
  const timerRef = useRef<ReturnType<typeof setInterval>>(undefined);

  // ─── Real data from analyze API ───
  const [analyzeResult, setAnalyzeResult] = useState<HandbookAnalyzeResult | null>(null);
  const [fetchingResult, setFetchingResult] = useState(false);

  // ─── Decisions state ───
  const [decisions, setDecisions] = useState<HandbookDecisions>({ ...EMPTY_DECISIONS });

  // ─── AI summary (文件标题) editing ───
  const [editedAiSummary, setEditedAiSummary] = useState("");

  // ─── Generate state ───
  const [generateStatus, setGenerateStatus] = useState<
    "idle" | "submitting" | "polling" | "completed" | "failed"
  >("idle");
  const [generateConfirmOpen, setGenerateConfirmOpen] = useState(false);
  const [generateSuccessOpen, setGenerateSuccessOpen] = useState(false);
  const [generatedDocId, setGeneratedDocId] = useState<string | undefined>();
  const generatePollingRef = useRef<ReturnType<typeof setInterval>>(undefined);

  // ─── UI state ───
  const [activeDocTab, setActiveDocTab] = useState(0);
  const [expandedSections, setExpandedSections] = useState<Set<string>>(
    new Set(["quality", "ch1", "ch2", "ch3", "ch4", "ch5", "ch6", "ch7", "ch8", "ch9", "ch10"])
  );
  const rightBodyRef = useRef<HTMLDivElement>(null);
  const iframeRefs = useRef<Map<number, HTMLIFrameElement>>(new Map());
  const blockContainerRefs = useRef<Map<number, HTMLDivElement>>(new Map());

  // ─── Poll analysis status when sessionId is provided and tab is active ───
  const prevSessionIdRef = useRef<string | null>(null);
  useEffect(() => {
    if (!sessionId || !isActive) return;

    const isNewSession = prevSessionIdRef.current !== sessionId;
    prevSessionIdRef.current = sessionId;

    // Resuming same session that already has a terminal result — skip re-polling
    if (!isNewSession && analyzeResult) return;

    if (isNewSession) {
      setAnalyzeStatus("pending");
      setAnalyzeError(null);
      setElapsedSeconds(0);
      setFetchingResult(false);
    }

    timerRef.current = setInterval(() => {
      setElapsedSeconds((s) => s + 1);
    }, 1000);

    const poll = async () => {
      try {
        // Lightweight status check — no full payload during polling
        const { status } = await getHandbookAnalyzeStatusLight(sessionId);
        setAnalyzeStatus(status);

        if (status === "completed") {
          clearInterval(pollingRef.current);
          // Fetch full analyze result (cached) only once completed
          setFetchingResult(true);
          try {
            const result = await getHandbookAnalyzeResult(sessionId);
            setAnalyzeResult(result);
            onStatusChange?.("completed");

            // Auto-select "merged" for chapter conflicts by default
            const defaultPicks: Record<string, string> = {};
            const defaultTexts: Record<string, string> = {};
            for (const c of result.chapter_conflicts ?? []) {
              if (c.candidates.length > 1) {
                defaultPicks[chKey(c.chapter)] = "merged";
                defaultTexts[chKey(c.chapter)] = c.merged_text;
              }
            }
            setDecisions((prev) => ({
              ...prev,
              chapter_picks: defaultPicks,
              chapter_custom_texts: defaultTexts,
            }));
            setEditedAiSummary(result.cover?.ai_summary ?? "");
          } finally {
            clearInterval(timerRef.current);
            setFetchingResult(false);
          }
        } else if (status === "failed") {
          clearInterval(pollingRef.current);
          clearInterval(timerRef.current);
          // Fetch result to get error details
          try {
            const result = await getHandbookAnalyzeResult(sessionId);
            setAnalyzeError(result.error || "Analysis failed");
          } catch {
            setAnalyzeError("Analysis failed");
          }
          onStatusChange?.("failed");
        }
      } catch {
        // Keep polling on transient errors
      }
    };

    poll();
    pollingRef.current = setInterval(poll, 3000);

    return () => {
      clearInterval(pollingRef.current);
      clearInterval(timerRef.current);
    };
  }, [sessionId, isActive]);

  const isAnalyzing = sessionId && analyzeStatus && (analyzeStatus !== "completed" || fetchingResult);

  const formatElapsed = (s: number) => {
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return m > 0 ? `${m}m ${sec}s` : `${sec}s`;
  };

  // ─── Conflict progress (computed) ───
  const conflictProgress = useMemo(() => {
    if (!analyzeResult)
      return {
        resolved: 0,
        total: 0,
        chapterTotal: 0,
        chapterResolved: 0,
        l3Total: 0,
        l3Resolved: 0,
      };

    let chapterTotal = 0;
    let chapterResolved = 0;
    for (const c of analyzeResult.chapter_conflicts ?? []) {
      if (c.candidates.length > 1) {
        chapterTotal++;
        if (decisions.chapter_picks[chKey(c.chapter)] != null) chapterResolved++;
      }
    }

    const l3Conflicts = analyzeResult.l3_flow_conflicts ?? [];
    const l3Total = l3Conflicts.length;
    const l3Resolved = l3Conflicts.filter(
      (c) => decisions.l3_flow_picks[c.conflict_id] != null
    ).length;

    return {
      resolved: chapterResolved + l3Resolved,
      total: chapterTotal + l3Total,
      chapterTotal,
      chapterResolved,
      l3Total,
      l3Resolved,
    };
  }, [analyzeResult, decisions]);

  const trimmedAiSummary = useMemo(() => editedAiSummary.trim(), [editedAiSummary]);
  const aiSummaryWidth = displayWidth(trimmedAiSummary);
  const aiSummaryValid = trimmedAiSummary.length > 0 && aiSummaryWidth <= AI_SUMMARY_MAX_WIDTH;

  const canGenerate =
    aiSummaryValid &&
    (conflictProgress.chapterTotal === 0 ||
      conflictProgress.chapterResolved === conflictProgress.chapterTotal);

  // ─── Section toggle ───
  const toggleSection = useCallback((name: string) => {
    setExpandedSections((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  }, []);

  // ─── Click-to-locate in source ───
  const locateInSource = useCallback(
    (sourceFile: string, searchText?: string, blockIds?: string) => {
      if (!analyzeResult) return;
      const docs = analyzeResult.source_documents ?? [];
      if (docs.length === 0) return;

      // Find matching source doc tab
      let tabIdx = -1;
      const shortName = (p: string) =>
        p ? p.replace(/\\/g, "/").split("/").pop() ?? "" : "";

      if (sourceFile) {
        for (let i = 0; i < docs.length; i++) {
          const fn = docs[i].file_name || "";
          if (
            fn === sourceFile ||
            fn.includes(sourceFile) ||
            sourceFile.includes(fn) ||
            shortName(fn) === shortName(sourceFile)
          ) {
            tabIdx = i;
            break;
          }
        }
      }

      // Fallback 1: search all source documents' blocks for the text
      if (tabIdx < 0 && searchText) {
        const needle = normalizeText(searchText).substring(0, 40);
        if (needle.length >= 6) {
          for (let i = 0; i < docs.length; i++) {
            for (const blk of docs[i].blocks ?? []) {
              if (blk.text && normalizeText(blk.text).includes(needle)) {
                tabIdx = i;
                break;
              }
            }
            if (tabIdx >= 0) break;
          }
        }
      }

      // Fallback 2: search loaded iframes for the text (handles preview_html-only docs)
      if (tabIdx < 0 && searchText) {
        const needle = normalizeText(searchText).substring(0, 30);
        if (needle.length >= 6) {
          for (let i = 0; i < docs.length; i++) {
            const iframe = iframeRefs.current.get(i);
            const iframeDoc = iframe?.contentDocument;
            if (iframeDoc?.body) {
              const bodyText = normalizeText(iframeDoc.body.textContent ?? "");
              if (bodyText.includes(needle)) {
                tabIdx = i;
                break;
              }
            }
          }
        }
      }

      // Fallback 3: if only one source doc, use it
      if (tabIdx < 0 && docs.length === 1) {
        tabIdx = 0;
      }

      if (tabIdx < 0) {
        toast.info(t("conversion.sourceNotFound"));
        return;
      }

      setActiveDocTab(tabIdx);

      // Wait for render then highlight, with retry for iframe loading
      const tryHighlight = (attempt: number) => {
        const iframe = iframeRefs.current.get(tabIdx);
        if (iframe) {
          const found = highlightInIframe(iframe, searchText ?? "", blockIds);
          if (!found && attempt < 3) {
            setTimeout(() => tryHighlight(attempt + 1), 300);
          } else if (!found) {
            iframe.contentWindow?.scrollTo({ top: 0, behavior: "smooth" });
          }
          return;
        }
        const blockContainer = blockContainerRefs.current.get(tabIdx);
        if (blockContainer && searchText) {
          highlightInBlockContainer(blockContainer, searchText);
        }
      };

      requestAnimationFrame(() => {
        setTimeout(() => tryHighlight(0), 150);
      });
    },
    [analyzeResult],
  );

  // ─── Generate flow ───
  const handleGenerate = useCallback(async () => {
    if (!sessionId || !analyzeResult) return;

    setGenerateStatus("submitting");
    setGenerateConfirmOpen(false);

    try {
      await startHandbookGenerate({
        session_id: sessionId,
        decisions: structuredClone(decisions) as unknown as Record<string, unknown>,
        ai_summary_override: trimmedAiSummary,
      });
      toast.success(t("conversion.generateSubmitted"));
      setGenerateStatus("polling");

      const pollGen = async () => {
        try {
          const result = await getHandbookGenerateStatus(sessionId);
          if (result.status === "completed") {
            clearInterval(generatePollingRef.current);
            setGenerateStatus("completed");
            setGeneratedDocId(result.document_id);
            onStatusChange?.("completed");

            // Persist the generated DOCX as v1 before allowing user to edit
            if (result.document_id) {
              try {
                await persistSessionDocFile(result.document_id, sessionId);
              } catch {
                // Retry once — the call is idempotent
                try {
                  await new Promise((r) => setTimeout(r, 2000));
                  await persistSessionDocFile(result.document_id, sessionId);
                } catch (retryErr: any) {
                  console.error("Failed to persist doc file:", retryErr?.message);
                  toast.error(t("conversion.persistFailed"));
                  return;
                }
              }
            }
            setGenerateSuccessOpen(true);
          } else if (result.status === "failed") {
            clearInterval(generatePollingRef.current);
            setGenerateStatus("failed");
            toast.error(t("conversion.generateFailed"), {
              description: result.error,
            });
          }
        } catch {
          // Keep polling on transient errors
        }
      };

      pollGen();
      generatePollingRef.current = setInterval(pollGen, 3000);
    } catch (err) {
      setGenerateStatus("failed");
      toast.error(t("conversion.generateFailed"), {
        description: err instanceof Error ? err.message : String(err),
      });
    }
  }, [sessionId, analyzeResult, decisions, trimmedAiSummary, t]);

  // Cleanup generate polling
  useEffect(() => {
    return () => clearInterval(generatePollingRef.current);
  }, []);

  // ─── Helper: find chapter conflict ───
  const getChapterConflict = useCallback(
    (chapterNum: number): ChapterConflict | undefined => {
      return (analyzeResult?.chapter_conflicts ?? []).find(
        (c) => c.chapter === chapterNum && c.candidates.length > 1
      );
    },
    [analyzeResult]
  );

  // ─── Helper: find L3 flow conflict ───
  const getL3Conflict = useCallback(
    (l3Code: string): L3FlowConflict | undefined => {
      return (analyzeResult?.l3_flow_conflicts ?? []).find((c) => c.l3_code === l3Code);
    },
    [analyzeResult]
  );

  // ─── Source documents ───
  const sourceDocs = analyzeResult?.source_documents ?? [];
  // 上一轮分析有 N 源、activeDocTab 指向中间某个；这轮只剩 1 源就会越界。
  // useEffect 里再 setActiveDocTab 是一次额外渲染，先夹一下拿到 render-safe 的 index。
  const activeIdx = Math.min(activeDocTab, Math.max(0, sourceDocs.length - 1));

  useEffect(() => {
    if (activeDocTab >= sourceDocs.length && sourceDocs.length > 0) {
      setActiveDocTab(0);
    }
  }, [sourceDocs.length, activeDocTab]);

  // ─── Derived data ───
  const quality = analyzeResult?.quality;
  const chapters = analyzeResult?.ch6_chapters ?? [];
  const dedupGroups = analyzeResult?.appendix_dedup_groups ?? [];
  const keyMgmtItems = analyzeResult?.key_mgmt_items ?? [];
  const relatedTables = analyzeResult?.related_tables ?? [];
  const relatedFiles = analyzeResult?.related_files ?? [];
  const relatedAppendices = analyzeResult?.related_appendices ?? [];

  const auxSections: Array<{
    id: string;
    num: number;
    titleKey: "keyMgmtItems" | "relatedTables" | "relatedFiles" | "relatedAppendices";
    items: AuxRowItem[];
    extra?: (item: AuxRowItem) => string | undefined;
  }> = [
    {
      id: "ch7",
      num: 7,
      titleKey: "keyMgmtItems",
      items: keyMgmtItems,
      extra: (i) =>
        i.associated_step
          ? `${t("conversion.associatedStep")}: ${i.associated_step}`
          : undefined,
    },
    { id: "ch8", num: 8, titleKey: "relatedTables", items: relatedTables },
    { id: "ch9", num: 9, titleKey: "relatedFiles", items: relatedFiles },
    {
      id: "ch10",
      num: 10,
      titleKey: "relatedAppendices",
      items: relatedAppendices,
      extra: (i) => i.source_heading || undefined,
    },
  ];

  const isGenerating = generateStatus === "submitting" || generateStatus === "polling";

  return (
    <div className="flex flex-col flex-1 min-h-0">
      {/* Header */}
      <div className="flex items-center gap-4 px-5 py-3 border-b bg-card flex-shrink-0">
        <button
          onClick={onBack}
          className="text-xs text-muted-foreground hover:text-foreground transition-colors flex items-center gap-1"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          {t("conversion.backToProcess")}
        </button>
        <div className="w-px h-5 bg-border" />
        <span className="text-sm font-semibold">{t("tabs.documentConversion")}</span>
        {isAnalyzing ? (
          <span className="text-xs text-muted-foreground flex-1">
            {fetchingResult
              ? t("conversion.loadingResult")
              : analyzeStatus === "queued"
                ? t("conversion.queuedWaiting")
                : analyzeStatus === "pending"
                  ? t("conversion.submittedWaiting")
                  : t("conversion.analyzing")}
          </span>
        ) : analyzeResult ? (
          <span className="text-xs text-muted-foreground flex-1">
            {sourceDocs.length} source files
          </span>
        ) : (
          <span className="text-xs text-muted-foreground flex-1" />
        )}

        {!isAnalyzing && analyzeResult && (
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <div>
                  <button
                    onClick={() => {
                      if (canGenerate) setGenerateConfirmOpen(true);
                    }}
                    disabled={!canGenerate || isGenerating}
                    className={cn(
                      "flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-md transition-colors",
                      canGenerate && !isGenerating
                        ? "bg-primary text-primary-foreground hover:bg-primary/90"
                        : "bg-muted text-muted-foreground cursor-not-allowed"
                    )}
                  >
                    {isGenerating ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <Sparkles className="w-3.5 h-3.5" />
                    )}
                    {isGenerating ? t("conversion.generating") : t("conversion.generate")}
                  </button>
                </div>
              </TooltipTrigger>
              {!canGenerate && (
                <TooltipContent>
                  <p>{t("conversion.generateGateMsg")}</p>
                </TooltipContent>
              )}
            </Tooltip>
          </TooltipProvider>
        )}
      </div>

      {/* Loading page -- shown while analysis is in progress */}
      {isAnalyzing && (
        <div className="flex-1 flex items-center justify-center p-10">
          <div className="rounded-xl border bg-card shadow-lg p-12 w-full max-w-md text-center space-y-4">
            {analyzeError ? (
              <>
                <AlertTriangle className="h-12 w-12 mx-auto text-red-400" />
                <h3 className="text-base font-semibold">{t("conversion.error")}</h3>
                <div className="rounded-lg bg-red-500/5 border border-red-500/15 p-3 text-xs text-red-500 text-left break-all">
                  {analyzeError}
                </div>
                <button
                  onClick={onBack}
                  className="mt-2 inline-flex items-center gap-1.5 px-4 py-2 text-sm rounded-md border bg-background hover:bg-muted transition-colors"
                >
                  <ArrowLeft className="h-3.5 w-3.5" />
                  {t("conversion.backToProcess")}
                </button>
              </>
            ) : (
              <>
                {analyzeStatus === "queued" ? (
                  <div className="h-12 w-12 mx-auto border-3 border-blue-400/30 rounded-full flex items-center justify-center">
                    <div className="h-4 w-4 rounded-full bg-blue-400 animate-pulse" />
                  </div>
                ) : (
                  <div className="h-12 w-12 mx-auto border-3 border-primary/30 border-t-primary rounded-full animate-spin" />
                )}
                <h3 className="text-base font-semibold">
                  {fetchingResult ? t("conversion.loadingResult") : t("conversion.analyzingDocuments")}
                </h3>
                <p className="text-sm text-muted-foreground">
                  {fetchingResult && t("conversion.loadingResultHint")}
                  {!fetchingResult && analyzeStatus === "queued" && t("conversion.queuedWaiting")}
                  {!fetchingResult && analyzeStatus === "pending" && t("conversion.submittedWaiting")}
                  {!fetchingResult && analyzeStatus === "running" && t("conversion.processingPleaseWait")}
                </p>
                <p className="text-xs text-muted-foreground font-mono">
                  {formatElapsed(elapsedSeconds)}
                </p>
              </>
            )}
          </div>
        </div>
      )}

      {/* Empty state -- no session */}
      {!sessionId && !analyzeResult && (
        <div className="flex-1 flex items-center justify-center p-10">
          <div className="text-center text-muted-foreground text-sm">
            {t("conversion.noContent")}
          </div>
        </div>
      )}

      {/* Main two-panel -- shown when analysis is complete */}
      {analyzeResult && !isAnalyzing && (
        <div className="flex flex-1 min-h-0">
          {/* Left Panel */}
          <div className="w-[50%] min-w-[360px] border-r flex flex-col overflow-hidden">
            <div className="px-5 py-3 border-b bg-muted/40 text-sm font-semibold flex items-center gap-2 flex-shrink-0">
              <FileText className="w-4 h-4 text-primary" />
              {t("conversion.aiResult")}
            </div>

            <div className="flex-1 overflow-y-auto">
              {/* Conflict Strip -- sticky */}
              {conflictProgress.total > 0 && <ConflictStrip progress={conflictProgress} t={t} />}

              <div className="px-5 py-4 space-y-3">
                {/* Quality Overview — 已隐藏 */}
                {false && quality && (
                  <SectionBlock
                    title={t("conversion.qualityOverview")}
                    expanded={expandedSections.has("quality")}
                    onToggle={() => toggleSection("quality")}
                  >
                    <QualityOverviewPanel quality={quality} t={t} />
                  </SectionBlock>
                )}

                {/* AI Summary (文件标题) editing */}
                <div className="rounded-lg border bg-card p-4 space-y-2">
                  <div className="flex items-center justify-between">
                    <label className="text-xs font-semibold text-foreground">
                      {t("conversion.aiSummaryLabel")}
                    </label>
                    <span
                      className={cn(
                        "text-[10px] tabular-nums",
                        aiSummaryWidth > AI_SUMMARY_MAX_WIDTH
                          ? "text-destructive font-semibold"
                          : "text-muted-foreground"
                      )}
                    >
                      {aiSummaryWidth}/{AI_SUMMARY_MAX_WIDTH}
                    </span>
                  </div>
                  <input
                    type="text"
                    value={editedAiSummary}
                    onChange={(e) => setEditedAiSummary(e.target.value)}
                    disabled={isGenerating || generateStatus === "completed"}
                    className="w-full rounded-md border bg-background px-3 py-1.5 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary disabled:opacity-60 disabled:cursor-not-allowed"
                    placeholder={t("conversion.aiSummaryPlaceholder")}
                  />
                  {aiSummaryWidth > AI_SUMMARY_MAX_WIDTH && (
                    <p className="text-[10px] text-destructive">
                      {t("conversion.aiSummaryTooLong")}
                    </p>
                  )}
                  {analyzeResult?.cover?.doc_number && trimmedAiSummary && (
                    <p className="text-[10px] text-muted-foreground truncate">
                      {analyzeResult.cover.doc_number}_A-_{trimmedAiSummary}.docx
                    </p>
                  )}
                </div>

                {/* Ch1–Ch3: Purpose, Scope, Responsibilities */}
                {([
                  { num: 1, key: "ch1", label: t("conversion.purpose"), text: analyzeResult.ch1_text },
                  { num: 2, key: "ch2", label: t("conversion.scope"), text: analyzeResult.ch2_text },
                  { num: 3, key: "ch3", label: t("conversion.responsibility"), text: analyzeResult.ch3_text },
                ] as const).map(({ num, key, label, text }) => {
                  const conflict = getChapterConflict(num);
                  const ch3Roles = num === 3 ? analyzeResult.ch3_roles : undefined;
                  return (
                    <SectionBlock
                      key={key}
                      title={`Ch${num} ${label}`}
                      expanded={expandedSections.has(key)}
                      onToggle={() => toggleSection(key)}
                    >
                      {conflict ? (
                        <ChapterConflictCard
                          conflict={conflict}
                          decisions={decisions}
                          setDecisions={setDecisions}
                          t={t}
                          onLocate={locateInSource}
                        />
                      ) : (
                        <div className="space-y-3">
                          <EditableChapterText
                            chapterNum={num}
                            initialText={text ?? ""}
                            decisions={decisions}
                            setDecisions={setDecisions}
                            t={t}
                          />
                          {num === 3 &&
                            decisions.chapter_picks[chKey(3)] !== "custom" &&
                            ch3Roles &&
                            ch3Roles.length > 0 && <RoleDutyList roles={ch3Roles} />}
                        </div>
                      )}
                    </SectionBlock>
                  );
                })}

                {/* Ch4 Architecture */}
                <SectionBlock
                  title={`Ch4 ${t("conversion.architecture")}`}
                  expanded={expandedSections.has("ch4")}
                  onToggle={() => toggleSection("ch4")}
                >
                  {analyzeResult.ch5_arch_path ? (
                    <div className="rounded-lg border bg-muted/30 p-4 flex items-center justify-center">
                      <img
                        src={analyzeResult.ch5_arch_path}
                        alt="Architecture diagram"
                        className="max-w-full h-auto rounded"
                      />
                    </div>
                  ) : (
                    <div className="rounded-lg border bg-muted/30 p-6 flex flex-col items-center justify-center gap-2 text-muted-foreground">
                      <ImageIcon className="w-8 h-8" />
                      <span className="text-xs">{t("conversion.noContent")}</span>
                    </div>
                  )}
                </SectionBlock>

                {/* Ch5 Flow Chapters */}
                <SectionBlock
                  title={`Ch5 ${t("conversion.flowChapters")}`}
                  expanded={expandedSections.has("ch5")}
                  onToggle={() => toggleSection("ch5")}
                  badge={`${chapters.length} L2`}
                >
                  <div className="space-y-4">
                    {chapters.map((l2) => (
                      <L2ChapterBlock
                        key={l2.l2_code}
                        l2={l2}
                        getL3Conflict={getL3Conflict}
                        decisions={decisions}
                        setDecisions={setDecisions}
                        t={t}
                        onLocate={locateInSource}
                      />
                    ))}
                    {chapters.length === 0 && (
                      <div className="text-xs text-muted-foreground text-center py-4">
                        {t("conversion.noContent")}
                      </div>
                    )}
                  </div>
                </SectionBlock>

                {/* Backend only surfaces dedup decisions here — raw appendices live in Ch7-Ch10. */}
                {dedupGroups.length > 0 && (
                  <SectionBlock
                    title={`Ch6 ${t("conversion.appendixDedup")}`}
                    expanded={expandedSections.has("ch6")}
                    onToggle={() => toggleSection("ch6")}
                    badge={`${dedupGroups.length}`}
                  >
                    <div className="space-y-2">
                      {dedupGroups.map((group) => (
                        <AppendixDedupCard
                          key={group.group_id}
                          group={group}
                          decisions={decisions}
                          setDecisions={setDecisions}
                          t={t}
                        />
                      ))}
                    </div>
                  </SectionBlock>
                )}

                {auxSections.map(({ id, num, titleKey, items, extra }) => (
                  <SectionBlock
                    key={id}
                    title={`Ch${num} ${t(`conversion.${titleKey}` as never)}`}
                    expanded={expandedSections.has(id)}
                    onToggle={() => toggleSection(id)}
                    badge={`${items.length}`}
                  >
                    <div className="space-y-3">
                      {items.map((item, idx) => (
                        <AuxItemRow
                          key={idx}
                          title={item.title}
                          html={item.html}
                          text={item.text}
                          imagePath={item.image_path}
                          sourceFile={item.source_file}
                          extra={extra?.(item)}
                          onLocate={locateInSource}
                        />
                      ))}
                      {items.length === 0 && (
                        <div className="text-xs text-muted-foreground text-center py-4">
                          {t("conversion.noContent")}
                        </div>
                      )}
                    </div>
                  </SectionBlock>
                ))}

                <div className="h-4" />
              </div>
            </div>
          </div>

          {/* Right Panel: Source Documents */}
          <div className="flex-1 min-w-[320px] flex flex-col overflow-hidden bg-muted/30">
            {/* Tab bar */}
            <div className="flex border-b bg-card flex-shrink-0 overflow-x-auto">
              {sourceDocs.map((doc, idx) => {
                const color = getSourceColor(idx);
                return (
                  <button
                    key={doc.file_name}
                    onClick={() => setActiveDocTab(idx)}
                    className={cn(
                      "flex items-center gap-2 px-4 py-3 text-[13px] border-b-2 transition-colors whitespace-nowrap",
                      idx === activeDocTab
                        ? "text-foreground border-primary bg-primary/5 font-medium"
                        : "text-muted-foreground border-transparent hover:text-foreground hover:bg-muted/30"
                    )}
                  >
                    <span className={cn("w-2 h-2 rounded-full flex-shrink-0", color.dot)} />
                    <span className="truncate max-w-[160px]">{doc.file_name}</span>
                  </button>
                );
              })}
            </div>

            {/* Content */}
            <div
              className="flex-1 overflow-y-auto overflow-x-hidden px-6 py-5 min-w-0"
              ref={rightBodyRef}
            >
              {sourceDocs.length === 0 ? (
                <div className="text-center text-muted-foreground text-sm py-10">
                  {t("conversion.noContent")}
                </div>
              ) : (
                <SourceDocumentContent
                  doc={sourceDocs[activeIdx]}
                  iframeRef={(el) => {
                    if (el) iframeRefs.current.set(activeIdx, el);
                    else iframeRefs.current.delete(activeIdx);
                  }}
                  blockContainerRef={(el) => {
                    if (el) blockContainerRefs.current.set(activeIdx, el);
                    else blockContainerRefs.current.delete(activeIdx);
                  }}
                />
              )}
            </div>
          </div>
        </div>
      )}

      {/* Generate Confirm Dialog */}
      <AlertDialog open={generateConfirmOpen} onOpenChange={setGenerateConfirmOpen}>
        <AlertDialogContent className="max-w-sm">
          <AlertDialogHeader>
            <AlertDialogTitle>{t("conversion.generate")}</AlertDialogTitle>
            <AlertDialogDescription>{t("conversion.generateConfirmMsg")}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("dialog.cancel")}</AlertDialogCancel>
            <AlertDialogAction onClick={handleGenerate}>
              {t("conversion.confirmGenerate")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Generate Success Dialog */}
      <AlertDialog open={generateSuccessOpen} onOpenChange={setGenerateSuccessOpen}>
        <AlertDialogContent className="max-w-sm">
          <div className="flex flex-col items-center text-center pt-2 pb-4">
            <div className="w-12 h-12 rounded-full bg-green-500/15 flex items-center justify-center mb-3">
              <CheckCircle2 className="w-6 h-6 text-green-500" />
            </div>
            <AlertDialogHeader>
              <AlertDialogTitle className="text-center">
                {t("conversion.generateSuccessTitle")}
              </AlertDialogTitle>
              <AlertDialogDescription className="text-center">
                {t("conversion.generateSuccessMsg")}
              </AlertDialogDescription>
            </AlertDialogHeader>
          </div>
          <AlertDialogFooter className="flex-row justify-center gap-3 sm:justify-center">
            <AlertDialogAction
              onClick={() => {
                setGenerateSuccessOpen(false);
                onGoToEditor?.(generatedDocId);
              }}
            >
              {t("conversion.editNow")}
            </AlertDialogAction>
            <AlertDialogCancel onClick={() => onBack?.()}>
              {t("conversion.done")}
            </AlertDialogCancel>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════
   Sub-components
   ═══════════════════════════════════════════════════════════════ */

// ─── SectionBlock ───

function SectionBlock({
  title,
  expanded,
  onToggle,
  badge,
  children,
}: {
  title: string;
  expanded: boolean;
  onToggle: () => void;
  badge?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <button
        onClick={onToggle}
        className={cn(
          "flex items-center gap-2.5 w-full px-4 py-3 text-sm font-semibold rounded-lg border transition-colors",
          "bg-muted/60 border-border hover:bg-muted",
          expanded && "rounded-b-none border-b-transparent"
        )}
      >
        <ChevronRight
          className={cn(
            "w-4 h-4 text-muted-foreground transition-transform flex-shrink-0",
            expanded && "rotate-90"
          )}
        />
        <span className="flex-1 text-left">{title}</span>
        {badge && (
          <span className="text-xs font-normal text-muted-foreground bg-background/60 px-2 py-0.5 rounded-full">
            {badge}
          </span>
        )}
      </button>
      {expanded && (
        <div className="border border-t-0 border-border rounded-b-lg p-4 bg-background">
          {children}
        </div>
      )}
    </div>
  );
}

// ─── StatCard ───

function StatCard({
  label,
  value,
  suffix,
  color,
}: {
  label: string;
  value: string | number;
  suffix?: string;
  color: "green" | "blue" | "gray" | "amber" | "primary";
}) {
  const colorMap = {
    green: "text-green-400",
    blue: "text-blue-400",
    gray: "text-muted-foreground",
    amber: "text-amber-400",
    primary: "text-primary",
  };
  return (
    <div className="rounded-lg border bg-card/50 p-3.5">
      <div className="text-[11px] text-muted-foreground mb-1">{label}</div>
      <div className="flex items-baseline gap-1">
        <span className={cn("text-lg font-bold", colorMap[color])}>{value}</span>
        {suffix && <span className="text-xs text-muted-foreground">{suffix}</span>}
      </div>
    </div>
  );
}

// ─── ConflictStrip ───

function ConflictStrip({
  progress,
  t,
}: {
  progress: { resolved: number; total: number };
  t: ReturnType<typeof useTranslations>;
}) {
  const allDone = progress.resolved === progress.total;
  const pct = progress.total > 0 ? Math.round((progress.resolved / progress.total) * 100) : 100;

  return (
    <div
      className={cn(
        "sticky top-0 z-20 px-5 py-2.5 border-b flex items-center gap-3",
        allDone ? "bg-card border-green-500/20" : "bg-card border-red-500/20"
      )}
    >
      <div
        className={cn(
          "w-2 h-2 rounded-full flex-shrink-0",
          allDone ? "bg-green-500" : "bg-red-500 animate-pulse"
        )}
      />
      <span className={cn("text-xs font-semibold", allDone ? "text-green-400" : "text-red-400")}>
        {allDone
          ? t("conversion.allResolved")
          : t("conversion.conflictProgress", {
              resolved: progress.resolved,
              total: progress.total,
            })}
      </span>
      <div className="flex-1">
        <Progress
          value={pct}
          className={cn("h-1.5", allDone ? "[&>div]:bg-green-500" : "[&>div]:bg-red-500")}
        />
      </div>
    </div>
  );
}

// ─── AuxItemRow ───

function AuxItemRow({
  title,
  html,
  text,
  imagePath,
  sourceFile,
  extra,
  onLocate,
}: {
  title?: string;
  html?: string;
  text?: string;
  imagePath?: string;
  sourceFile?: string;
  extra?: string;
  onLocate: (file: string, snippet: string) => void;
}) {
  return (
    <div className="rounded-lg border bg-card/50 p-3 text-sm">
      {!!title && (
        <div className="font-semibold text-foreground mb-2">{title}</div>
      )}
      {extra && (
        <div className="text-[11px] text-muted-foreground mb-2">{extra}</div>
      )}
      {imagePath ? (
        <div className="rounded border bg-muted/20 p-2 flex items-center justify-center">
          <img src={imagePath} alt={title ?? ""} className="max-w-full h-auto rounded" />
        </div>
      ) : html ? (
        <div
          className="prose prose-sm dark:prose-invert max-w-none text-xs [&_table]:w-full [&_table]:border-collapse [&_td]:border [&_td]:border-border [&_td]:px-2 [&_td]:py-1 [&_th]:border [&_th]:border-border [&_th]:px-2 [&_th]:py-1 [&_th]:bg-muted/50"
          dangerouslySetInnerHTML={{ __html: html }}
        />
      ) : text ? (
        <div className="text-xs text-muted-foreground whitespace-pre-wrap">{text}</div>
      ) : null}
      {!!sourceFile && sourceFile !== AUTO_GENERATED_SOURCE && (
        <button
          type="button"
          className="text-[11px] text-muted-foreground mt-2 hover:text-primary hover:underline transition-colors"
          onClick={() => onLocate(sourceFile, pickSearchSnippet(title ?? ""))}
        >
          {sourceFile}
        </button>
      )}
    </div>
  );
}

// ─── QualityOverviewPanel ───

function QualityOverviewPanel({
  quality,
  t,
}: {
  quality: QualityMetrics;
  t: ReturnType<typeof useTranslations>;
}) {
  return (
    <div className="grid grid-cols-2 gap-3">
      <StatCard
        label={t("conversion.structureComplete")}
        value={`${Math.round(quality.structure_completeness * 100)}%`}
        color={quality.structure_completeness >= 0.8 ? "green" : "amber"}
      />
      <StatCard
        label={t("conversion.l2Coverage")}
        value={`${quality.l2_found}/${quality.l2_expected}`}
        color={quality.l2_found === quality.l2_expected ? "green" : "amber"}
      />
      <StatCard
        label={t("conversion.l3Coverage")}
        value={`${quality.l3_found}/${quality.l3_expected}`}
        color={quality.l3_found === quality.l3_expected ? "green" : "amber"}
      />
      <StatCard
        label={t("conversion.l3WithDesc")}
        value={quality.l3_with_description}
        suffix={`/ ${quality.l3_found}`}
        color="blue"
      />
    </div>
  );
}

// ─── AutoResizeTextarea ───
// 高度随内容撑开的 textarea。ChapterConflictCard 的"AI 合并文本"框和
// EditableChapterText 都用它；不要各写一份 scrollHeight 自适应逻辑。

function AutoResizeTextarea(
  props: Omit<React.TextareaHTMLAttributes<HTMLTextAreaElement>, "onChange" | "ref"> & {
    value: string;
    onValueChange: (value: string) => void;
  },
) {
  const { value, onValueChange, rows = 2, className, ...rest } = props;
  const resize = (el: HTMLTextAreaElement) => {
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  };
  return (
    <textarea
      {...rest}
      value={value}
      rows={rows}
      className={className}
      onChange={(e) => {
        onValueChange(e.target.value);
        resize(e.target);
      }}
      ref={(el) => {
        if (el) resize(el);
      }}
    />
  );
}

// ─── 章节自定义文本写入：设 pick=custom + 覆写 chapter_custom_texts。
// 后端 _resolve_chapter 在 pick=="custom" 时取 custom 文本；Ch3 额外会清空 ch3_roles。
function setChapterCustomText(
  setDecisions: React.Dispatch<React.SetStateAction<HandbookDecisions>>,
  key: string,
  text: string,
) {
  setDecisions((prev) => ({
    ...prev,
    chapter_picks: { ...prev.chapter_picks, [key]: "custom" },
    chapter_custom_texts: { ...prev.chapter_custom_texts, [key]: text },
  }));
}

// ─── EditableChapterText ───
// 无 conflict（单源/无冲突）时 Ch1/Ch2/Ch3 的编辑入口。

function EditableChapterText({
  chapterNum,
  initialText,
  decisions,
  setDecisions,
  t,
}: {
  chapterNum: number;
  initialText: string;
  decisions: HandbookDecisions;
  setDecisions: React.Dispatch<React.SetStateAction<HandbookDecisions>>;
  t: ReturnType<typeof useTranslations>;
}) {
  const key = chKey(chapterNum);
  const value = decisions.chapter_custom_texts[key] ?? initialText;
  return (
    <div className="rounded-lg border bg-card/50 p-3">
      <AutoResizeTextarea
        value={value}
        onValueChange={(text) => setChapterCustomText(setDecisions, key, text)}
        placeholder={t("conversion.noContent")}
        rows={3}
        className="w-full rounded-md border bg-background px-3 py-2 text-[13px] text-foreground leading-relaxed resize-y focus:outline-none focus:ring-1 focus:ring-primary"
      />
    </div>
  );
}

// ─── TextContentBlock ───

function TextContentBlock({ text, t }: { text?: string; t: ReturnType<typeof useTranslations> }) {
  if (!text) {
    return (
      <div className="text-xs text-muted-foreground text-center py-4">
        {t("conversion.noContent")}
      </div>
    );
  }
  return (
    <div className="rounded-lg border bg-card/50 p-4 text-[13px] text-muted-foreground leading-relaxed whitespace-pre-wrap">
      {text}
    </div>
  );
}

// ─── RoleDutyList ───

function RoleDutyList({ roles }: { roles: RoleDuty[] }) {
  const valid = roles.filter((r) => r.position && r.duties?.length > 0);
  if (valid.length === 0) return null;
  return (
    <div className="rounded-lg border bg-card/50 p-4 space-y-3">
      {valid.map((role, i) => (
        <div key={`${role.position}-${i}`} className="space-y-1.5">
          <div className="text-[13px] font-semibold text-foreground">
            {`3.${i + 1}  ${role.position}`}
          </div>
          <div className="space-y-1 pl-2">
            {role.duties.map((duty, j) => (
              <div
                key={j}
                className="text-[13px] text-muted-foreground leading-relaxed whitespace-pre-wrap"
              >
                {`3.${i + 1}.${j + 1}  ${duty}`}
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

// ─── ChapterConflictCard ───

function ChapterConflictCard({
  conflict,
  decisions,
  setDecisions,
  t,
  onLocate,
}: {
  conflict: ChapterConflict;
  decisions: HandbookDecisions;
  setDecisions: React.Dispatch<React.SetStateAction<HandbookDecisions>>;
  t: ReturnType<typeof useTranslations>;
  onLocate?: (sourceFile: string, searchText?: string) => void;
}) {
  const chapterNum = conflict.chapter;
  const key = chKey(chapterNum);
  const pick = decisions.chapter_picks[key];
  const customText = decisions.chapter_custom_texts[key] ?? conflict.merged_text;
  const isResolved = pick != null;
  const labelKey = CHAPTER_LABEL_KEYS[chapterNum];

  const handlePick = (value: string) => {
    setDecisions((prev) => {
      const newPicks = { ...prev.chapter_picks, [key]: value };
      const newTexts = { ...prev.chapter_custom_texts };

      if (value === "merged") {
        newTexts[key] = conflict.merged_text;
      } else {
        const candidate = conflict.candidates.find((c) => c.candidate_id === value);
        if (candidate) {
          newTexts[key] = candidate.text;
        }
      }

      return { ...prev, chapter_picks: newPicks, chapter_custom_texts: newTexts };
    });
  };

  const handleTextChange = (text: string) => setChapterCustomText(setDecisions, key, text);

  return (
    <div
      className={cn(
        "rounded-lg border border-l-4 p-4 space-y-3",
        isResolved ? "border-l-green-500 bg-card/50" : "border-l-red-500 bg-card/50"
      )}
    >
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <AlertTriangle
            className={cn("w-4 h-4", isResolved ? "text-green-500" : "text-red-500")}
          />
          <span className="text-sm font-semibold">
            Ch{chapterNum} {labelKey ? t(`conversion.${labelKey}`) : conflict.chapter_name} —{" "}
            {conflict.candidates.length} {t("conversion.sourceCandidate")}
          </span>
        </div>
        <span
          className={cn(
            "text-[10px] font-semibold px-2 py-0.5 rounded-full",
            isResolved ? "bg-green-500/10 text-green-400" : "bg-red-500/10 text-red-400"
          )}
        >
          {isResolved ? t("conversion.resolved") : t("conversion.unresolved")}
        </span>
      </div>

      {/* AI Merged option */}
      <label
        className={cn(
          "flex items-start gap-3 rounded-lg border p-3 cursor-pointer transition-colors",
          pick === "merged" || pick === "custom"
            ? "border-primary bg-primary/5"
            : "border-border hover:bg-muted/30"
        )}
      >
        <input
          type="radio"
          name={`ch-conflict-${chapterNum}`}
          checked={pick === "merged" || pick === "custom"}
          onChange={() => handlePick("merged")}
          className="mt-1 accent-primary"
        />
        <div className="flex-1 min-w-0">
          <div className="text-xs font-semibold text-primary mb-2">
            {t("conversion.aiMergedText")}
          </div>
          <AutoResizeTextarea
            value={customText}
            onValueChange={handleTextChange}
            rows={2}
            className="w-full rounded-md border bg-background px-3 py-2 text-xs text-foreground leading-relaxed resize-y focus:outline-none focus:ring-1 focus:ring-primary"
          />
        </div>
      </label>

      {/* Source candidates */}
      <div className="grid grid-cols-2 gap-3">
        {conflict.candidates.map((candidate, idx) => {
          const color = getSourceColor(idx);
          const isSelected = pick === candidate.candidate_id;
          const searchSnippet = pickSearchSnippet(candidate.text);
          return (
            <label
              key={candidate.candidate_id}
              className={cn(
                "rounded-lg border p-3 cursor-pointer transition-colors",
                isSelected ? "border-primary bg-primary/5" : "border-border hover:bg-muted/30"
              )}
            >
              <div className="flex items-start gap-2">
                <input
                  type="radio"
                  name={`ch-conflict-${chapterNum}`}
                  checked={isSelected}
                  onChange={() => {
                    handlePick(candidate.candidate_id);
                    onLocate?.(candidate.source_file, searchSnippet);
                  }}
                  className="mt-0.5 accent-primary"
                />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5 mb-1.5">
                    <span className={cn("w-2 h-2 rounded-full flex-shrink-0", color.dot)} />
                    <button
                      type="button"
                      className="text-xs font-medium text-foreground truncate hover:text-primary hover:underline transition-colors"
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        onLocate?.(candidate.source_file, searchSnippet);
                      }}
                      title={t("conversion.locateSource")}
                    >
                      {candidate.source_file}
                    </button>
                    <span className="text-[10px] text-muted-foreground ml-auto flex-shrink-0">
                      {t("conversion.charCount", { count: candidate.char_count })}
                    </span>
                  </div>
                  <div
                    className="text-[11px] text-muted-foreground leading-relaxed whitespace-pre-wrap cursor-pointer hover:text-foreground/80 hover:underline transition-colors"
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      onLocate?.(candidate.source_file, searchSnippet);
                    }}
                  >
                    {candidate.text}
                  </div>
                </div>
              </div>
            </label>
          );
        })}
      </div>
    </div>
  );
}

// ─── L2ChapterBlock ───

function L2ChapterBlock({
  l2,
  getL3Conflict,
  decisions,
  setDecisions,
  t,
  onLocate,
}: {
  l2: L2Chapter;
  getL3Conflict: (l3Code: string) => L3FlowConflict | undefined;
  decisions: HandbookDecisions;
  setDecisions: React.Dispatch<React.SetStateAction<HandbookDecisions>>;
  t: ReturnType<typeof useTranslations>;
  onLocate?: (sourceFile: string, searchText?: string, blockIds?: string) => void;
}) {
  return (
    <div className="rounded-lg border bg-card/50 overflow-hidden">
      {/* L2 header */}
      <div className="px-4 py-2.5 border-b bg-muted/30 flex items-center gap-2">
        <span className="font-mono text-xs font-semibold text-primary bg-primary/10 px-2 py-0.5 rounded">
          {l2.l2_code}
        </span>
        <span className="text-sm font-semibold text-foreground">{l2.l2_name}</span>
        <span className="text-[10px] text-muted-foreground ml-auto">
          {l2.l3_sections.length} L3
        </span>
      </div>

      {/* L2 architecture diagram */}
      {l2.arch_diagram_path && (
        <div className="p-3 border-b">
          <img
            src={l2.arch_diagram_path}
            alt={`${l2.l2_name} architecture`}
            className="max-w-full h-auto rounded"
          />
        </div>
      )}

      {/* L3 sections */}
      <div className="divide-y divide-border">
        {l2.l3_sections.map((l3) => {
          const conflict = getL3Conflict(l3.l3_code);
          return (
            <div key={l3.l3_code} className="px-4 py-3">
              <div className="flex items-center gap-2 mb-2">
                <span className="font-mono text-[11px] text-muted-foreground">{l3.l3_code}</span>
                <span className="text-xs font-medium text-foreground">{l3.l3_name}</span>
                {conflict && (
                  <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-red-500/10 text-red-400 ml-auto">
                    {t("conversion.flowConflict")}
                  </span>
                )}
              </div>

              {conflict ? (
                <L3FlowConflictCard
                  conflict={conflict}
                  decisions={decisions}
                  setDecisions={setDecisions}
                  t={t}
                  onLocate={onLocate}
                />
              ) : (
                <L3NormalContent l3={l3} t={t} onLocate={onLocate} />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── L3NormalContent ───

function L3NormalContent({
  l3,
  t,
  onLocate,
}: {
  l3: {
    l3_code: string;
    l3_name: string;
    source_file?: string;
    description_table: DescriptionRow[];
    interface_table: Array<Record<string, string>>;
  };
  t: ReturnType<typeof useTranslations>;
  onLocate?: (sourceFile: string, searchText?: string, blockIds?: string) => void;
}) {
  const hasDesc = l3.description_table.length > 0;
  const hasInterface = l3.interface_table.length > 0;

  if (!hasDesc && !hasInterface) {
    return <div className="text-[11px] text-muted-foreground">{t("conversion.noContent")}</div>;
  }

  return (
    <div className="space-y-2">
      {hasDesc && (
        <div>
          <div className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide mb-1">
            {t("conversion.descriptionTable")} ({l3.description_table.length} {t("conversion.rows")}
            )
          </div>
          <DescriptionTable rows={l3.description_table} l3={l3} t={t} onLocate={onLocate} />
        </div>
      )}
      {hasInterface && (
        <div>
          <div className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide mb-1">
            {t("conversion.interfaceTable")} ({l3.interface_table.length} {t("conversion.rows")})
          </div>
          <InterfaceTable rows={l3.interface_table} l3={l3} t={t} onLocate={onLocate} />
        </div>
      )}
    </div>
  );
}

// ─── DescriptionTable (full, traceable) ───

function DescriptionTable({
  rows,
  l3,
  t,
  onLocate,
  maxRows,
}: {
  rows: DescriptionRow[];
  l3?: { l3_name?: string; source_file?: string };
  t: ReturnType<typeof useTranslations>;
  onLocate?: (sourceFile: string, searchText?: string, blockIds?: string) => void;
  maxRows?: number;
}) {
  const display = maxRows ? rows.slice(0, maxRows) : rows;
  const hasExtraCols = rows.some(
    (r) => r.department || r.position || (r.input_ || r.input) || r.output,
  );

  const handleRowClick = (row: DescriptionRow) => {
    if (!onLocate) return;
    const sf = row.source_file || l3?.source_file || "";
    const blockIds = (row.source_block_ids ?? []).join(" ");
    const searchText = pickSearchSnippet(row.content || "");
    if (!sf && !searchText) return;
    onLocate(sf, searchText, blockIds || undefined);
  };

  return (
    <div className="overflow-x-auto rounded border">
      <table className="w-full text-[11px]">
        <thead>
          <tr className="bg-muted/40">
            <th className="px-2 py-1.5 text-left font-semibold text-muted-foreground w-14">
              {t("conversion.tableHeaders.l4")}
            </th>
            <th className="px-2 py-1.5 text-left font-semibold text-muted-foreground w-14">
              {t("conversion.tableHeaders.step")}
            </th>
            <th className="px-2 py-1.5 text-left font-semibold text-muted-foreground">
              {t("conversion.tableHeaders.content")}
            </th>
            {hasExtraCols && (
              <>
                <th className="px-2 py-1.5 text-left font-semibold text-muted-foreground w-16">
                  {t("conversion.tableHeaders.department")}
                </th>
                <th className="px-2 py-1.5 text-left font-semibold text-muted-foreground w-16">
                  {t("conversion.tableHeaders.position")}
                </th>
                <th className="px-2 py-1.5 text-left font-semibold text-muted-foreground w-16">
                  {t("conversion.tableHeaders.input")}
                </th>
                <th className="px-2 py-1.5 text-left font-semibold text-muted-foreground w-16">
                  {t("conversion.tableHeaders.output")}
                </th>
              </>
            )}
          </tr>
        </thead>
        <tbody>
          {display.map((r, i) => {
            const isTraceable = !!onLocate;
            return (
              <tr
                key={i}
                className={cn(
                  "border-t border-border/50",
                  isTraceable &&
                    "cursor-pointer transition-colors hover:bg-primary/5 hover:shadow-[inset_2px_0_0_hsl(var(--primary))]",
                )}
                onClick={() => handleRowClick(r)}
                title={isTraceable ? t("conversion.clickToLocate") : undefined}
              >
                <td className="px-2 py-1 font-mono text-muted-foreground">{r.l4}</td>
                <td className="px-2 py-1 text-muted-foreground">{r.step}</td>
                <td className="px-2 py-1 text-foreground">{r.content}</td>
                {hasExtraCols && (
                  <>
                    <td className="px-2 py-1 text-muted-foreground">{r.department}</td>
                    <td className="px-2 py-1 text-muted-foreground">{r.position}</td>
                    <td className="px-2 py-1 text-muted-foreground">{r.input_ || r.input}</td>
                    <td className="px-2 py-1 text-muted-foreground">{r.output}</td>
                  </>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
      {maxRows && rows.length > maxRows && (
        <div className="text-[10px] text-muted-foreground text-center py-1 border-t bg-muted/20">
          +{rows.length - maxRows} more
        </div>
      )}
    </div>
  );
}

// ─── InterfaceTable (full, traceable) ───

function InterfaceTable({
  rows,
  l3,
  t,
  onLocate,
  maxRows,
}: {
  rows: Array<Record<string, string>>;
  l3?: { l3_name?: string; source_file?: string };
  t: ReturnType<typeof useTranslations>;
  onLocate?: (sourceFile: string, searchText?: string, blockIds?: string) => void;
  maxRows?: number;
}) {
  if (rows.length === 0) return null;
  const HIDDEN_COLUMNS = new Set(["source_block_ids", "source_file"]);
  const headers = Object.keys(rows[0]).filter((h) => !HIDDEN_COLUMNS.has(h));
  const display = maxRows ? rows.slice(0, maxRows) : rows;

  const headerLabel = (key: string) => {
    try {
      return t(`conversion.tableHeaders.${key}`);
    } catch {
      return key;
    }
  };

  const handleRowClick = (row: Record<string, string>) => {
    if (!onLocate) return;
    const sf = row.source_file || l3?.source_file || "";
    const rawBlockIds = row.source_block_ids;
    const blockIds = Array.isArray(rawBlockIds) ? rawBlockIds.join(" ") : (rawBlockIds || "");
    const searchText =
      (row.external_process || "") + " " + (row.key_node || "");
    if (!sf && !searchText.trim()) return;
    onLocate(sf, pickSearchSnippet(searchText.trim()), blockIds || undefined);
  };

  return (
    <div className="overflow-x-auto rounded border">
      <table className="w-full text-[11px]">
        <thead>
          <tr className="bg-muted/40">
            {headers.map((h) => (
              <th key={h} className="px-2 py-1.5 text-left font-semibold text-muted-foreground">
                {headerLabel(h)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {display.map((r, i) => {
            const isTraceable = !!onLocate;
            return (
              <tr
                key={i}
                className={cn(
                  "border-t border-border/50",
                  isTraceable &&
                    "cursor-pointer transition-colors hover:bg-primary/5 hover:shadow-[inset_2px_0_0_hsl(var(--primary))]",
                )}
                onClick={() => handleRowClick(r)}
                title={isTraceable ? t("conversion.clickToLocate") : undefined}
              >
                {headers.map((h) => (
                  <td key={h} className="px-2 py-1 text-foreground">
                    {r[h]}
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
      {maxRows && rows.length > maxRows && (
        <div className="text-[10px] text-muted-foreground text-center py-1 border-t bg-muted/20">
          +{rows.length - maxRows} more
        </div>
      )}
    </div>
  );
}

// ─── L3FlowConflictCard ───

function L3FlowConflictCard({
  conflict,
  decisions,
  setDecisions,
  t,
  onLocate,
}: {
  conflict: L3FlowConflict;
  decisions: HandbookDecisions;
  setDecisions: React.Dispatch<React.SetStateAction<HandbookDecisions>>;
  t: ReturnType<typeof useTranslations>;
  onLocate?: (sourceFile: string, searchText?: string, blockIds?: string) => void;
}) {
  const pick = decisions.l3_flow_picks[conflict.conflict_id];
  const isResolved = pick != null;

  const handlePick = (value: string) => {
    setDecisions((prev) => ({
      ...prev,
      l3_flow_picks: { ...prev.l3_flow_picks, [conflict.conflict_id]: value },
    }));
  };

  return (
    <div
      className={cn(
        "rounded-lg border border-l-4 p-3 space-y-3",
        isResolved ? "border-l-green-500" : "border-l-red-500"
      )}
    >
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold">
            {conflict.l3_code} {conflict.l3_name} — {conflict.sources.length} sources
          </span>
          <span
            className={cn(
              "text-[10px] px-1.5 py-0.5 rounded-full font-medium",
              conflict.severity === "high"
                ? "bg-red-500/10 text-red-400"
                : conflict.severity === "medium"
                  ? "bg-amber-500/10 text-amber-400"
                  : "bg-blue-500/10 text-blue-400"
            )}
          >
            {t("conversion.severity")}: {conflict.severity}
          </span>
        </div>
        <span
          className={cn(
            "text-[10px] font-semibold px-2 py-0.5 rounded-full",
            isResolved ? "bg-green-500/10 text-green-400" : "bg-red-500/10 text-red-400"
          )}
        >
          {isResolved ? t("conversion.resolved") : t("conversion.unresolved")}
        </span>
      </div>

      {/* Source panels */}
      {conflict.sources.map((source, idx) => {
        const color = getSourceColor(idx);
        const isSelected = pick === source.source_file;
        return (
          <label
            key={source.source_file}
            className={cn(
              "block rounded-lg border p-3 cursor-pointer transition-colors",
              isSelected ? "border-primary bg-primary/5" : "border-border hover:bg-muted/30"
            )}
          >
            <div className="flex items-center gap-2 mb-2">
              <input
                type="radio"
                name={`l3-conflict-${conflict.conflict_id}`}
                checked={isSelected}
                onChange={() => handlePick(source.source_file)}
                className="accent-primary"
              />
              <span className={cn("w-2 h-2 rounded-full", color.dot)} />
              <button
                type="button"
                className="text-xs font-medium text-foreground hover:text-primary hover:underline transition-colors"
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  const firstContent = source.description_rows[0]?.content ?? source.interface_rows[0]?.content ?? "";
                  onLocate?.(source.source_file, pickSearchSnippet(firstContent));
                }}
                title={t("conversion.locateSource")}
              >
                {source.source_file}
              </button>
              <span className="text-[10px] text-muted-foreground ml-auto">
                {t("conversion.descriptionTable")}:{source.description_rows.length}
                {t("conversion.rows")}
                {" | "}
                {t("conversion.interfaceTable")}:{source.interface_rows.length}
                {t("conversion.rows")}
              </span>
            </div>
            {source.description_rows.length > 0 && (
              <DescriptionTable
                rows={source.description_rows}
                l3={{ source_file: source.source_file }}
                t={t}
                onLocate={onLocate}
                maxRows={3}
              />
            )}
          </label>
        );
      })}

      {/* Merge option */}
      <label
        className={cn(
          "flex items-center gap-2 rounded-lg border p-3 cursor-pointer transition-colors",
          pick === "merge" ? "border-primary bg-primary/5" : "border-border hover:bg-muted/30"
        )}
      >
        <input
          type="radio"
          name={`l3-conflict-${conflict.conflict_id}`}
          checked={pick === "merge"}
          onChange={() => handlePick("merge")}
          className="accent-primary"
        />
        <span className="text-xs font-medium text-foreground">{t("conversion.mergeSources")}</span>
      </label>
    </div>
  );
}

// ─── AppendixDedupCard ───

function AppendixDedupCard({
  group,
  decisions,
  setDecisions,
  t,
}: {
  group: AppendixDedupGroup;
  decisions: HandbookDecisions;
  setDecisions: React.Dispatch<React.SetStateAction<HandbookDecisions>>;
  t: ReturnType<typeof useTranslations>;
}) {
  const pick = decisions.appendix_dedup[group.group_id];

  const handlePick = (value: string) => {
    setDecisions((prev) => ({
      ...prev,
      appendix_dedup: { ...prev.appendix_dedup, [group.group_id]: value },
    }));
  };

  return (
    <div className="rounded-lg border bg-card/50 p-3 space-y-2">
      <div className="flex items-center gap-2">
        <span className="text-xs font-semibold text-foreground">
          {t("conversion.appendixDedup")}
          {group.appendix_indices?.length ? `: ${group.appendix_indices.join(", ")}` : ""}
        </span>
      </div>
      <div className="text-[11px] text-muted-foreground">{group.reason}</div>
      <div className="flex gap-2">
        <button
          onClick={() => handlePick("keep_all")}
          className={cn(
            "px-3 py-1.5 text-[11px] font-medium rounded border transition-colors",
            pick === "keep_all"
              ? "bg-primary/10 text-primary border-primary/40"
              : "bg-muted/30 text-muted-foreground border-border hover:bg-muted/50"
          )}
        >
          {t("conversion.keepAll")}
        </button>
      </div>
    </div>
  );
}

// ─── SourceDocumentContent ───

function SourceDocumentContent({
  doc,
  iframeRef,
  blockContainerRef,
}: {
  doc: AnalyzeSourceDocument;
  iframeRef?: (el: HTMLIFrameElement | null) => void;
  blockContainerRef?: (el: HTMLDivElement | null) => void;
}) {
  // Prefer preview_html — render in isolated iframe to prevent overflow
  if (doc.preview_html) {
    // Wrap in a full HTML document so styles work properly inside the iframe
    const srcdoc = `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
      body { margin: 0; padding: 16px; font-family: -apple-system, "PingFang SC", sans-serif; font-size: 13px; background: transparent; }
      .page-container, .page, [class*="page"] { max-width: 100% !important; width: 100% !important; box-sizing: border-box; overflow-x: hidden; }
      table { width: 100%; border-collapse: collapse; font-size: 12px; }
      th, td { border: 1px solid #d1d5db; padding: 6px 10px; text-align: left; }
      th { background: rgba(0,0,0,0.03); font-weight: 600; }
      img { max-width: 100%; height: auto; }
    </style></head><body>${doc.preview_html}</body></html>`;
    return (
      <iframe
        ref={iframeRef}
        srcDoc={srcdoc}
        className="w-full border-0 min-h-[600px]"
        style={{ height: "100%", background: "transparent" }}
        sandbox="allow-same-origin"
        title={doc.file_name}
      />
    );
  }

  // Render blocks
  if (doc.blocks && doc.blocks.length > 0) {
    return (
      <div className="space-y-4" ref={blockContainerRef}>
        {doc.blocks.map((block, idx) => (
          <SourceBlock key={block.block_id ?? idx} block={block} />
        ))}
      </div>
    );
  }

  return (
    <div className="text-center text-muted-foreground text-sm py-10">No preview available</div>
  );
}

// ─── SourceBlock ───

function SourceBlock({
  block,
}: {
  block: { type: string; text?: string; html?: string; heading_level?: number };
}) {
  if (block.type === "heading" && block.text) {
    const level = block.heading_level ?? 2;
    const sizeClass =
      level === 1
        ? "text-lg font-bold"
        : level === 2
          ? "text-base font-semibold"
          : "text-sm font-semibold";
    return <div className={cn(sizeClass, "text-foreground mt-2")}>{block.text}</div>;
  }

  if (block.type === "table" && block.html) {
    return (
      <div
        className="overflow-x-auto rounded border text-xs [&_table]:w-full [&_td]:border [&_td]:border-border [&_td]:px-2 [&_td]:py-1 [&_th]:border [&_th]:border-border [&_th]:px-2 [&_th]:py-1 [&_th]:bg-muted/40 [&_th]:text-left [&_th]:font-semibold"
        dangerouslySetInnerHTML={{ __html: block.html }}
      />
    );
  }

  if (block.type === "list" && block.html) {
    return (
      <div
        className="text-[13px] text-muted-foreground leading-relaxed [&_ul]:pl-5 [&_ol]:pl-5 [&_li]:mb-1"
        dangerouslySetInnerHTML={{ __html: block.html }}
      />
    );
  }

  // Default: paragraph / text
  if (block.html) {
    return (
      <div
        className="text-[13px] text-muted-foreground leading-relaxed"
        dangerouslySetInnerHTML={{ __html: block.html }}
      />
    );
  }

  if (block.text) {
    return (
      <p className="text-[13px] text-muted-foreground leading-relaxed whitespace-pre-wrap">
        {block.text}
      </p>
    );
  }

  return null;
}
