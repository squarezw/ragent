"use client";

import { useEffect, useState } from "react";
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
import { Plus, Edit, Trash2, Eye, Loader2, Wrench, Code, Globe } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTools, Tool } from "@/hooks/useTools";
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

  const { user } = useCurrentUser();
  const isSuperAdmin = checkSuperAdmin(user);
  // 写操作的判据必须与后端 _require_tool_manager 逐字一致：超管或租户管理员。
  // 这个页面此前对写操作**不设任何门**——只是侧边栏不给入口，直接敲 /tools
  // 就能改能删。按钮留给点不动的人，等于把 403 当交互。
  const canManageTools = isSuperAdmin || checkTenantAdmin(user);

  const { tools, total, loading, createTool, updateTool, deleteTool, toggleToolEnabled, refresh } =
    useTools({
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
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("name")}</TableHead>
                  <TableHead>{t("category")}</TableHead>
                  <TableHead>{t("description")}</TableHead>
                  <TableHead>{t("status")}</TableHead>
                  <TableHead className="text-right">{t("actions")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {tools.map((tool) => (
                  <TableRow key={tool.id}>
                    <TableCell className="font-medium">
                      <div className="flex items-center gap-2">
                        <ToolIcon tool={tool} />
                        <div>
                          <div>{tool.display_name}</div>
                          {/* 提示词占用：绑定这个工具后每一轮对话要多付多少。
                              放在工具名下方而不是另开一列 —— 这个数字是这个工具的属性，
                              离开它就要靠人对行号，容易看串。 */}
                          <ToolFootprintHint footprint={tool.footprint} />
                        </div>
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge className={getCategoryBadge(tool.category)}>{tool.category}</Badge>
                    </TableCell>
                    <TableCell className="max-w-md truncate">{tool.description}</TableCell>
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
              {t("deleteConfirmDescription", { name: selectedTool?.display_name })}
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
 * 工具的提示词占用。
 *
 * 一个 MCP 工具在这张表里只是一行，运行时却可能展开成几十个子工具的完整
 * JSON Schema，且每一轮对话都全量重发。2026-08-25 实测：一句「你好」耗
 * 39,550 输入 token，其中约 92% 是工具定义，企查查那四个端点独占 86%。
 * 这个提示的意义就是让绑定成本在勾选那一刻可见，而不是等看账单才发现。
 */
function ToolFootprintHint({ footprint }: { footprint?: Tool["footprint"] }) {
  const t = useTranslations("tools");
  // 缺席 = 这个工具不走 MCP 注册（native / workflow），不是"占用为 0"。
  // 硬造一个 0 会让两种完全不同的情况看起来一样。
  if (!footprint) return null;

  if (footprint.status === "failed") {
    // 连不上的服务器在这张表里和正常工具长得一模一样，而模型根本调不到它。
    return <div className="text-xs text-destructive">{t("footprintUnavailable")}</div>;
  }

  return (
    <div className="text-xs text-muted-foreground">
      {t("footprintSummary", {
        count: footprint.subtool_count,
        tokens: formatTokens(footprint.estimated_tokens),
      })}
    </div>
  );
}

function formatTokens(n: number): string {
  return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);
}
