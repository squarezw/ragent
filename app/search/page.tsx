"use client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Search, Eye, ChevronDown, ChevronUp, ChevronRight, ArrowLeft } from "lucide-react";
import { useState, useEffect } from "react";
import { Checkbox } from "@/components/ui/checkbox";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import axios from "@/lib/axios";
import { FilePreviewDialog } from "@/components/FilePreviewDialog";
import { useSearchParams, useRouter } from "next/navigation";
import { getFileDownloadUrl } from "@/lib/fileApi";
import { useTranslations } from "next-intl";
import { MarkdownRenderer } from "@/components/MarkdownRenderer";

export default function SearchPage() {
  const t = useTranslations("search");
  const searchParams = useSearchParams();
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<any[]>([]);
  const [error, setError] = useState("");
  const [enableDeepSearch, setEnableDeepSearch] = useState(false);
  const [topN, setTopN] = useState(5);
  const [previewFile, setPreviewFile] = useState<any>(null);
  const [datasets, setDatasets] = useState<any[]>([]);
  const [selectedDatasetId, setSelectedDatasetId] = useState<string>("");
  const [datasetsLoading, setDatasetsLoading] = useState(false);
  const [expandedItems, setExpandedItems] = useState<Set<string>>(new Set());

  // 获取知识库列表
  const fetchDatasets = async () => {
    setDatasetsLoading(true);
    try {
      const res = await axios.get("/api/datasets");
      const datasets = res.data || [];
      setDatasets(datasets);

      // 优先使用 URL 参数中的 dataset id
      const datasetIdFromUrl = searchParams?.get("dataset");
      if (datasetIdFromUrl) {
        // 检查该 dataset 是否在列表中
        const foundDataset = datasets.find((d: any) => d.id === datasetIdFromUrl);
        if (foundDataset) {
          setSelectedDatasetId(datasetIdFromUrl);
        } else if (datasets.length > 0) {
          // 如果 URL 中的 dataset 不存在，默认选择第一个
          setSelectedDatasetId(datasets[0].id);
        }
      } else if (datasets.length > 0 && !selectedDatasetId) {
        // 没有 URL 参数时，默认选择第一个知识库
        setSelectedDatasetId(datasets[0].id);
      }
    } catch (error) {
      console.error("Failed to fetch datasets:", error);
    } finally {
      setDatasetsLoading(false);
    }
  };

  const handleSearch = async () => {
    if (!query.trim()) return;
    setLoading(true);
    setError("");
    setResults([]);
    try {
      const searchParams: any = { query, topN, enableDeepSearch };
      if (selectedDatasetId) {
        searchParams.dataset_id = selectedDatasetId;
      }
      const res = await axios.post("/api/knowledge/search", searchParams);
      setResults(res.data.results || []);
    } catch (e: any) {
      setError(e?.message || t("searchError"));
    }
    setLoading(false);
  };

  useEffect(() => {
    if (
      previewFile &&
      typeof previewFile.mimetype === "string" &&
      (previewFile.mimetype.startsWith("text/") ||
        previewFile.mimetype === "text/markdown" ||
        previewFile.mimetype === "text/csv") &&
      previewFile._textContent === undefined // 只在没加载过时 fetch
    ) {
      // 使用工具库生成 URL（如果有 file_id）
      const url = getFileDownloadUrl(previewFile.id, previewFile.filename);
      axios
        .get(url)
        .then((res) => setPreviewFile((f: any) => ({ ...f, _textContent: res.data || res })))
        .catch(() => setPreviewFile((f: any) => ({ ...f, _textContent: t("loadFailed") })));
    }
  }, [previewFile]);

  // 切换展开/折叠状态
  const toggleExpanded = (itemId: string) => {
    setExpandedItems((prev) => {
      const newSet = new Set(prev);
      if (newSet.has(itemId)) {
        newSet.delete(itemId);
      } else {
        newSet.add(itemId);
      }
      return newSet;
    });
  };

  // 组件挂载时获取知识库列表，并在 URL 参数变化时重新获取
  useEffect(() => {
    fetchDatasets();
  }, [searchParams]);

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>{t("title")}</CardTitle>
              <CardDescription>{t("description")}</CardDescription>
            </div>
            <Button variant="outline" onClick={() => router.push("/datasets")}>
              <ArrowLeft className="mr-2 h-4 w-4" />
              {t("backToDatasets")}
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* 知识库选择 */}
          <div className="flex items-center gap-2">
            <label className="text-sm font-medium whitespace-nowrap">{t("selectDataset")}</label>
            <Select
              value={selectedDatasetId}
              onValueChange={setSelectedDatasetId}
              disabled={datasetsLoading}
            >
              <SelectTrigger className="w-64">
                <SelectValue
                  placeholder={datasetsLoading ? "Loading..." : t("selectDatasetPlaceholder")}
                />
              </SelectTrigger>
              <SelectContent>
                {datasets.map((dataset) => (
                  <SelectItem key={dataset.id} value={dataset.id}>
                    {dataset.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex gap-2 items-center">
            <Input
              placeholder={t("searchPlaceholder")}
              className="flex-1"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleSearch();
              }}
              disabled={loading}
            />
            <Button onClick={handleSearch} disabled={loading || !query.trim()}>
              <Search className="mr-2 h-4 w-4" />
              {loading ? t("searching") : t("search")}
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline">
                  {t("searchTopN", { n: topN })}
                  <ChevronDown className="ml-2 h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent>
                <DropdownMenuItem onClick={() => setTopN(3)}>
                  {t("searchTopN", { n: 3 })}
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => setTopN(5)}>
                  {t("searchTopN", { n: 5 })}
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => setTopN(10)}>
                  {t("searchTopN", { n: 10 })}
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => setTopN(20)}>
                  {t("searchTopN", { n: 20 })}
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => setTopN(50)}>
                  {t("searchTopN", { n: 50 })}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <div className="flex items-center gap-1 ml-2">
              <Checkbox
                id="deep-search"
                checked={enableDeepSearch}
                onCheckedChange={(checked) => setEnableDeepSearch(!!checked)}
              />
              <label htmlFor="deep-search" className="text-sm select-none">
                {t("deepSearch")}
              </label>
            </div>
          </div>

          {error && <div className="text-red-500 text-sm">{error}</div>}
          <div className="grid gap-4">
            {results.length === 0 && !loading && !error && (
              <div className="text-muted-foreground text-center">{t("enterQueryAndSearch")}</div>
            )}
            {results.map((item, idx) => {
              const isExpanded = expandedItems.has(item.id);
              const textLength = item.segment_text?.length || 0;
              const shouldShowToggle = textLength > 200; // 超过200字符才显示折叠按钮

              return (
                <div key={item.id} className="border rounded-lg p-4">
                  <div className="flex items-start justify-between">
                    <div className="space-y-2 flex-1">
                      <h3 className="font-semibold">
                        {item.originalname}（#{item.segment_index}）
                      </h3>
                      <div className="relative">
                        <div className="flex items-start gap-2">
                          <div
                            className={`text-sm text-muted-foreground flex-1 ${!isExpanded && shouldShowToggle ? "line-clamp-2" : ""}`}
                          >
                            <MarkdownRenderer content={item.segment_text} />
                          </div>
                          {shouldShowToggle && (
                            <button
                              className="text-xs text-muted-foreground hover:text-foreground transition-colors inline-flex items-center gap-1 flex-shrink-0 mt-0.5"
                              onClick={() => toggleExpanded(item.id)}
                            >
                              {isExpanded ? (
                                <>
                                  <ChevronUp className="h-3 w-3" />
                                  {t("collapse")}
                                </>
                              ) : (
                                <>
                                  <ChevronRight className="h-3 w-3" />
                                  {t("expand")}
                                </>
                              )}
                            </button>
                          )}
                        </div>
                      </div>
                      <div className="flex gap-2 flex-wrap">
                        <Badge variant="secondary">
                          {t("segmentId")}: {item.id}
                        </Badge>
                        <Badge className="bg-green-100 text-green-800">
                          {t("relevance")}:{" "}
                          {(Math.max(0, Math.min(1, item.similarity)) * 100).toFixed(1)}%
                        </Badge>
                        {enableDeepSearch && typeof item.rerank_score === "number" && (
                          <Badge
                            className={
                              item.rerank_score >= 4
                                ? "bg-green-500 text-white"
                                : item.rerank_score >= 2.5
                                  ? "bg-orange-400 text-white"
                                  : "bg-gray-500 text-white"
                            }
                          >
                            {t("deepRelevance")}:{" "}
                            {item.rerank_score < 1
                              ? `${(item.rerank_score * 100).toFixed(1)}%`
                              : item.rerank_score}
                          </Badge>
                        )}
                        <Button
                          size="icon"
                          variant="ghost"
                          onClick={() => {
                            // 搜索结果中的 item 是分段对象，需要转换为文件对象格式
                            setPreviewFile({
                              id: item.file_id || item.id, // 优先使用 file_id，如果没有则使用 id（可能是文件ID）
                              filename: item.filename,
                              originalname: item.originalname,
                              mimetype: item.mimetype,
                            });
                          }}
                          title={t("previewOriginal")}
                        >
                          <Eye className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>
      <FilePreviewDialog
        file={previewFile}
        open={!!previewFile}
        onOpenChange={(v) => !v && setPreviewFile(null)}
      />
    </div>
  );
}
