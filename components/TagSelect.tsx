import React, { useState, useEffect } from "react";
import { useTranslations } from "next-intl";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Plus, X } from "lucide-react";
import axios from "@/lib/axios";
import { toast } from "sonner";

interface Tag {
  id: number;
  name: string;
  color: string;
}

interface TagSelectProps {
  value: number[];
  onChange: (tagIds: number[]) => void;
  disabled?: boolean;
  className?: string;
}

export default function TagSelect({
  value,
  onChange,
  disabled = false,
  className = "",
}: TagSelectProps) {
  const t = useTranslations("common");
  const [tags, setTags] = useState<Tag[]>([]);
  const [selectedTags, setSelectedTags] = useState<Tag[]>([]);
  const [showCreateTag, setShowCreateTag] = useState(false);
  const [newTagName, setNewTagName] = useState("");
  const [newTagColor, setNewTagColor] = useState("#3b82f6");

  // 获取所有标签
  const fetchTags = async () => {
    try {
      const response = await axios.get("/api/knowledge/tags");
      setTags(response.data.tags || []);
    } catch (error) {
      console.error("Fetch tags failed:", error);
      toast.error(t("fetchTagsFailed"));
    }
  };

  // 创建新标签
  const handleCreateTag = async () => {
    if (!newTagName.trim()) return;

    try {
      const response = await axios.post("/api/knowledge/tags", {
        name: newTagName.trim(),
        color: newTagColor,
      });

      const newTag = response.data.tag;
      setTags((prev) => [...prev, newTag]);
      setNewTagName("");
      setNewTagColor("#3b82f6");
      setShowCreateTag(false);
    } catch (error) {
      console.error("Create tag failed:", error);
      toast.error(t("createTagFailed"));
    }
  };

  // 选择标签
  const handleSelectTag = (tag: Tag) => {
    if (value.includes(tag.id)) {
      // 取消选择
      const newValue = value.filter((id) => id !== tag.id);
      onChange(newValue);
    } else {
      // 选择标签
      onChange([...value, tag.id]);
    }
  };

  // 移除标签
  const handleRemoveTag = (tagId: number) => {
    const newValue = value.filter((id) => id !== tagId);
    onChange(newValue);
  };

  // 初始化选中的标签
  useEffect(() => {
    const selected = tags.filter((tag) => value.includes(tag.id));
    setSelectedTags(selected);
  }, [value, tags]);

  // 组件挂载时获取标签
  useEffect(() => {
    fetchTags();
  }, []);

  const colorOptions = [
    "#3b82f6",
    "#10b981",
    "#f59e0b",
    "#ef4444",
    "#8b5cf6",
    "#06b6d4",
    "#84cc16",
    "#f97316",
  ];

  return (
    <div className={`space-y-3 ${className}`}>
      <div className="flex items-center justify-between">
        <label className="text-sm font-medium">{t("tagsOptional")}</label>
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() => setShowCreateTag(!showCreateTag)}
          disabled={disabled}
        >
          <Plus className="h-4 w-4 mr-1" />
          {t("createTag")}
        </Button>
      </div>

      {/* 创建新标签 */}
      {showCreateTag && (
        <div className="p-3 border rounded-lg bg-muted">
          <div className="space-y-3">
            <Input
              placeholder={t("tagName")}
              value={newTagName}
              onChange={(e) => setNewTagName(e.target.value)}
              onKeyPress={(e) => e.key === "Enter" && handleCreateTag()}
            />
            <div className="flex items-center gap-2">
              <span className="text-sm text-muted-foreground">{t("color")}:</span>
              <div className="flex gap-1">
                {colorOptions.map((color) => (
                  <button
                    key={color}
                    type="button"
                    className={`w-6 h-6 rounded-full border-2 ${
                      newTagColor === color ? "border-gray-800" : "border-border"
                    }`}
                    style={{ backgroundColor: color }}
                    onClick={() => setNewTagColor(color)}
                  />
                ))}
              </div>
            </div>
            <div className="flex gap-2">
              <Button size="sm" onClick={handleCreateTag} disabled={!newTagName.trim()}>
                {t("create")}
              </Button>
              <Button size="sm" variant="outline" onClick={() => setShowCreateTag(false)}>
                {t("cancel")}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* 已选标签 */}
      {selectedTags.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {selectedTags.map((tag) => (
            <Badge
              key={tag.id}
              style={{ backgroundColor: tag.color, color: "white" }}
              className="group flex items-center gap-1"
            >
              {tag.name}
              <button
                type="button"
                onClick={() => handleRemoveTag(tag.id)}
                className="ml-1 hover:bg-black hover:bg-opacity-20 rounded-full p-0.5 opacity-0 group-hover:opacity-100 transition-opacity"
                aria-label={t("removeTag")}
              >
                <X className="h-3 w-3" />
              </button>
            </Badge>
          ))}
        </div>
      )}

      {/* 标签选择 */}
      <div className="flex flex-wrap gap-2 max-h-40 overflow-y-auto">
        {tags.map((tag) => {
          const isSelected = value.includes(tag.id);
          return (
            <button
              key={tag.id}
              type="button"
              disabled={disabled}
              onClick={() => handleSelectTag(tag)}
              className={`
                group inline-flex items-center gap-1 px-2 py-1 rounded-full border text-sm leading-none transition-all
                ${
                  isSelected
                    ? "border-blue-500 bg-blue-50 text-primary"
                    : "border-gray-200 hover:border-border text-foreground"
                }
                ${disabled ? "opacity-50 cursor-not-allowed" : "cursor-pointer"}
              `}
            >
              <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: tag.color }} />
              <span>{tag.name}</span>
              {isSelected && (
                <>
                  <span className="ml-0.5 text-[10px] px-1 py-0.5 rounded bg-blue-100 text-primary">
                    {t("selected")}
                  </span>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleRemoveTag(tag.id);
                    }}
                    className="ml-0.5 rounded-full p-0.5 opacity-0 group-hover:opacity-100 transition-opacity hover:bg-blue-200"
                    aria-label={t("deselectTag")}
                  >
                    <X className="h-3 w-3" />
                  </button>
                </>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
