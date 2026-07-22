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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Loader2, RefreshCw, Plus, ChevronDown } from "lucide-react";
import { toast } from "sonner";
import { SummaryDetailDialog } from "./SummaryDetailDialog";
import type { Summary, SummaryListResponse } from "@/types/subscription-agent";

interface SummaryListDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  feedIds: string[];
  appName?: string;
  topic?: string;
  webhookUrl?: string;
}

const typeColorMap: Record<string, string> = {
  daily: "bg-blue-100 text-blue-800",
  weekly: "bg-purple-100 text-purple-800",
};

const statusColorMap: Record<string, string> = {
  pending: "bg-yellow-100 text-yellow-800",
  processing: "bg-blue-100 text-blue-800",
  completed: "bg-green-100 text-green-800",
  failed: "bg-red-100 text-red-800",
};

export function SummaryListDialog({
  open,
  onOpenChange,
  feedIds,
  appName,
  topic,
  webhookUrl,
}: SummaryListDialogProps) {
  const t = useTranslations("workflow");
  const [summaries, setSummaries] = useState<Summary[]>([]);
  const [loading, setLoading] = useState(false);
  const [generating, setGenerating] = useState(false);

  const typeLabelMap: Record<string, string> = {
    daily: t("dailyReport"),
    weekly: t("weeklyReport"),
  };

  const statusLabelMap: Record<string, string> = {
    pending: t("pending"),
    processing: t("generating"),
    completed: t("completed"),
    failed: t("failed"),
  };
  const [typeFilter, setTypeFilter] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const pageSize = 20;

  // 详情弹窗
  const [detailOpen, setDetailOpen] = useState(false);
  const [selectedSummaryId, setSelectedSummaryId] = useState<string | null>(null);

  const loadSummaries = useCallback(async () => {
    if (!feedIds || feedIds.length === 0) return;

    setLoading(true);
    try {
      const params: Record<string, string> = {
        page: String(page),
        pageSize: String(pageSize),
        feedIds: feedIds.join(","),
      };

      if (typeFilter !== "all") {
        params.type = typeFilter;
      }

      if (statusFilter !== "all") {
        params.status = statusFilter;
      }

      const response = await axios.get<SummaryListResponse>(
        "/api/v1/subscription-agent/summaries",
        { params }
      );

      setSummaries(response.data.data || []);
      setTotal(response.data.pagination?.total || 0);
    } catch (error: any) {
      toast.error(error.response?.data?.message || t("loadReportListFailed"));
    } finally {
      setLoading(false);
    }
  }, [feedIds, typeFilter, statusFilter, page, t]);

  const handleGenerateDaily = async () => {
    setGenerating(true);
    try {
      const response = await axios.post("/api/v1/subscription-agent/summaries/generate/today", {
        feedIds,
        topic: topic || undefined,
        webhook_url: webhookUrl || undefined,
      });
      toast.success(t("dailyReportStarted"));
      setSelectedSummaryId(response.data.summaryId);
      setDetailOpen(true);
      // 刷新列表
      loadSummaries();
    } catch (error: any) {
      toast.error(error.response?.data?.message || t("generateDailyFailed"));
    } finally {
      setGenerating(false);
    }
  };

  const handleGenerateWeekly = async () => {
    setGenerating(true);
    try {
      const response = await axios.post("/api/v1/subscription-agent/summaries/generate/week", {
        feedIds,
        topic: topic || undefined,
        webhook_url: webhookUrl || undefined,
      });
      toast.success(t("weeklyReportStarted"));
      setSelectedSummaryId(response.data.summaryId);
      setDetailOpen(true);
      // 刷新列表
      loadSummaries();
    } catch (error: any) {
      toast.error(error.response?.data?.message || t("generateWeeklyFailed"));
    } finally {
      setGenerating(false);
    }
  };

  const handleRowClick = (summary: Summary) => {
    setSelectedSummaryId(summary.id);
    setDetailOpen(true);
  };

  useEffect(() => {
    if (open && feedIds && feedIds.length > 0) {
      loadSummaries();
    }
  }, [open, feedIds, loadSummaries]);

  useEffect(() => {
    if (open) {
      setPage(1);
    }
  }, [typeFilter, statusFilter, open]);

  const totalPages = Math.ceil(total / pageSize);

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-4xl max-h-[80vh] overflow-hidden flex flex-col">
          <DialogHeader>
            <DialogTitle>
              {t("reportList")} {appName && `- ${appName}`}
            </DialogTitle>
          </DialogHeader>

          <div className="flex items-center justify-between gap-4 py-2">
            <div className="flex items-center gap-2">
              <Select value={typeFilter} onValueChange={setTypeFilter}>
                <SelectTrigger className="w-[120px]">
                  <SelectValue placeholder={t("type")} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{t("allTypes")}</SelectItem>
                  <SelectItem value="daily">{t("dailyReport")}</SelectItem>
                  <SelectItem value="weekly">{t("weeklyReport")}</SelectItem>
                </SelectContent>
              </Select>

              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger className="w-[120px]">
                  <SelectValue placeholder={t("status")} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{t("allStatuses")}</SelectItem>
                  <SelectItem value="pending">{t("pending")}</SelectItem>
                  <SelectItem value="processing">{t("generating")}</SelectItem>
                  <SelectItem value="completed">{t("completed")}</SelectItem>
                  <SelectItem value="failed">{t("failed")}</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="flex items-center gap-2">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button disabled={generating}>
                    {generating ? (
                      <Loader2 className="h-4 w-4 animate-spin mr-1" />
                    ) : (
                      <Plus className="h-4 w-4 mr-1" />
                    )}
                    {t("generateReport")}
                    <ChevronDown className="h-4 w-4 ml-1" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent>
                  <DropdownMenuItem onClick={handleGenerateDaily}>
                    {t("generateDaily")}
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={handleGenerateWeekly}>
                    {t("generateWeekly")}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>

              <Button variant="outline" size="icon" onClick={loadSummaries} disabled={loading}>
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
                  <TableHead className="w-[70px]">{t("type")}</TableHead>
                  <TableHead className="w-[70px]">{t("status")}</TableHead>
                  <TableHead className="w-[180px]">{t("timeRange")}</TableHead>
                  <TableHead className="w-[70px]">{t("contentCount")}</TableHead>
                  <TableHead className="w-[80px]">{t("triggerMethod")}</TableHead>
                  <TableHead className="w-[120px]">{t("generatedAt")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center py-8">
                      <Loader2 className="h-6 w-6 animate-spin mx-auto" />
                    </TableCell>
                  </TableRow>
                ) : summaries.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center py-8 text-muted-foreground">
                      {t("noReports")}
                    </TableCell>
                  </TableRow>
                ) : (
                  summaries.map((summary) => (
                    <TableRow
                      key={summary.id}
                      className="cursor-pointer hover:bg-muted/50"
                      onClick={() => handleRowClick(summary)}
                    >
                      <TableCell>
                        <Badge className={typeColorMap[summary.type]} variant="secondary">
                          {typeLabelMap[summary.type]}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <Badge className={statusColorMap[summary.status]} variant="secondary">
                          {statusLabelMap[summary.status]}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        {new Date(summary.period_start).toLocaleDateString("zh-CN")} -{" "}
                        {new Date(summary.period_end).toLocaleDateString("zh-CN")}
                      </TableCell>
                      <TableCell>{summary.item_count}</TableCell>
                      <TableCell>
                        {summary.triggered_by === "manual" ? t("manual") : t("scheduled")}
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {new Date(summary.created_at).toLocaleString("zh-CN", {
                          month: "2-digit",
                          day: "2-digit",
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
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

      <SummaryDetailDialog
        open={detailOpen}
        onOpenChange={setDetailOpen}
        summaryId={selectedSummaryId}
      />
    </>
  );
}
