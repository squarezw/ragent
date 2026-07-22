"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { useDebounce } from "use-debounce";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { ChevronRight, Database, Loader2, Search } from "lucide-react";
import { cn } from "@/lib/utils";
import axios from "@/lib/axios";
import { formatFileSize } from "./processConstants";

const SEARCH_LIMIT = 200;
const PAGE_SIZE = 50;

interface Dataset {
  id: string;
  name: string;
  file_count?: number;
}

interface FileItem {
  id: string;
  filename: string;
  originalname: string;
  object_key?: string;
  size: number;
  upload_time: string;
}

interface SearchHit extends FileItem {
  dataset_id: string;
  dataset_name: string;
}

interface DsState {
  files: FileItem[];
  page: number;
  hasMore: boolean;
  loading: boolean;
}

/** Sentinel at the bottom of a list that invokes `onVisible` when scrolled into view. */
function LoadMoreSentinel({
  onVisible,
  rootRef,
}: {
  onVisible: () => void;
  rootRef: React.RefObject<HTMLElement | null>;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  const cbRef = useRef(onVisible);
  cbRef.current = onVisible;

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) cbRef.current();
      },
      { root: rootRef.current, rootMargin: "60px", threshold: 0 }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [rootRef]);

  return <div ref={ref} aria-hidden className="h-1" />;
}

function FileRow({
  file,
  checked,
  onToggle,
}: {
  file: FileItem;
  checked: boolean;
  onToggle: () => void;
}) {
  return (
    <label className="flex items-center gap-2 px-2 py-1.5 rounded cursor-pointer hover:bg-muted/30 transition-colors">
      <Checkbox checked={checked} onCheckedChange={onToggle} />
      <span className="flex-1 text-xs text-foreground truncate">
        {file.originalname || file.filename}
      </span>
      <span className="text-[11px] text-muted-foreground flex-shrink-0">
        {formatFileSize(file.size)}
      </span>
    </label>
  );
}

interface ProcessMigrationDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Selected files callback: returns file IDs, OSS keys and display names */
  onMerge?: (fileIds: string[], fileKeys: string[], fileNames: string[]) => void;
}

