"use client";

import { useState, useEffect } from "react";
import { useTranslations } from "next-intl";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Loader2 } from "lucide-react";
import type { Tool } from "@/hooks/useTools";

interface ToolFormDialogProps {
  open: boolean;
  onClose: (success?: boolean) => void;
  tool?: Tool | null;
  createTool: (tool: Partial<Tool>) => Promise<Tool | null>;
  updateTool: (id: number, tool: Partial<Tool>) => Promise<Tool | null>;
}

export function ToolFormDialog({
  open,
  onClose,
  tool,
  createTool,
  updateTool,
}: ToolFormDialogProps) {
  const t = useTranslations("tools");
  const [loading, setLoading] = useState(false);
  const [configError, setConfigError] = useState("");
  const [formData, setFormData] = useState({
    name: "",
    display_name: "",
    description: "",
    // 联合类型跟 Tool 一致（表里确实有 workflow 行），但**只有 mcp 能新建**：见下方
    // Select。默认值随之改成 mcp——原来默认 native，而那种行现在建了等于没建。
    tool_type: "mcp" as "native" | "mcp" | "workflow",
    category: "search",
    icon: "",
    default_config: "{}",
    is_enabled: true,
    version: "1.0.0",
    author: "",
    documentation_url: "",
  });

  useEffect(() => {
    if (tool) {
      setFormData({
        name: tool.name,
        display_name: tool.display_name,
        description: tool.description,
        tool_type: tool.tool_type,
        category: tool.category,
        icon: tool.icon || "",
        default_config: JSON.stringify(tool.default_config, null, 2),
        is_enabled: tool.is_enabled,
        version: tool.version || "1.0.0",
        author: tool.author || "",
        documentation_url: tool.documentation_url || "",
      });
    } else {
      setFormData({
        name: "",
        display_name: "",
        description: "",
        tool_type: "mcp",
        category: "search",
        icon: "",
        default_config: "{}",
        is_enabled: true,
        version: "1.0.0",
        author: "",
        documentation_url: "",
      });
    }
    setConfigError("");
  }, [tool, open]);

  const handleConfigChange = (value: string) => {
    setFormData({ ...formData, default_config: value });
    try {
      JSON.parse(value);
      setConfigError("");
    } catch {
      setConfigError(t("invalidJson"));
    }
  };

  const handleSubmit = async () => {
    setLoading(true);

    try {
      const config = JSON.parse(formData.default_config);

      const data: any = {
        name: formData.name,
        display_name: formData.display_name,
        description: formData.description,
        tool_type: formData.tool_type,
        category: formData.category,
        icon: formData.icon || undefined,
        default_config: config,
        is_enabled: formData.is_enabled,
        version: formData.version || undefined,
        author: formData.author || undefined,
        documentation_url: formData.documentation_url || undefined,
      };

      let result;
      if (tool) {
        result = await updateTool(tool.id, data);
      } else {
        result = await createTool(data);
      }

      if (result) {
        onClose(true);
      }
    } catch (error) {
      console.error("Form submission error:", error);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={() => onClose()}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{tool ? t("editTool") : t("addTool")}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label htmlFor="name">{t("toolIdentifier")}</Label>
              <Input
                id="name"
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                placeholder={t("toolIdentifierPlaceholder")}
                disabled={!!tool}
              />
            </div>

            <div>
              <Label htmlFor="display_name">{t("displayName")}</Label>
              <Input
                id="display_name"
                value={formData.display_name}
                onChange={(e) => setFormData({ ...formData, display_name: e.target.value })}
                placeholder={t("displayNamePlaceholder")}
              />
            </div>
          </div>

          <div>
            <Label htmlFor="description">{t("descriptionLabel")}</Label>
            <Textarea
              id="description"
              value={formData.description}
              onChange={(e) => setFormData({ ...formData, description: e.target.value })}
              placeholder={t("descriptionPlaceholder")}
              rows={3}
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label htmlFor="tool_type">{t("toolTypeLabel")}</Label>
              {/* 只能选 MCP。
                  · 原生工具**建不出来**：迁移 042 之后它们在 tools 表没有行，名册和
                    授权判据都在后端代码里，加一个要改代码发版。留着这个选项只会让人
                    建出一行什么都不做的记录。
                  · workflow 行由 kind 自动发现产生，也不该在这里手工新建。
                  编辑既有的非 MCP 行时，把它当前的类型以只读形式显示出来——不给一个
                  会把它悄悄改成 MCP 的下拉。 */}
              {formData.tool_type === "mcp" ? (
                <Select value="mcp" disabled>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="mcp">{t("mcpTool")}</SelectItem>
                  </SelectContent>
                </Select>
              ) : (
                <div className="h-10 flex items-center text-sm text-muted-foreground">
                  {formData.tool_type === "native" ? t("nativeTool") : t("workflowTool")}
                </div>
              )}
            </div>

            <div>
              <Label htmlFor="category">{t("categoryLabel")}</Label>
              <Select
                value={formData.category}
                onValueChange={(value) => setFormData({ ...formData, category: value })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="search">{t("categorySearch")}</SelectItem>
                  <SelectItem value="time">{t("categoryTime")}</SelectItem>
                  <SelectItem value="stock">{t("categoryStock")}</SelectItem>
                  <SelectItem value="query">{t("categoryQuery")}</SelectItem>
                  <SelectItem value="email">{t("categoryEmail")}</SelectItem>
                  <SelectItem value="other">{t("categoryOther")}</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* JSON Config */}
          <div>
            <Label htmlFor="default_config">{t("defaultConfigLabel")}</Label>
            <Textarea
              id="default_config"
              value={formData.default_config}
              onChange={(e) => handleConfigChange(e.target.value)}
              placeholder={t("defaultConfigPlaceholder")}
              rows={8}
              className="font-mono text-sm"
            />
            {configError && <p className="text-sm text-destructive mt-1">{configError}</p>}
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label htmlFor="icon">{t("iconUrl")}</Label>
              <Input
                id="icon"
                value={formData.icon}
                onChange={(e) => setFormData({ ...formData, icon: e.target.value })}
                placeholder={t("iconUrlPlaceholder")}
              />
            </div>

            <div>
              <Label htmlFor="version">{t("versionLabel")}</Label>
              <Input
                id="version"
                value={formData.version}
                onChange={(e) => setFormData({ ...formData, version: e.target.value })}
                placeholder={t("versionPlaceholder")}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label htmlFor="author">{t("authorLabel")}</Label>
              <Input
                id="author"
                value={formData.author}
                onChange={(e) => setFormData({ ...formData, author: e.target.value })}
                placeholder={t("authorPlaceholder")}
              />
            </div>

            <div>
              <Label htmlFor="documentation_url">{t("documentationUrl")}</Label>
              <Input
                id="documentation_url"
                value={formData.documentation_url}
                onChange={(e) => setFormData({ ...formData, documentation_url: e.target.value })}
                placeholder={t("documentationUrlPlaceholder")}
              />
            </div>
          </div>

          <div className="flex items-center space-x-2">
            <Switch
              id="is_enabled"
              checked={formData.is_enabled}
              onCheckedChange={(checked) => setFormData({ ...formData, is_enabled: checked })}
            />
            <Label htmlFor="is_enabled">{t("enableTool")}</Label>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onClose()} disabled={loading}>
            {t("cancel")}
          </Button>
          <Button onClick={handleSubmit} disabled={loading || !!configError}>
            {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {tool ? t("save") : t("create")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
