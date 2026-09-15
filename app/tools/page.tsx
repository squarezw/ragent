"use client";

import { type ReactNode, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { checkSuperAdmin, checkTenantAdmin } from "@/lib/clientPermissions";
import { useBuiltinTools } from "@/hooks/useBuiltinTools";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { BuiltinToolsTable } from "./components/BuiltinToolsTable";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
import { Switch } from "@/components/ui/switch";
import {
  Plus,
  Edit,
  Trash2,
  Eye,
  Loader2,
  Wrench,
  Code,
  Globe,
  PlugZap,
  CircleCheck,
  CircleAlert,
  CircleHelp,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { useTools, Tool, ToolConnectionTestResult, formatTokens } from "@/hooks/useTools";
import { ToolFormDialog } from "./components/ToolFormDialog";

// 获取工具类型图标（兜底图标）
const getToolTypeIcon = (type: string) => {
  switch (type) {
    case "native":
      return <Code className="h-4 w-4" />;
    case "mcp":
      return <Globe className="h-4 w-4" />;
    default:
      return <Wrench className="h-4 w-4" />;
  }
};

// 工具图标组件 - 处理图片加载失败的情况
const ToolIcon = ({ tool }: { tool: Tool }) => {
  const [imageError, setImageError] = useState(false);

  // 如果配置了图标且未发生错误，显示图标
  if (tool.icon && tool.icon.trim() && !imageError) {
    return (
      <img
        src={tool.icon}
        alt={tool.display_name}
        className="h-4 w-4 object-contain flex-shrink-0"
        onError={() => setImageError(true)}
      />
    );
  }
  // 如果没有配置图标或图片加载失败，显示兜底图标
  return getToolTypeIcon(tool.tool_type);
};

export default function ToolsPage() {
  const t = useTranslations("tools");
  const router = useRouter();
  const [page, setPage] = useState(1);
  // 页签而不是"全部类型"下拉。**默认 "managed"，即除原生工具之外的全部。**
  //
  // 这个页签**没有**叫"MCP 工具"：它同时装着 `tool_type='mcp'` 和 `'workflow'` 两种行
  // （后者是长任务 kind 的启停开关，如 cad.check_line_width）。标成 MCP 就得按 mcp 过滤，
  // 那些长任务开关会跟着消失——它们是这页现在唯一的管理入口。
  //
  // 内置工具（原生 + 网关）随代码发布、不在 `tools` 表里，授权判据也写死在代码里
  // （`sql_query` 仅超级管理员……），界面上改不了。把它们混进同一张可编辑的表里会给出
  // "这里能改"的错觉——所以单开一个只读页签，且只有超级管理员看得到：判据本身就是安全
  // 信息（谁能跑 sql_query、execute_skill 的门是什么），给改不了它的人看没有用处。
  const [tab, setTab] = useState<"managed" | "builtin">("managed");
  const [isEnabled, setIsEnabled] = useState<boolean | undefined>();
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [selectedTool, setSelectedTool] = useState<Tool | null>(null);
  const [formDialogOpen, setFormDialogOpen] = useState(false);
  const [editingTool, setEditingTool] = useState<Tool | null>(null);
  // 正在体检的工具 id。用 Set 而不是单个 id：批量体检时会有多行同时在转。
  const [testingIds, setTestingIds] = useState<Set<number>>(new Set());
  // 批量体检进度。running 只用来禁按钮；done/total 是给用户"还剩多少"的读数 ——
  // 一页 20 个 MCP 工具、每个最慢 20s，没有进度时界面看起来和卡死没区别。
  const [bulkTest, setBulkTest] = useState({ running: false, done: 0, total: 0 });

  const { user } = useCurrentUser();
  const isSuperAdmin = checkSuperAdmin(user);
  // 写操作的判据必须与后端 _require_tool_manager 逐字一致：超管或租户管理员。
  // 这个页面此前对写操作**不设任何门**——只是侧边栏不给入口，直接敲 /tools
  // 就能改能删。按钮留给点不动的人，等于把 403 当交互。
  const canManageTools = isSuperAdmin || checkTenantAdmin(user);

  const {
    tools,
    total,
    loading,
    createTool,
    updateTool,
    deleteTool,
    toggleToolEnabled,
    testConnection,
    refresh,
  } = useTools({
    is_enabled: isEnabled,
    page,
    page_size: 20,
  });
  const {
    builtins,
    meta: builtinMeta,
    loading: builtinLoading,
    error: builtinError,
  } = useBuiltinTools(tab === "builtin");

  // 权限被撤走时（角色变更 / 退出后换人登录）不能停留在只读页签上：SWR 缓存熬得过登出，
  // 停在那里会让上一个人看到的清单留在屏幕上。
  useEffect(() => {
    if (tab === "builtin" && !isSuperAdmin) setTab("managed");
  }, [tab, isSuperAdmin]);

  const handleDelete = async () => {
    if (!selectedTool) return;

    const success = await deleteTool(selectedTool.id);
    if (success) {
      setDeleteDialogOpen(false);
      setSelectedTool(null);
    }
  };

  const handleToggleEnabled = async (tool: Tool) => {
    await toggleToolEnabled(tool.id, !tool.is_enabled);
  };

  const handleEdit = (tool: Tool) => {
    setEditingTool(tool);
    setFormDialogOpen(true);
  };

  const handleCreate = () => {
    setEditingTool(null);
    setFormDialogOpen(true);
  };

  const handleFormClose = (success?: boolean) => {
    setFormDialogOpen(false);
    setEditingTool(null);
    if (success) {
      refresh();
    }
  };

  const markTesting = (id: number, on: boolean) =>
    setTestingIds((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });

  /**
   * 体检结果的播报。
   *
   * 光刷新列表是不够的：用户点了按钮之后如果只看到"什么都没发生"（未验证的工具
   * 体检失败后名字下方那行小字也不显眼），他会再点一次。所以结论必须弹出来，
   * 而且**四档分开说** —— unconfigured 是"去改配置"，failed 是"查对端或网络"，
   * 两者都报成"连接失败"会让人去排查一个不存在的问题。
   */
  const reportTestResult = (tool: Tool, result: ToolConnectionTestResult | null) => {
    if (!result) {
      toast.error(t("testRequestFailed"));
      return;
    }
    switch (result.status) {
      case "ok":
        toast.success(
          t("testOk", {
            name: tool.display_name,
            count: result.subtool_count,
            tokens: formatTokens(result.estimated_tokens),
            ms: result.duration_ms,
          })
        );
        break;
      case "failed":
        toast.error(t("testFailed", { name: tool.display_name, reason: result.error || "-" }));
        break;
      case "unconfigured":
        toast.warning(
          t("testUnconfigured", { name: tool.display_name, reason: result.error || "-" })
        );
        break;
      default:
        toast.info(t("testNotApplicable", { name: tool.display_name }));
    }
  };

  const handleTest = async (tool: Tool) => {
    markTesting(tool.id, true);
    try {
      reportTestResult(tool, await testConnection(tool.id));
    } finally {
      markTesting(tool.id, false);
    }
  };

  /**
   * 批量体检本页的 MCP 工具。
   *
   * 并发上限 4：一次全发出去的话，每行都在 20s 超时窗口里，对端被同时敲 20 次，
   * 而本机那个 aiohttp/httpx 连接池也会被打满 —— 结果是一片假超时。
   */
  const handleTestAll = async () => {
    const targets = tools.filter((x) => x.tool_type === "mcp");
    if (targets.length === 0) {
      toast.info(t("testAllNone"));
      return;
    }

    setBulkTest({ running: true, done: 0, total: targets.length });
    const results: { tool: Tool; result: ToolConnectionTestResult | null }[] = [];
    const queue = [...targets];

    const worker = async () => {
      for (let tool = queue.shift(); tool; tool = queue.shift()) {
        markTesting(tool.id, true);
        try {
          const result = await testConnection(tool.id);
          results.push({ tool, result });
        } catch {
          results.push({ tool, result: null });
        } finally {
          markTesting(tool.id, false);
          setBulkTest((prev) => ({ ...prev, done: prev.done + 1 }));
        }
      }
    };

    try {
      await Promise.all(Array.from({ length: Math.min(4, targets.length) }, () => worker()));
    } finally {
      setBulkTest({ running: false, done: 0, total: 0 });
    }

    const ok = results.filter((r) => r.result?.status === "ok");
    const bad = results.filter((r) => r.result && r.result.status !== "ok");
    const unknown = results.filter((r) => !r.result);
    // 逐条弹 20 个 toast 会把屏幕刷满，所以汇总成一条并点名前几个 ——
    // 要找细节可将焦点放到名字下方的连接状态上查看。
    if (bad.length === 0 && unknown.length === 0) {
      toast.success(t("testAllOk", { count: ok.length }));
    } else {
      toast.error(
        t("testAllFailed", {
          ok: ok.length,
          failed: bad.length,
          unknown: unknown.length,
          names: bad
            .concat(unknown)
            .slice(0, 3)
            .map((r) => r.tool.display_name)
            .join("、"),
        })
      );
    }
  };

  const getCategoryBadge = (category: string) => {
    const colors = {
      search: "bg-green-100 text-green-800",
      time: "bg-orange-100 text-orange-800",
      stock: "bg-red-100 text-red-800",
      query: "bg-indigo-100 text-indigo-800",
      email: "bg-pink-100 text-pink-800",
    };
    return colors[category as keyof typeof colors] || "bg-gray-100 text-gray-800";
  };

  return (
    <div className="container mx-auto p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">{t("pageTitle")}</h1>
          <p className="text-muted-foreground mt-1">{t("pageDescription")}</p>
        </div>
        {tab === "managed" && canManageTools && (
          <Button onClick={handleCreate}>
            <Plus className="h-4 w-4 mr-2" />
            {t("addTool")}
          </Button>
        )}
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle>
              {tab === "builtin"
                ? t("builtinList", { count: builtins.length })
                : t("toolList", { count: total })}
            </CardTitle>
            <div className="flex items-center gap-2">
              <div className="flex gap-1">
                <Button
                  variant={tab === "managed" ? "default" : "outline"}
                  size="sm"
                  onClick={() => setTab("managed")}
                >
                  {t("managedTools")}
                </Button>
                {isSuperAdmin && (
                  <Button
                    variant={tab === "builtin" ? "default" : "outline"}
                    size="sm"
                    onClick={() => setTab("builtin")}
                  >
                    {t("builtinTools")}
                  </Button>
                )}
              </div>

              {tab === "managed" && canManageTools && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleTestAll}
                  disabled={bulkTest.running}
                >
                  {bulkTest.running ? (
                    <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                  ) : (
                    <PlugZap className="h-4 w-4 mr-1" />
                  )}
                  {bulkTest.running
                    ? t("testConnectionProgress", {
                        done: bulkTest.done,
                        total: bulkTest.total,
                      })
                    : t("testConnectionAll")}
                </Button>
              )}

              {tab === "managed" && (
                <Select
                  value={isEnabled === undefined ? "all" : isEnabled ? "enabled" : "disabled"}
                  onValueChange={(value) => {
                    if (value === "all") setIsEnabled(undefined);
                    else setIsEnabled(value === "enabled");
                  }}
                >
                  <SelectTrigger className="w-32">
                    <SelectValue placeholder={t("enabledStatus")} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">{t("allStatus")}</SelectItem>
                    <SelectItem value="enabled">{t("enabled")}</SelectItem>
                    <SelectItem value="disabled">{t("disabled")}</SelectItem>
                  </SelectContent>
                </Select>
              )}
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {tab === "builtin" ? (
            <BuiltinToolsTable
              builtins={builtins}
              meta={builtinMeta}
              loading={builtinLoading}
              error={builtinError}
            />
          ) : loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          ) : tools.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">{t("noData")}</div>
          ) : (
            <Table className="table-fixed">
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[30%]">{t("name")}</TableHead>
                  <TableHead className="w-[10%]">{t("category")}</TableHead>
                  <TableHead className="w-[22%]">{t("description")}</TableHead>
                  <TableHead className="w-[13%]">{t("creator")}</TableHead>
                  <TableHead className="w-[12%]">{t("status")}</TableHead>
                  <TableHead className="w-[13%] text-right">{t("actions")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {tools.map((tool) => (
                  <TableRow key={tool.id}>
                    <TableCell className="w-[30%] font-medium">
                      <div className="flex min-w-0 items-center gap-2">
                        <ToolIcon tool={tool} />
                        <div className="min-w-0">
                          <div className="truncate">{tool.display_name}</div>
                          {/* 连接情况放名字下方而不是另开一列：它是这个工具的属性，
                              离开名字就要靠人对行号，容易看串。
                              与提示词占用同一行 —— 两件事都是"这个工具现在是什么状态"。 */}
                          <ToolConnectionStatus tool={tool} />
                        </div>
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge className={getCategoryBadge(tool.category)}>{tool.category}</Badge>
                    </TableCell>
                    <TableCell className="max-w-md truncate">{tool.description}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {tool.created_by_name ||
                        (tool.created_by ? t("creatorDeleted") : t("creatorUnknown"))}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <Switch
                          checked={tool.is_enabled}
                          disabled={!canManageTools}
                          onCheckedChange={() => handleToggleEnabled(tool)}
                        />
                        <span className="text-sm">
                          {tool.is_enabled ? t("enabled") : t("disabled")}
                        </span>
                      </div>
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-2">
                        {/* 体检只对 MCP 工具有意义（native / workflow 不建立连接），
                            且只有管理员调得动后端那个端点 —— 按钮留给点不动的人，
                            等于把 403 当交互。 */}
                        {canManageTools && tool.tool_type === "mcp" && (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleTest(tool)}
                            disabled={testingIds.has(tool.id) || bulkTest.running}
                            title={t("testConnection")}
                          >
                            {testingIds.has(tool.id) ? (
                              <Loader2 className="h-4 w-4 animate-spin" />
                            ) : (
                              <PlugZap className="h-4 w-4" />
                            )}
                          </Button>
                        )}
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => router.push(`/tools/${tool.id}`)}
                        >
                          <Eye className="h-4 w-4" />
                        </Button>
                        {canManageTools && (
                          <Button variant="ghost" size="sm" onClick={() => handleEdit(tool)}>
                            <Edit className="h-4 w-4" />
                          </Button>
                        )}
                        {/* 只有 workflow 行不可删：那一行是某个长任务 kind 的唯一
                            开关，删掉后 refresh_enabled_from_db 会走"注册表里有、DB
                            里没有"的分支，能力保持默认启用且界面上再也关不掉。
                            MCP 行一律可删——它们之间没有系统/非系统之分，`qcc-*` 和
                            `mcp-tally` 同一形态，删了只是少一个连接配置。 */}
                        {canManageTools && tool.tool_type !== "workflow" && (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => {
                              setSelectedTool(tool);
                              setDeleteDialogOpen(true);
                            }}
                          >
                            <Trash2 className="h-4 w-4 text-destructive" />
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}

          {tab === "managed" && total > 20 && (
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
        </CardContent>
      </Card>

      {/* 删除确认对话框 */}
      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("deleteConfirmTitle")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("deleteConfirmDescription", { name: selectedTool?.display_name ?? "" })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("cancel")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              className="bg-destructive text-destructive-foreground"
            >
              {t("delete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* 创建/编辑工具对话框 */}
      <ToolFormDialog
        open={formDialogOpen}
        onClose={handleFormClose}
        tool={editingTool}
        createTool={createTool}
        updateTool={updateTool}
      />
    </div>
  );
}

/**
 * 工具的连接情况（顺带提示词占用）。
 *
 * 放在一起是因为用户问的是同一个问题的两半：这个工具**现在能不能用**、用起来**多贵**。
 *
 * 四档，**不能压成两档**：
 *
 * - 已连接（ok）→ 绿勾 + "N 个子工具 · 约 X tokens/轮"
 * - 连接失败（failed）→ 红字 + 原因。原先这档只有一句"未注册成功，模型调不到"，
 *   说不出为什么；而"密钥过期"和"对端不在"要做的处置完全相反。
 * - 未配置（unconfigured）→ 琥珀色 + 缺哪一项。后端**没发任何网络请求**就判出来了
 *   （占位值 / 环境变量未设置），处置是去改配置，不是等对端恢复。
 * - 未验证（没有 footprint）→ 灰字。配置完整，但还没有任何请求用过它、也没体检过。
 *   注册是**按需**的（启动时不注册），所以这是**正常状态**，不是"坏的"——
 *   这正是它必须和"失败"长得不一样的原因，否则每个新工具看起来都是坏的。
 *
 * native / workflow 不建立连接 → 什么都不画（画"未验证"会误导）。
 */
function ToolConnectionStatus({ tool }: { tool: Tool }) {
  const t = useTranslations("tools");

  if (tool.tool_type !== "mcp") return null;

  const fp = tool.footprint;

  if (!fp) {
    return (
      <div
        className="flex items-center gap-1 text-xs text-muted-foreground"
        title={t("connUntestedHint")}
      >
        <CircleHelp className="h-3 w-3 shrink-0" />
        <span>{t("connUntested")}</span>
      </div>
    );
  }

  if (fp.status === "unconfigured") {
    return (
      <ConnectionStatusTooltip
        ariaLabel={t("connStatusWithReason", {
          status: t("connUnconfigured"),
          reason: fp.error || t("connNoDiagnostic"),
        })}
        error={fp.error}
        hint={t("connUnconfiguredHint")}
        icon={<CircleAlert className="h-3 w-3 shrink-0" />}
        label={t("connUnconfigured")}
        statusClassName="text-amber-600 dark:text-amber-500"
      />
    );
  }

  if (fp.status === "failed") {
    return (
      <ConnectionStatusTooltip
        ariaLabel={t("connStatusWithReason", {
          status: t("connFailed"),
          reason: fp.error || t("connNoDiagnostic"),
        })}
        error={fp.error}
        hint={t("connFailedHint")}
        icon={<CircleAlert className="h-3 w-3 shrink-0" />}
        label={t("connFailed")}
        statusClassName="text-destructive"
      />
    );
  }

  return (
    <div
      className="flex items-center gap-1 text-xs text-muted-foreground"
      title={
        fp.checked_at
          ? t("connOkCheckedHint", {
              time: new Date(fp.checked_at * 1000).toLocaleString(),
            })
          : t("connOkHint")
      }
    >
      <CircleCheck className="h-3 w-3 shrink-0 text-green-600" />
      <span>
        {t("footprintSummary", {
          count: fp.subtool_count,
          tokens: formatTokens(fp.estimated_tokens),
        })}
      </span>
    </div>
  );
}

function ConnectionStatusTooltip({
  ariaLabel,
  error,
  hint,
  icon,
  label,
  statusClassName,
}: {
  ariaLabel: string;
  error?: string | null;
  hint: string;
  icon: ReactNode;
  label: string;
  statusClassName: string;
}) {
  const t = useTranslations("tools");

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            className={`flex items-center gap-1 text-left text-xs ${statusClassName}`}
            aria-label={ariaLabel}
          >
            {icon}
            <span>{label}</span>
          </button>
        </TooltipTrigger>
        <TooltipContent className="max-w-[calc(100vw-2rem)] break-words sm:max-w-md">
          <div className="space-y-1">
            <p>{hint}</p>
            {error && (
              <p className="text-muted-foreground">
                {t("connDiagnostic")}: {error}
              </p>
            )}
          </div>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
