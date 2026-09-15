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
  PlugZap,
  CircleCheck,
  CircleAlert,
  CircleHelp,
} from "lucide-react";
import { useRouter } from "next/navigation";
import {
  useTool,
  testToolConnection,
  Tool,
  ToolConnectionTestResult,
  formatTokens,
} from "@/hooks/useTools";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { checkSuperAdmin, checkTenantAdmin } from "@/lib/clientPermissions";
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
  // 体检：结果就地展示（详情页有位置说清原因，不需要弹 toast），
  // 完成后刷新工具详情，让"连接状态"这一块跟着更新
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<ToolConnectionTestResult | null>(null);

  const { user } = useCurrentUser();
  const isSuperAdmin = checkSuperAdmin(user);
  // 体检端点要的是"超管或租户管理员"（与工具列表页同一判据）——
  // 只按超管显示按钮的话，租户管理员在这儿会看不到这个功能
  const canManageTools = isSuperAdmin || checkTenantAdmin(user);
  const { tool, loading: toolLoading, refresh: refreshTool } = useTool(toolId, true, isSuperAdmin);
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

  const handleTestConnection = async () => {
    if (!tool) return;
    setTesting(true);
    try {
      const result = await testToolConnection(tool.id);
      setTestResult(result);
      if (result) refreshTool();
    } finally {
      setTesting(false);
    }
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
            <div className="text-sm text-muted-foreground mb-1">{t("creator")}</div>
            {/* 三种状态必须分得开，否则「查不到是谁建的」会被读成「没人建过」：
                · created_by 为空   → 这一行建于该列存在之前（存量数据）
                · 有 id 无名字      → 创建人账号已注销
                · 都有              → 正常显示 */}
            <div>
              {tool.created_by_name ||
                (tool.created_by ? t("creatorDeleted") : t("creatorUnknown"))}
            </div>
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

          {/* 连接状态。只有 MCP 工具有"连得上吗"这回事 —— native / workflow 不建立连接。
              这一块存在的理由：注册是按需的（启动时不连），从没被用过的工具在
              列表页什么都看不出来，而"这条连接还能不能用"原先只能去聊天里发句话试。 */}
          {tool.tool_type === "mcp" && (
            <div className="col-span-2">
              <div className="text-sm text-muted-foreground mb-1">{t("connectionStatus")}</div>
              <div className="flex items-center gap-3 flex-wrap">
                <ConnectionStateBadge footprint={tool.footprint} />
                {tool.footprint?.status === "ok" && (
                  <span className="text-xs text-muted-foreground">
                    {t("footprintSummary", {
                      count: tool.footprint.subtool_count,
                      tokens: formatTokens(tool.footprint.estimated_tokens),
                    })}
                    {tool.footprint.checked_at
                      ? ` · ${t("connOkCheckedHint", {
                          time: new Date(tool.footprint.checked_at * 1000).toLocaleString(),
                        })}`
                      : ` · ${t("connOkHint")}`}
                  </span>
                )}
                {canManageTools && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleTestConnection}
                    disabled={testing}
                    title={t("testConnectionHint")}
                  >
                    {testing ? (
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    ) : (
                      <PlugZap className="h-4 w-4 mr-2" />
                    )}
                    {testing ? t("testConnectionRunning") : t("testConnection")}
                  </Button>
                )}
              </div>

              {/* 失败/未配置的原因：正文位置说清楚，别塞进 tooltip —— 这是用户来这一页
                  要找的东西。四档分开说，unconfigured 要改配置、failed 要查对端。 */}
              {tool.footprint &&
                (tool.footprint.status === "failed" ||
                  tool.footprint.status === "unconfigured") && (
                  <div
                    className={`mt-2 min-w-0 max-w-full break-words text-xs [overflow-wrap:anywhere] ${
                      tool.footprint.status === "failed"
                        ? "text-destructive"
                        : "text-amber-600 dark:text-amber-500"
                    }`}
                  >
                    {tool.footprint.status === "failed"
                      ? t("connFailedHint")
                      : t("connUnconfiguredHint")}
                    {tool.footprint.error ? ` ${tool.footprint.error}` : ""}
                  </div>
                )}

              {/* 刚做完的那次体检结果。与上面那块（注册表里已有的结论）分开显示：
                  一次体检可能改了状态，而工具详情是刷新后才回来的，两者短暂并存。 */}
              {testResult && (
                <div className="mt-2 min-w-0 max-w-full break-words text-xs text-muted-foreground [overflow-wrap:anywhere]">
                  {testResult.status === "ok" &&
                    t("testOk", {
                      name: tool.display_name,
                      count: testResult.subtool_count,
                      tokens: formatTokens(testResult.estimated_tokens),
                      ms: testResult.duration_ms,
                    })}
                  {testResult.status === "failed" &&
                    t("testFailed", {
                      name: tool.display_name,
                      reason: testResult.error || "-",
                    })}
                  {testResult.status === "unconfigured" &&
                    t("testUnconfigured", {
                      name: tool.display_name,
                      reason: testResult.error || "-",
                    })}
                  {testResult.status === "not_applicable" &&
                    t("testNotApplicable", { name: tool.display_name })}
                </div>
              )}
            </div>
          )}

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

/**
 * 详情页的连接状态徽标。
 *
 * 与列表页共用同一套文案键与同一套四档判据 —— 两处口径必须一致，否则同一个工具
 * 会出现"列表显示未配置、点进来显示未验证"这种只能靠逐个核对才发现的分歧。
 *
 * 四档为什么要分开：`unconfigured`（配置没填完，后端连试都没试）要去**改配置**，
 * `failed`（配置完整但连不上）要去**查对端或网络**，未验证（从没被用过）什么都不用做。
 */
function ConnectionStateBadge({ footprint }: { footprint?: Tool["footprint"] }) {
  const t = useTranslations("tools");

  if (!footprint) {
    return (
      <Badge variant="outline" className="gap-1">
        <CircleHelp className="h-3 w-3" />
        {t("connUntested")}
      </Badge>
    );
  }
  if (footprint.status === "unconfigured") {
    return (
      <Badge className="bg-amber-100 text-amber-800 hover:bg-amber-100 gap-1">
        <CircleAlert className="h-3 w-3" />
        {t("connUnconfigured")}
      </Badge>
    );
  }
  if (footprint.status === "failed") {
    return (
      <Badge className="bg-red-100 text-red-800 hover:bg-red-100 gap-1">
        <CircleAlert className="h-3 w-3" />
        {t("connFailed")}
      </Badge>
    );
  }
  return (
    <Badge className="bg-green-100 text-green-800 hover:bg-green-100 gap-1">
      <CircleCheck className="h-3 w-3" />
      {t("connOk")}
    </Badge>
  );
}
