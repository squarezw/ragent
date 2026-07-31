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
import { AlertTriangle, Loader2, X } from "lucide-react";
import MarkdownRenderer from "@/components/MarkdownRenderer";
import ReviewLogDialog from "@/components/ReviewLogDialog";
import VisibilitySelect from "@/components/VisibilitySelect";
import axios from "@/lib/axios";
import { SKILL_DESCRIPTION_MAX_LENGTH, isValidSkillName } from "@/lib/skillValidation";
import { normalizeRequiresList } from "@/lib/skillRequires";
import { SKILL_BODY_SCAFFOLD } from "@/lib/skillScaffold";
import { useRequiresOptions } from "@/hooks/useRequiresOptions";
import { RequiresToolsSelector, RequiresWorkflowsSelector } from "./RequiresSelector";
import {
  hasUnpublishedChanges as computeUnpublishedChanges,
  resolveReviewStatus,
  reviewStatusBadge,
} from "@/lib/reviewStatus";
import type { Skill, SkillVisibility } from "@/types/skill";
import type { SkillPayload } from "@/hooks/useSkills";

interface SkillEditorProps {
  /** 编辑模式传入已加载的 skill；新建传 null */
  skill: Skill | null;
  saving: boolean;
  /** 具备审核权（超管/租户管理员）：显示「发布」（自审即过）；否则显示「提交审核」 */
  canReview: boolean;
  onSaveDraft: (payload: SkillPayload) => void;
  onPublish: (payload: SkillPayload) => void;
  /** 普通用户提交审核（先保存草稿再 submit-review） */
  onSubmitReview: (payload: SkillPayload) => void;
  /** 「对照」入口（草稿 vs 已发布）；从未发布时不显示 */
  onShowDiff?: () => void;
  onCancel: () => void;
  /** 上次保存返回的 requires warnings（不阻断保存，但要留在页面上直到用户主动关闭） */
  warnings?: string[];
  onDismissWarnings?: () => void;
}

