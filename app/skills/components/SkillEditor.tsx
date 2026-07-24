"use client";

import { useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Loader2 } from "lucide-react";
import MarkdownRenderer from "@/components/MarkdownRenderer";
import VisibilitySelect from "@/components/VisibilitySelect";
import axios from "@/lib/axios";
import {
  SKILL_DESCRIPTION_MAX_LENGTH,
  formatNameList,
  isValidSkillName,
  parseNameList,
} from "@/lib/skillValidation";
import type { Skill, SkillVisibility } from "@/types/skill";
import type { SkillPayload } from "@/hooks/useSkills";

interface SkillEditorProps {
  /** 编辑模式传入已加载的 skill；新建传 null */
  skill: Skill | null;
  saving: boolean;
  onSaveDraft: (payload: SkillPayload) => void;
  onPublish: (payload: SkillPayload) => void;
  onCancel: () => void;
}

export default function SkillEditor({
  skill,
  saving,
  onSaveDraft,
  onPublish,
  onCancel,
}: SkillEditorProps) {
  const t = useTranslations("skills");
  const tc = useTranslations("common");

  const [name, setName] = useState(skill?.name || "");
  const [displayName, setDisplayName] = useState(skill?.display_name || "");
  const [description, setDescription] = useState(skill?.description || "");
  const [content, setContent] = useState(skill?.content || "");
  const [requiresTools, setRequiresTools] = useState(formatNameList(skill?.requires?.tools));
  const [requiresWorkflows, setRequiresWorkflows] = useState(
    formatNameList(skill?.requires?.workflows)
  );
  const [visibility, setVisibility] = useState<SkillVisibility>(skill?.visibility || "tenant");
  const [variables, setVariables] = useState<string[]>([]);

  // skill 异步加载完成后回填表单
  useEffect(() => {
    if (skill) {
      setName(skill.name);
      setDisplayName(skill.display_name);
      setDescription(skill.description);
      setContent(skill.content);
      setRequiresTools(formatNameList(skill.requires?.tools));
      setRequiresWorkflows(formatNameList(skill.requires?.workflows));
      setVisibility(skill.visibility);
    }
  }, [skill]);

  // 可用变量提示（后端并行开发中，拿不到就静默隐藏）
  useEffect(() => {
    axios
      .get("/api/v1/prompt-variables", { suppressErrorToast: true } as any)
      .then((res) => {
        const list = Array.isArray(res.data) ? res.data : res.data?.items || res.data?.variables;
        if (Array.isArray(list)) {
          setVariables(list.map((v: any) => (typeof v === "string" ? v : v?.name)).filter(Boolean));
        }
      })
      .catch(() => {});
  }, []);

  const nameInvalid = name.length > 0 && !isValidSkillName(name);
  const descriptionTooLong = description.length > SKILL_DESCRIPTION_MAX_LENGTH;
  const canSubmit =
    !saving &&
    name.trim().length > 0 &&
    !nameInvalid &&
    description.trim().length > 0 &&
    !descriptionTooLong;

  const isPublished = skill != null && skill.published_content !== null;
  const hasUnpublishedChanges =
    skill != null && isPublished && skill.content !== skill.published_content;
  // 本地编辑未保存也算「与已发布版本有差异」
  const localDiffersFromPublished =
    skill != null && isPublished && content !== skill.published_content;

  const payload = useMemo<SkillPayload>(
    () => ({
      name: name.trim(),
      display_name: displayName.trim(),
      description: description.trim(),
      content,
      requires: {
        tools: parseNameList(requiresTools),
        workflows: parseNameList(requiresWorkflows),
      },
      visibility,
    }),
    [name, displayName, description, content, requiresTools, requiresWorkflows, visibility]
  );

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <CardTitle>{skill ? t("editSkill") : t("createSkill")}</CardTitle>
            {skill &&
              (isPublished ? (
                <Badge>{t("statusPublished")}</Badge>
              ) : (
                <Badge variant="secondary">{t("statusDraft")}</Badge>
              ))}
            {(hasUnpublishedChanges || localDiffersFromPublished) && (
              <Badge variant="outline" className="text-amber-600 border-amber-300">
                {t("statusUnpublishedChanges")}
              </Badge>
            )}
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={onCancel} disabled={saving}>
              {tc("cancel")}
            </Button>
            <Button variant="secondary" onClick={() => onSaveDraft(payload)} disabled={!canSubmit}>
              {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              {t("saveDraft")}
            </Button>
            <Button onClick={() => onPublish(payload)} disabled={!canSubmit}>
              {t("publish")}
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="space-y-2">
            <Label htmlFor="skill-name">{t("name")} *</Label>
            <Input
              id="skill-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="weekly-report-format"
              className={nameInvalid ? "border-destructive" : ""}
            />
            <p className={`text-xs ${nameInvalid ? "text-destructive" : "text-muted-foreground"}`}>
              {nameInvalid ? t("nameInvalid") : t("nameHelp")}
            </p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="skill-display-name">{t("displayName")}</Label>
            <Input
              id="skill-display-name"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder={t("displayNamePlaceholder")}
            />
          </div>
        </div>

        <div className="space-y-2">
          <Label htmlFor="skill-description">{t("description")} *</Label>
          <Textarea
            id="skill-description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder={t("descriptionPlaceholder")}
            rows={3}
            className={descriptionTooLong ? "border-destructive" : ""}
          />
          <div className="flex justify-between text-xs">
            <span className="text-muted-foreground">{t("descriptionHelp")}</span>
            <span className={descriptionTooLong ? "text-destructive" : "text-muted-foreground"}>
              {description.length}/{SKILL_DESCRIPTION_MAX_LENGTH}
            </span>
          </div>
        </div>

        <div className="space-y-2">
          <Label>{t("content")}</Label>
          <Tabs defaultValue="edit">
            <TabsList>
              <TabsTrigger value="edit">{t("contentEdit")}</TabsTrigger>
              <TabsTrigger value="preview">{t("contentPreview")}</TabsTrigger>
            </TabsList>
            <TabsContent value="edit">
              <Textarea
                value={content}
                onChange={(e) => setContent(e.target.value)}
                placeholder={t("contentPlaceholder")}
                rows={16}
                className="font-mono text-sm"
              />
            </TabsContent>
            <TabsContent value="preview">
              <div className="border rounded-md p-4 min-h-[200px] max-h-[480px] overflow-y-auto">
                {content.trim() ? (
                  <MarkdownRenderer content={content} />
                ) : (
                  <p className="text-sm text-muted-foreground">{t("previewEmpty")}</p>
                )}
              </div>
            </TabsContent>
          </Tabs>
          {variables.length > 0 && (
            <p className="text-xs text-muted-foreground">
              {t("availableVariables")}: {variables.join(", ")}
            </p>
          )}
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="space-y-2">
            <Label htmlFor="skill-requires-tools">{t("requiresTools")}</Label>
            <Input
              id="skill-requires-tools"
              value={requiresTools}
              onChange={(e) => setRequiresTools(e.target.value)}
              placeholder={t("requiresPlaceholder")}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="skill-requires-workflows">{t("requiresWorkflows")}</Label>
            <Input
              id="skill-requires-workflows"
              value={requiresWorkflows}
              onChange={(e) => setRequiresWorkflows(e.target.value)}
              placeholder={t("requiresPlaceholder")}
            />
          </div>
        </div>
        <p className="text-xs text-muted-foreground -mt-4">{t("requiresHelp")}</p>

        <VisibilitySelect
          value={visibility}
          onChange={(value) => setVisibility(value as SkillVisibility)}
        />
      </CardContent>
    </Card>
  );
}