export default function ProcessMigrationDialog({
  open,
  onOpenChange,
  onMerge,
}: ProcessMigrationDialogProps) {
  const t = useTranslations("processManagement");
  const [datasets, setDatasets] = useState<Dataset[]>([]);
  const [datasetsLoading, setDatasetsLoading] = useState(false);
  const [expandedDs, setExpandedDs] = useState<Set<string>>(new Set());
  const [dsState, setDsState] = useState<Record<string, DsState>>({});
  // Map<fileId, { key: OSS object key, name: display name }>
  const [checkedFiles, setCheckedFiles] = useState<Map<string, { key: string; name: string }>>(
    new Map()
  );
  const [searchInput, setSearchInput] = useState("");
  const [debouncedSearch] = useDebounce(searchInput.trim(), 300);
  const searchQuery = debouncedSearch;
  const [searchResults, setSearchResults] = useState<SearchHit[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchTruncated, setSearchTruncated] = useState(false);
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);
  // Per-dataset in-flight guard (keeps `loadMore` synchronous about dedup regardless of setState timing)
  const loadingRef = useRef<Set<string>>(new Set());

  const loadDatasets = useCallback(async () => {
    setDatasetsLoading(true);
    try {
      const resp = await axios.get("/api/datasets");
      setDatasets(resp.data || []);
    } catch {
      setDatasets([]);
    } finally {
      setDatasetsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (open) {
      loadDatasets();
      setCheckedFiles(new Map());
      setDsState({});
      setExpandedDs(new Set());
      setSearchInput("");
      setSearchResults([]);
      setSearchTruncated(false);
      loadingRef.current.clear();
    }
  }, [open, loadDatasets]);

  // Run cross-dataset search when query changes
  useEffect(() => {
    if (!open) return;
    if (!searchQuery) {
      setSearchResults([]);
      setSearchTruncated(false);
      setSearchLoading(false);
      return;
    }
    let cancelled = false;
    setSearchLoading(true);
    axios
      .get("/api/knowledge/files-across-datasets", {
        params: { search: searchQuery, limit: SEARCH_LIMIT },
      })
      .then((resp) => {
        if (cancelled) return;
        setSearchResults(resp.data?.files || []);
        setSearchTruncated(Boolean(resp.data?.truncated));
      })
      .catch(() => {
        if (cancelled) return;
        setSearchResults([]);
        setSearchTruncated(false);
      })
      .finally(() => {
        if (cancelled) return;
        setSearchLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, searchQuery]);

  const loadMore = useCallback(
    async (datasetId: string) => {
      if (loadingRef.current.has(datasetId)) return;
      const current = dsState[datasetId];
      if (current && !current.hasMore) return;
      const nextPage = (current?.page ?? 0) + 1;

      loadingRef.current.add(datasetId);
      setDsState((prev) => ({
        ...prev,
        [datasetId]: {
          files: prev[datasetId]?.files ?? [],
          page: prev[datasetId]?.page ?? 0,
          hasMore: prev[datasetId]?.hasMore ?? true,
          loading: true,
        },
      }));

      try {
        const resp = await axios.get("/api/knowledge/list", {
          params: { dataset_id: datasetId, page: nextPage, page_size: PAGE_SIZE },
        });
        const newFiles: FileItem[] = resp.data?.files || [];
        const pagination = resp.data?.pagination;
        const hasMore =
          typeof pagination?.total_pages === "number"
            ? nextPage < pagination.total_pages
            : newFiles.length >= PAGE_SIZE;
        setDsState((prev) => ({
          ...prev,
          [datasetId]: {
            files: [...(prev[datasetId]?.files ?? []), ...newFiles],
            page: nextPage,
            hasMore,
            loading: false,
          },
        }));
      } catch {
        setDsState((prev) => ({
          ...prev,
          [datasetId]: {
            files: prev[datasetId]?.files ?? [],
            page: prev[datasetId]?.page ?? 0,
            hasMore: false,
            loading: false,
          },
        }));
      } finally {
        loadingRef.current.delete(datasetId);
      }
    },
    [dsState]
  );

  const toggleDs = (id: string) => {
    setExpandedDs((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
        // Kick off first page load if nothing loaded yet
        if (!dsState[id]) loadMore(id);
      }
      return next;
    });
  };

  const toggleFile = (id: string, objectKey: string, displayName: string) => {
    setCheckedFiles((prev) => {
      const next = new Map(prev);
      if (next.has(id)) next.delete(id);
      else next.set(id, { key: objectKey, name: displayName });
      return next;
    });
  };

  const handleMerge = () => {
    const ids = [...checkedFiles.keys()];
    const entries = [...checkedFiles.values()];
    onMerge?.(
      ids,
      entries.map((e) => e.key),
      entries.map((e) => e.name)
    );
    setCheckedFiles(new Map());
    onOpenChange(false);
  };

  const isSearching = searchQuery.length > 0;

  // Group by dataset, preserving first-seen order (API returns by upload_time DESC).
  const groupedSearchResults = useMemo(() => {
    if (!isSearching) return [] as Array<{ id: string; name: string; files: SearchHit[] }>;
    const map = new Map<string, { id: string; name: string; files: SearchHit[] }>();
    for (const file of searchResults) {
      const group = map.get(file.dataset_id);
      if (group) {
        group.files.push(file);
      } else {
        map.set(file.dataset_id, {
          id: file.dataset_id,
          name: file.dataset_name,
          files: [file],
        });
      }
    }
    return [...map.values()];
  }, [isSearching, searchResults]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[560px]">
        <DialogHeader>
          <DialogTitle>{t("migration.title")}</DialogTitle>
          <p className="text-xs text-muted-foreground mt-1">{t("migration.subtitle")}</p>
        </DialogHeader>

        <div className="relative my-3">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
          <Input
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder={t("migration.searchPlaceholder")}
            className="h-9 pl-8 text-sm"
          />
        </div>

        <div ref={scrollContainerRef} className="max-h-[400px] overflow-y-auto space-y-1.5 pr-1">
          {isSearching ? (
            searchLoading ? (
              <div className="flex items-center justify-center py-8 text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
                <span className="text-sm">{t("migration.searching")}</span>
              </div>
            ) : searchResults.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground text-sm">
                {t("migration.noSearchResult")}
              </div>
            ) : (
              <>
                {groupedSearchResults.map((group) => (
                  <div key={group.id}>
                    {/* Dataset Header */}
                    <div className="flex items-center gap-2 w-full px-2.5 py-2 rounded-md bg-muted/40 border text-sm font-semibold">
                      <Database className="h-4 w-4 flex-shrink-0" />
                      <span className="flex-1 text-left truncate">{group.name}</span>
                      <span className="text-xs text-muted-foreground font-normal">
                        {group.files.length} {t("migration.files")}
                      </span>
                    </div>
                    <div className="pl-7 mt-1 space-y-0.5">
                      {group.files.map((file) => (
                        <FileRow
                          key={file.id}
                          file={file}
                          checked={checkedFiles.has(file.id)}
                          onToggle={() =>
                            toggleFile(
                              file.id,
                              file.object_key || file.filename,
                              file.originalname || file.filename
                            )
                          }
                        />
                      ))}
                    </div>
                  </div>
                ))}
                {searchTruncated && (
                  <div className="text-center py-2 text-[11px] text-muted-foreground">
                    {t("migration.truncated", { count: String(SEARCH_LIMIT) })}
                  </div>
                )}
              </>
            )
          ) : datasetsLoading ? (
            <div className="flex items-center justify-center py-8 text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin mr-2" />
              <span className="text-sm">{t("migration.loadingKbs")}</span>
            </div>
          ) : datasets.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground text-sm">
              {t("migration.noKbs")}
            </div>
          ) : (
            datasets.map((ds) => {
              const dsOpen = expandedDs.has(ds.id);
              const state = dsState[ds.id];
              const files = state?.files ?? [];
              // Initial load = loading before the first page lands
              const initialLoading = state?.loading && files.length === 0;
              const loadingMore = state?.loading && files.length > 0;
              return (
                <div key={ds.id}>
                  {/* Dataset Header */}
                  <button
                    type="button"
                    className="flex items-center gap-2 w-full px-2.5 py-2 rounded-md bg-muted/40 border text-sm font-semibold hover:bg-muted/60 transition-colors"
                    onClick={() => toggleDs(ds.id)}
                  >
                    <ChevronRight
                      className={cn(
                        "h-3.5 w-3.5 text-muted-foreground transition-transform",
                        dsOpen && "rotate-90"
                      )}
                    />
                    <Database className="h-4 w-4 flex-shrink-0" />
                    <span className="flex-1 text-left truncate">{ds.name}</span>
                    {ds.file_count != null && (
                      <span className="text-xs text-muted-foreground font-normal">
                        {ds.file_count} {t("migration.files")}
                      </span>
                    )}
                  </button>

                  {/* Files */}
                  {dsOpen && (
                    <div className="pl-7 mt-1 space-y-0.5">
                      {initialLoading ? (
                        <div className="flex items-center gap-2 px-2 py-2 text-xs text-muted-foreground">
                          <Loader2 className="h-3 w-3 animate-spin" />
                          {t("migration.loadingFiles")}
                        </div>
                      ) : files.length === 0 ? (
                        <div className="px-2 py-2 text-xs text-muted-foreground">
                          {t("migration.noFiles")}
                        </div>
                      ) : (
                        <>
                          {files.map((file) => (
                            <FileRow
                              key={file.id}
                              file={file}
                              checked={checkedFiles.has(file.id)}
                              onToggle={() =>
                                toggleFile(
                                  file.id,
                                  file.object_key || file.filename,
                                  file.originalname || file.filename
                                )
                              }
                            />
                          ))}
                          {state?.hasMore && !loadingMore && (
                            <LoadMoreSentinel
                              onVisible={() => loadMore(ds.id)}
                              rootRef={scrollContainerRef}
                            />
                          )}
                          {loadingMore && (
                            <div className="flex items-center gap-2 px-2 py-2 text-xs text-muted-foreground">
                              <Loader2 className="h-3 w-3 animate-spin" />
                              {t("migration.loadingFiles")}
                            </div>
                          )}
                        </>
                      )}
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>

        <DialogFooter className="mt-3">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t("migration.cancel")}
          </Button>
          <Button disabled={checkedFiles.size === 0} onClick={handleMerge}>
            {t("migration.mergeBtn", { count: String(checkedFiles.size) })}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
