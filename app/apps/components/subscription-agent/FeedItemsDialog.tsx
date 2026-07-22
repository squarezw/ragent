"use client";

import { useState, useEffect, useCallback } from "react";
import { useTranslations } from "next-intl";
import axios from "@/lib/axios";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Loader2, RefreshCw, ExternalLink, Download } from "lucide-react";
import { toast } from "sonner";
import type { Feed, FeedItem } from "@/types/subscription-agent";

interface FeedItemsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  feedIds: string[];
  appName?: string;
}

export function FeedItemsDialog({ open, onOpenChange, feedIds, appName }: FeedItemsDialogProps) {
  const t = useTranslations("workflow");
  const [feeds, setFeeds] = useState<Feed[]>([]);
  const [items, setItems] = useState<FeedItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [fetching, setFetching] = useState(false);
  const [selectedFeedId, setSelectedFeedId] = useState<string>("all");
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const pageSize = 20;

  const loadFeeds = useCallback(async () => {
    if (feedIds.length === 0) return;

    try {
      const feedPromises = feedIds.map((id) =>
        axios.get<Feed>(`/api/v1/subscription-agent/feeds/${id}`)
      );
      const responses = await Promise.all(feedPromises);
      setFeeds(responses.map((r) => r.data));
    } catch (error: any) {
      console.error("Failed to load feeds:", error);
    }
  }, [feedIds]);

  const loadItems = useCallback(async () => {
    if (feedIds.length === 0) return;

    setLoading(true);
    try {
      const targetFeedIds = selectedFeedId === "all" ? feedIds : [selectedFeedId];
      const allItems: FeedItem[] = [];
      let totalCount = 0;

      for (const feedId of targetFeedIds) {
        const response = await axios.get(`/api/v1/subscription-agent/feeds/${feedId}/items`, {
          params: { page, pageSize },
        });
        allItems.push(...response.data.items);
        totalCount += response.data.pagination?.total || 0;
      }

      // 按发布时间排序
      allItems.sort(
        (a, b) => new Date(b.published_at).getTime() - new Date(a.published_at).getTime()
      );

      setItems(allItems);
      setTotal(totalCount);
    } catch (error: any) {
      toast.error(error.response?.data?.message || t("loadContentFailed"));
    } finally {
      setLoading(false);
    }
  }, [feedIds, selectedFeedId, page, pageSize, t]);

  const handleFetch = async () => {
    setFetching(true);
    try {
      await axios.post("/api/v1/subscription-agent/fetch", { feedIds });
      toast.success(t("fetchTaskStarted"));
      // 延迟刷新列表
      setTimeout(() => {
        loadItems();
      }, 2000);
    } catch (error: any) {
      toast.error(error.response?.data?.message || t("triggerFetchFailed"));
    } finally {
      setFetching(false);
    }
  };

  useEffect(() => {
    if (open && feedIds.length > 0) {
      loadFeeds();
      loadItems();
    }
  }, [open, feedIds, loadFeeds, loadItems]);

  useEffect(() => {
    if (open) {
      setPage(1);
    }
  }, [selectedFeedId, open]);

  const totalPages = Math.ceil(total / pageSize);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[80vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle>
            {t("subscriptionContent")} {appName && `- ${appName}`}
          </DialogTitle>
        </DialogHeader>

        <div className="flex items-center justify-between gap-4 py-2">
          <div className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground">{t("feedSource")}:</span>
            <Select value={selectedFeedId} onValueChange={setSelectedFeedId}>
              <SelectTrigger className="w-[200px]">
                <SelectValue placeholder={t("selectFeedSource")} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t("allFeeds")}</SelectItem>
                {feeds.map((feed) => (
                  <SelectItem key={feed.id} value={feed.id}>
                    <div className="flex items-center gap-2">
                      <Badge variant="outline" className="text-xs">
                        {feed.platform}
                      </Badge>
                      <span className="truncate max-w-[150px]">{feed.source_url}</span>
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={handleFetch} disabled={fetching}>
              {fetching ? (
                <Loader2 className="h-4 w-4 animate-spin mr-1" />
              ) : (
                <Download className="h-4 w-4 mr-1" />
              )}
              {t("fetchContent")}
            </Button>
            <Button variant="outline" size="sm" onClick={loadItems} disabled={loading}>
              {loading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <RefreshCw className="h-4 w-4" />
              )}
            </Button>
          </div>
        </div>

        <div className="flex-1 overflow-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("title")}</TableHead>
                <TableHead className="w-[120px]">{t("publishedAt")}</TableHead>
                <TableHead className="w-[60px]">{t("link")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow>
                  <TableCell colSpan={3} className="text-center py-8">
                    <Loader2 className="h-6 w-6 animate-spin mx-auto" />
                  </TableCell>
                </TableRow>
              ) : items.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={3} className="text-center py-8 text-muted-foreground">
                    {t("noContent")}
                  </TableCell>
                </TableRow>
              ) : (
                items.map((item) => (
                  <TableRow key={item.id}>
                    <TableCell>
                      <div className="font-medium line-clamp-2">{item.title}</div>
                      {item.summary && (
                        <div className="text-xs text-muted-foreground mt-1 line-clamp-2">
                          {item.summary}
                        </div>
                      )}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {new Date(item.published_at).toLocaleString("zh-CN", {
                        month: "2-digit",
                        day: "2-digit",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </TableCell>
                    <TableCell>
                      <a
                        href={item.link}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-primary hover:underline"
                      >
                        <ExternalLink className="h-4 w-4" />
                      </a>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>

        {totalPages > 1 && (
          <div className="flex items-center justify-between pt-4 border-t">
            <div className="text-sm text-muted-foreground">
              {t("paginationInfo", { total, page, totalPages })}
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page === 1}
              >
                {t("previousPage")}
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={page === totalPages}
              >
                {t("nextPage")}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
