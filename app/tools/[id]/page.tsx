"use client";

import { use, useState } from "react";
import { useTranslations } from "next-intl";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  ArrowLeft,
  Loader2,
  TrendingUp,
  TrendingDown,
  Clock,
  CheckCircle,
  XCircle,
  Activity,
  Maximize2,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useTool } from "@/hooks/useTools";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { checkSuperAdmin } from "@/lib/clientPermissions";
import { useToolExecutions, useToolStatistics } from "@/hooks/useToolExecutions";

export default function ToolDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const t = useTranslations("tools");
  const router = useRouter();
  const { id } = use(params);
  const toolId = Number(id);

  const [statusFilter, setStatusFilter] = useState<"success" | "failed" | undefined>();
  const [page, setPage] = useState(1);
  const [detailDialogOpen, setDetailDialogOpen] = useState(false);
  const [detailType, setDetailType] = useState<"input" | "output">("input");
  const [detailContent, setDetailContent] = useState<any>(null);
  const [detailTitle, setDetailTitle] = useState("");

  const { user } = useCurrentUser();
  const isSuperAdmin = checkSuperAdmin(user);
  const { tool, loading: toolLoading } = useTool(toolId, true, isSuperAdmin);
  const {
    executions,
    total,
    loading: executionsLoading,
  } = useToolExecutions({
    tool_id: toolId,
    status: statusFilter,
    page,
    page_size: 20,
  });

  const getStatusColor = (status: string) => {
    return status === "success" ? "bg-green-100 text-green-800" : "bg-red-100 text-red-800";
  };

  const formatDuration = (ms: number) => {
    if (ms < 1000) return `${ms}ms`;
    return `${(ms / 1000).toFixed(2)}s`;
  };

  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr);
    return date.toLocaleString("zh-CN", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  };

  const handleViewDetail = (type: "input" | "output", content: any, title: string) => {
    setDetailType(type);
    setDetailContent(content);
    setDetailTitle(title);
    setDetailDialogOpen(true);
  };

  const formatContent = (content: any): string => {
    if (content === null || content === undefined) {
      return "-";
    }
    if (typeof content === "string") {
      try {
        const parsed = JSON.parse(content);
        return JSON.stringify(parsed, null, 2);
      } catch {
        return content;
      }
    }
    try {
      return JSON.stringify(content, null, 2);
    } catch {
      return String(content);
    }
  };

  const truncateText = (text: string | null | undefined, maxLength: number = 100): string => {
    if (!text) return "-";
    const str = typeof text === "string" ? text : JSON.stringify(text);
    if (str.length <= maxLength) return str;
    return str.substring(0, maxLength) + "...";
  };

  if (toolLoading) {
    return (
      <div className="container mx-auto p-6">
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      </div>
    );
  }

  if (!tool) {
    return (
      <div className="container mx-auto p-6">
        <div className="text-center py-12">
          <p className="text-muted-foreground">{t("toolNotFound")}</p>
          <Button onClick={() => router.push("/tools")} className="mt-4">
            {t("backToList")}
          </Button>
        </div>
      </div>
    );
  }

  const stats = tool.statistics;

  return (
    <div className="container mx-auto p-6 space-y-6">
      {/* 顶部导航 */}
      <div className="flex items-center gap-4">
        <Button variant="ghost" onClick={() => router.push("/tools")}>
          <ArrowLeft className="h-4 w-4 mr-2" />
          {t("back")}
        </Button>
        <div>
          <h1 className="text-3xl font-bold">{tool.display_name}</h1>
          <p className="text-muted-foreground">{tool.name}</p>
        </div>
      </div>

      {/* 基本信息卡片 */}
      <Card>
        <CardHeader>
          <CardTitle>{t("basicInfo")}</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-2 gap-4">
          <div>
            <div className="text-sm text-muted-foreground mb-1">{t("toolType")}</div>
            <Badge
              className={
                tool.tool_type === "native"
                  ? "bg-blue-100 text-blue-800"
                  : "bg-purple-100 text-purple-800"
              }
            >
              {tool.tool_type === "native" ? t("nativeTool") : t("mcpTool")}
            </Badge>
          </div>

          <div>
            <div className="text-sm text-muted-foreground mb-1">{t("category")}</div>
            <Badge>{tool.category}</Badge>
          </div>

          <div>
            <div className="text-sm text-muted-foreground mb-1">{t("version")}</div>
            <div>{tool.version || "-"}</div>
          </div>

          <div>
            <div className="text-sm text-muted-foreground mb-1">{t("author")}</div>
            <div>{tool.author || "-"}</div>
          </div>

          <div>
            <div className="text-sm text-muted-foreground mb-1">{t("status")}</div>
            <Badge variant={tool.is_enabled ? "default" : "secondary"}>
              {tool.is_enabled ? t("enabled") : t("disabled")}
            </Badge>
          </div>

          <div>
            <div className="text-sm text-muted-foreground mb-1">{t("systemTool")}</div>
            <div>{tool.is_system ? t("yes") : t("no")}</div>
          </div>

          <div className="col-span-2">
            <div className="text-sm text-muted-foreground mb-1">{t("description")}</div>
            <div>{tool.description}</div>
          </div>

          {isSuperAdmin &&
            (tool.app_tools && tool.app_tools.length > 0 ? (
              <div className="col-span-2">
                <div className="text-sm text-muted-foreground mb-2">{t("appConfig")}</div>
                <div className="space-y-3">
                  {tool.app_tools.map((appTool) => {
                    // 合并默认配置和自定义配置（custom_config 覆盖 default_config）
                    const finalConfig = { ...tool.default_config, ...appTool.custom_config };
                    const hasCustomConfig = Object.keys(appTool.custom_config).length > 0;

                    return (
                      <div key={appTool.app_id} className="border rounded-lg p-3">
                        <div className="flex items-center gap-2 mb-2">
                          <div className="font-semibold">{appTool.app_name}</div>
                          {appTool.is_enabled !== undefined && (
                            <Badge
                              variant={appTool.is_enabled ? "default" : "secondary"}
                              className="text-xs"
                            >
                              {appTool.is_enabled ? t("enabled") : t("disabled")}
                            </Badge>
                          )}
                          <div className="text-xs text-muted-foreground">
                            {t("priority")}: {appTool.priority}
                          </div>
                          {!hasCustomConfig && (
                            <Badge variant="outline" className="text-xs">
                              {t("usingDefaultConfig")}
                            </Badge>
                          )}
                        </div>
                        <pre className="bg-muted p-2 rounded text-xs overflow-x-auto">
                          {JSON.stringify(finalConfig, null, 2)}
                        </pre>
                        {hasCustomConfig && (
                          <div className="mt-2 text-xs text-muted-foreground">
                            {t("customConfigItems")}:{" "}
                            {Object.keys(appTool.custom_config).join(", ")}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            ) : (
              <div className="col-span-2">
                <div className="text-sm text-muted-foreground mb-1">{t("defaultConfig")}</div>
                <pre className="bg-muted p-3 rounded text-xs overflow-x-auto">
                  {JSON.stringify(tool.default_config, null, 2)}
                </pre>
                <div className="mt-2 text-xs text-muted-foreground">{t("notUsedByAnyApp")}</div>
              </div>
            ))}
        </CardContent>
      </Card>

      {/* 统计数据卡片 */}
      {stats && (
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                {t("totalCalls")}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex items-center gap-2">
                <Activity className="h-5 w-5 text-blue-500" />
                <div className="text-2xl font-bold">{stats.total_calls}</div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                {t("successCalls")}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex items-center gap-2">
                <CheckCircle className="h-5 w-5 text-green-500" />
                <div className="text-2xl font-bold">{stats.success_calls}</div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                {t("successRate")}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex items-center gap-2">
                {stats.success_rate >= 0.9 ? (
                  <TrendingUp className="h-5 w-5 text-green-500" />
                ) : (
                  <TrendingDown className="h-5 w-5 text-red-500" />
                )}
                <div className="text-2xl font-bold">{(stats.success_rate * 100).toFixed(1)}%</div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                {t("avgExecutionTime")}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex items-center gap-2">
                <Clock className="h-5 w-5 text-orange-500" />
                <div className="text-2xl font-bold">
                  {formatDuration(stats.avg_execution_time_ms)}
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* 执行记录表格 */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle>{t("executionRecords", { count: total })}</CardTitle>
            <Select
              value={statusFilter || "all"}
              onValueChange={(value) => {
                setStatusFilter(value === "all" ? undefined : (value as "success" | "failed"));
                setPage(1);
              }}
            >
              <SelectTrigger className="w-32">
                <SelectValue placeholder={t("statusFilter")} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t("all")}</SelectItem>
                <SelectItem value="success">{t("success")}</SelectItem>
                <SelectItem value="failed">{t("failed")}</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardHeader>
        <CardContent>
          {executionsLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : executions.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">{t("noRecords")}</div>
          ) : (
            <>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("time")}</TableHead>
                    <TableHead>{t("app")}</TableHead>
                    <TableHead>{t("status")}</TableHead>
                    <TableHead>{t("executionTime")}</TableHead>
                    <TableHead>{t("inputParams")}</TableHead>
                    <TableHead>{t("outputError")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {executions.map((execution) => (
                    <TableRow key={execution.id}>
                      <TableCell className="text-sm">{formatDate(execution.created_at)}</TableCell>
                      <TableCell>{execution.app_name || "-"}</TableCell>
                      <TableCell>
                        <Badge className={getStatusColor(execution.status)}>
                          {execution.status === "success" ? t("success") : t("failed")}
                        </Badge>
                      </TableCell>
                      <TableCell>{formatDuration(execution.execution_time_ms)}</TableCell>
                      <TableCell className="max-w-xs">
                        <div
                          className="truncate text-xs font-mono cursor-pointer hover:text-primary flex items-center gap-1 group"
                          onClick={() =>
                            handleViewDetail("input", execution.input_args, t("inputParams"))
                          }
                          title={t("clickToView")}
                        >
                          <span className="flex-1 truncate">
                            {truncateText(JSON.stringify(execution.input_args))}
                          </span>
                          <Maximize2 className="h-3 w-3 opacity-0 group-hover:opacity-100 transition-opacity" />
                        </div>
                      </TableCell>
                      <TableCell className="max-w-xs">
                        {execution.status === "success" ? (
                          <div
                            className="truncate text-xs cursor-pointer hover:text-primary flex items-center gap-1 group"
                            onClick={() =>
                              handleViewDetail(
                                "output",
                                execution.output_summary,
                                t("outputResult")
                              )
                            }
                            title={t("clickToView")}
                          >
                            <span className="flex-1 truncate">
                              {truncateText(execution.output_summary || "-")}
                            </span>
                            <Maximize2 className="h-3 w-3 opacity-0 group-hover:opacity-100 transition-opacity" />
                          </div>
                        ) : (
                          <div className="text-xs text-red-600">
                            <div className="font-semibold">{execution.error_type}</div>
                            <div
                              className="truncate cursor-pointer hover:text-red-700 flex items-center gap-1 group"
                              onClick={() =>
                                handleViewDetail(
                                  "output",
                                  {
                                    error_type: execution.error_type,
                                    error_detail: execution.error_detail,
                                    error_stack_trace: execution.error_stack_trace,
                                  },
                                  t("errorInfo")
                                )
                              }
                              title={t("clickToView")}
                            >
                              <span className="flex-1 truncate">
                                {truncateText(execution.error_detail || "-")}
                              </span>
                              <Maximize2 className="h-3 w-3 opacity-0 group-hover:opacity-100 transition-opacity" />
                            </div>
                          </div>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>

              {total > 20 && (
                <div className="flex items-center justify-between mt-4">
                  <div className="text-sm text-muted-foreground">
                    {t("pagination", { current: page, total: Math.ceil(total / 20) })}
                  </div>
                  <div className="flex gap-2">
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
                      onClick={() => setPage((p) => p + 1)}
                      disabled={page >= Math.ceil(total / 20)}
                    >
                      {t("nextPage")}
                    </Button>
                  </div>
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>

      {/* 详情查看对话框 */}
      <Dialog open={detailDialogOpen} onOpenChange={setDetailDialogOpen}>
        <DialogContent className="max-w-4xl max-h-[80vh] overflow-hidden flex flex-col">
          <DialogHeader>
            <DialogTitle>{detailTitle}</DialogTitle>
          </DialogHeader>
          <div className="flex-1 overflow-auto mt-4">
            <pre className="bg-muted p-4 rounded-lg text-xs font-mono whitespace-pre-wrap break-words">
              {detailContent ? formatContent(detailContent) : "-"}
            </pre>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