export default function SkillEditor({
  skill,
  saving,
  canReview,
  onSaveDraft,
  onPublish,
  onSubmitReview,
  onShowDiff,
  onCancel,
  warnings = [],
  onDismissWarnings,
}: SkillEditorProps) {
  const t = useTranslations("skills");
  const tc = useTranslations("common");
  const tr = useTranslations("reviews");

  const [name, setName] = useState(skill?.name || "");
  const [reviewLogOpen, setReviewLogOpen] = useState(false);
  const [displayName, setDisplayName] = useState(skill?.display_name || "");
  const [description, setDescription] = useState(skill?.description || "");
  // 新建时用脚手架起头（编辑既有 skill 绝不注入，避免污染已有正文）
  const [content, setContent] = useState(skill ? skill.content || "" : SKILL_BODY_SCAFFOLD);
  const [requiresTools, setRequiresTools] = useState<string[]>(
    normalizeRequiresList(skill?.requires?.tools)
  );
  const [requiresWorkflows, setRequiresWorkflows] = useState<string[]>(
    normalizeRequiresList(skill?.requires?.workflows)
  );
  const [visibility, setVisibility] = useState<SkillVisibility>(skill?.visibility || "tenant");
  const [variables, setVariables] = useState<string[]>([]);
  const { options: requiresOptions } = useRequiresOptions();

  // skill 异步加载完成后回填表单
  useEffect(() => {
    if (skill) {
      setName(skill.name);
      setDisplayName(skill.display_name);
      setDescription(skill.description);
      setContent(skill.content);
      setRequiresTools(normalizeRequiresList(skill.requires?.tools));
      setRequiresWorkflows(normalizeRequiresList(skill.requires?.workflows));
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

  // 四态审核状态（后端 status 缺失时按 published_content 兜底推断）
  const status = skill ? resolveReviewStatus(skill.status, skill.published_content) : null;
  const statusBadge = status ? reviewStatusBadge(status) : null;
  const isPublished = skill != null && skill.published_content !== null;
  const isPending = status === "pending_review";
  // 已保存或本地编辑未保存，与已发布版本有差异都算「有未发布修改」
  const showUnpublishedChanges =
    skill != null &&
    (computeUnpublishedChanges(skill.content, skill.published_content) ||
      computeUnpublishedChanges(content, skill.published_content));

  const payload = useMemo<SkillPayload>(
    () => ({
      name: name.trim(),
      display_name: displayName.trim(),
      description: description.trim(),
      content,
      requires: {
        tools: requiresTools,
        workflows: requiresWorkflows,
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
            {statusBadge && (
              <Badge variant={statusBadge.variant} className={statusBadge.className}>
                {t(statusBadge.labelKey)}
              </Badge>
            )}
            {showUnpublishedChanges && (
              <Badge variant="outline" className="text-amber-600 border-amber-300">
                {t("statusUnpublishedChanges")}
              </Badge>
            )}
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={onCancel} disabled={saving}>
              {tc("cancel")}
            </Button>
            {skill != null && isPublished && onShowDiff && (
              <Button variant="outline" onClick={onShowDiff} disabled={saving}>
                {t("diffCompare")}
              </Button>
            )}
            {/* 审核中也允许继续保存草稿 */}
            <Button variant="secondary" onClick={() => onSaveDraft(payload)} disabled={!canSubmit}>
              {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              {t("saveDraft")}
            </Button>
            {canReview ? (
              // 具备审核权：直接发布（自审即过，后端照写审计）
              <Button onClick={() => onPublish(payload)} disabled={!canSubmit}>
                {t("publish")}
              </Button>
            ) : isPending ? (
              // 审核中：禁用提交按钮
              <Button disabled>{t("statusPendingReview")}</Button>
            ) : (
              <Button onClick={() => onSubmitReview(payload)} disabled={!canSubmit}>
                {t("submitReview")}
              </Button>
            )}
          </div>
        </div>
        {/* 被驳回：提示 + 驳回理由入口（审核日志弹窗，惰性拉取） */}
        {status === "rejected" && (
          <p className="text-sm text-destructive mt-2">
            {t("rejectedHint")}{" "}
            <Button
              variant="link"
              size="sm"
              className="h-auto p-0 text-sm underline"
              onClick={() => setReviewLogOpen(true)}
            >
              {tr("viewRejectReason")}
            </Button>
          </p>
        )}
        <ReviewLogDialog
          targetType="skill"
          targetId={reviewLogOpen && skill ? skill.id : null}
          targetName={skill?.display_name || skill?.name}
          onOpenChange={(open) => !open && setReviewLogOpen(false)}
        />
      </CardHeader>
      <CardContent className="space-y-6">
        {/* 保存成功但依赖有缺口：留在页面上直到用户主动关闭，不做一闪而过的 toast */}
        {warnings.length > 0 && (
          <section
            aria-live="polite"
            className="rounded-md border border-amber-300 bg-amber-50 p-3 dark:border-amber-800 dark:bg-amber-950/30"
          >
            <div className="flex items-start gap-2">
              <AlertTriangle
                className="h-4 w-4 mt-0.5 shrink-0 text-amber-600 dark:text-amber-400"
                aria-hidden="true"
              />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-amber-900 dark:text-amber-200">
                  {t("saveWarningsTitle", { count: warnings.length })}
                </p>
                <ul className="mt-1.5 space-y-1 list-disc pl-4">
                  {warnings.map((warning) => (
                    <li
                      key={warning}
                      className="text-sm text-amber-900 break-words dark:text-amber-200"
                    >
                      {warning}
                    </li>
                  ))}
                </ul>
                <p className="mt-1.5 text-xs text-amber-800 dark:text-amber-300">
                  {t("saveWarningsHint")}
                </p>
              </div>
              {onDismissWarnings && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 w-7 p-0 shrink-0"
                  aria-label={tc("close")}
                  onClick={onDismissWarnings}
                >
                  <X className="h-4 w-4" />
                </Button>
              )}
            </div>
          </section>
        )}

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
              {/* 各小节写法说明放这里而不是脚手架正文——正文会逐字注入 system prompt */}
              <p className="text-xs text-muted-foreground mt-2 whitespace-pre-line">
                {t("contentScaffoldHelp")}
              </p>
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
          <RequiresToolsSelector
            options={requiresOptions.tools}
            selected={requiresTools}
            onChange={setRequiresTools}
          />
          <RequiresWorkflowsSelector
            options={requiresOptions.workflows}
            selected={requiresWorkflows}
            onChange={setRequiresWorkflows}
          />
        </div>
        <p className="text-xs text-muted-foreground -mt-2">{t("requiresHelp")}</p>

        <VisibilitySelect
          value={visibility}
          onChange={(value) => setVisibility(value as SkillVisibility)}
        />
      </CardContent>
    </Card>
  );
}
