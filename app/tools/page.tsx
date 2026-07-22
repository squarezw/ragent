"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
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
  const [toolType, setToolType] = useState<"native" | "mcp" | undefined>();
  const [isEnabled, setIsEnabled] = useState<boolean | undefined>();
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [selectedTool, setSelectedTool] = useState<Tool | null>(null);
  const [formDialogOpen, setFormDialogOpen] = useState(false);
  const [editingTool, setEditingTool] = useState<Tool | null>(null);

  const { tools, total, loading, createTool, updateTool, deleteTool, toggleToolEnabled, refresh } =
    useTools({
      tool_type: toolType,
      is_enabled: isEnabled,
      page,
      page_size: 20,
    });

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
        <Button onClick={handleCreate}>
          <Plus className="h-4 w-4 mr-2" />
          {t("addTool")}
        </Button>
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle>{t("toolList", { count: total })}</CardTitle>
            <div className="flex gap-2">
              <Select
                value={toolType || "all"}
                onValueChange={(value) =>
                  setToolType(value === "all" ? undefined : (value as "native" | "mcp"))
                }
              >
                <SelectTrigger className="w-32">
                  <SelectValue placeholder={t("toolType")} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{t("allTypes")}</SelectItem>
                  <SelectItem value="native">{t("nativeTool")}</SelectItem>
                  <SelectItem value="mcp">{t("mcpTool")}</SelectItem>
                </SelectContent>
              </Select>

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
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {loading ? (
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
                  <TableHead>{t("systemTool")}</TableHead>
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
                          onCheckedChange={() => handleToggleEnabled(tool)}
                        />
                        <span className="text-sm">
                          {tool.is_enabled ? t("enabled") : t("disabled")}
                        </span>
                      </div>
                    </TableCell>
                    <TableCell>
                      {tool.is_system && <Badge variant="outline">{t("system")}</Badge>}
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
                        <Button variant="ghost" size="sm" onClick={() => handleEdit(tool)}>
                          <Edit className="h-4 w-4" />
                        </Button>
                        {!tool.is_system && (
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
