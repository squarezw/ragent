"use client";
import { useWorkspace } from "@/app/components/WorkspaceProvider";

import { use, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ArrowLeft, Download, Loader2 } from "lucide-react";
import SkillEditor from "../components/SkillEditor";
import SkillDiffDialog from "../components/SkillDiffDialog";
import SkillAssetsPanel from "../components/SkillAssetsPanel";
import SkillGitPanel from "../components/SkillGitPanel";
import SkillUserEnvPanel from "../components/SkillUserEnvPanel";
import { useSkill, type SkillPayload } from "@/hooks/useSkills";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { checkSuperAdmin, checkTenantAdmin } from "@/lib/clientPermissions";
import { canEditSkill, canManageSkillLifecycle, canPublishSkill } from "@/lib/skillPermissions";
import { parseSaveWarnings, takeSaveWarnings } from "@/lib/skillRequires";

export default function SkillDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const router = useRouter();
  const t = useTranslations("skills");
  const tc = useTranslations("common");
  const { id } = use(params);
  const skillId = Number(id);

  const { user, loading: userLoading } = useCurrentUser();
  const workspace = useWorkspace();
  const accessScope = !userLoading && user && (!workspace.enabled || (workspace.ready && workspace.tenant))
    ? JSON.stringify([user.id, user.tenant_id, user.dept_id, user.status, user.roles, checkSuperAdmin(user), checkTenantAdmin(user), workspace.enabled, workspace.tenant?.id ?? null])
    : null;
  const {
    skill,
    loading,
    saveDraft,
    transferTenant,
    publish,
    submitReview,
    exportMarkdown,
    refresh,
  } = useSkill(Number.isFinite(skillId) ? skillId : null, accessScope);
  const [saving, setSaving] = useState(false);
  const [exportContent, setExportContent] = useState<string | null>(null);
  const [diffSkillId, setDiffSkillId] = useState<number | null>(null);
  const [saveWarnings, setSaveWarnings] = useState<string[]>([]);

  // 新建页 POST 后跳转过来的 warnings
  useEffect(() => {
    if (Number.isFinite(skillId)) {
      const stashed = takeSaveWarnings(skillId);
      if (stashed.length > 0) setSaveWarnings(stashed);
    }
  }, [skillId]);

  // P5：具备审核权者直接发布（自审即过），普通用户走提交审核
  const canViewContent = skill?.can_view_content === true;
  const canReview = checkSuperAdmin(user) || checkTenantAdmin(user);
  // Source visibility comes only from the backend's creator/system-super/owner-tenant-admin capability.
  // Editing additionally retains the existing lifecycle/workspace checks.
  const canEditAssets = canViewContent && canEditSkill(skill, user, checkSuperAdmin(user), checkTenantAdmin(user), workspace.enabled ? workspace.tenant?.id ?? null : undefined);

  const canManageLifecycle = canManageSkillLifecycle(skill, user, checkSuperAdmin(user), checkTenantAdmin(user), workspace.enabled ? workspace.tenant?.id ?? null : undefined);

  const canPublish = canPublishSkill(skill, user, checkSuperAdmin(user), checkTenantAdmin(user), workspace.enabled ? workspace.tenant?.id ?? null : undefined);

  const handleSaveDraft = async (payload: SkillPayload) => {
    setSaving(true);
    setSaveWarnings(parseSaveWarnings(await saveDraft(payload)));
    setSaving(false);
  };

  const handlePublish = async (payload: SkillPayload) => {
    setSaving(true);
    const saved = await saveDraft(payload);
    setSaveWarnings(parseSaveWarnings(saved));
    if (saved) {
      await publish();
    }
    setSaving(false);
  };

  const handleSubmitReview = async (payload: SkillPayload) => {
    setSaving(true);
    const saved = await saveDraft(payload);
    setSaveWarnings(parseSaveWarnings(saved));
    if (saved) {
      await submitReview();
    }
    setSaving(false);
  };

  const handleExport = async () => {
    if (!canViewContent) return;
    const content = await exportMarkdown();
    if (content !== null) {
      setExportContent(content);
    }
  };

  if (userLoading || !user || loading) {
    return (
      <div className="container mx-auto p-6">
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      </div>
    );
  }

  if (!skill) {
    return (
      <div className="container mx-auto p-6 text-center py-12">
        <p className="text-muted-foreground">{t("skillNotFound")}</p>
        <Button onClick={() => router.push("/skills")} className="mt-4">
          {t("backToList")}
        </Button>
      </div>
    );
  }

  return (
    <div className="container mx-auto p-6 space-y-4">
      <div className="flex items-center justify-between">
        <Button variant="ghost" onClick={() => router.push("/skills")}>
          <ArrowLeft className="h-4 w-4 mr-2" />
          {t("backToList")}
        </Button>
        {canViewContent && <Button variant="outline" onClick={handleExport}>
          <Download className="h-4 w-4 mr-2" />
          {t("exportSkillMd")}
        </Button>}
      </div>

      {canViewContent ? <>
      <SkillEditor
        skill={skill}
        saving={saving}
        canReview={canReview}
        readOnly={!canEditAssets}
        canManageLifecycle={canManageLifecycle}
        canPublish={canPublish}
        isSuperAdmin={checkSuperAdmin(user)}
        isTenantAdmin={checkTenantAdmin(user)}
        onTransferTenant={canManageLifecycle ? async (tenantId) => {
          await transferTenant(tenantId);
        } : undefined}
        onSaveDraft={handleSaveDraft}
        onPublish={handlePublish}
        onSubmitReview={handleSubmitReview}
        onShowDiff={() => setDiffSkillId(skill.id)}
        onCancel={() => router.push("/skills")}
        warnings={saveWarnings}
        onDismissWarnings={() => setSaveWarnings([])}
      />

      {/* P8：参考文档/资产文件（任何 skill）+ 可执行运行配置（仅可执行 skill），仅编辑权可见。
          GitHub 来源夹在这两块之间，默认收起。 */}
      <SkillAssetsPanel
        skill={skill}
        canEdit={canEditAssets}
        onSkillChanged={() => refresh()}
        afterAssets={
          <SkillGitPanel
            skillId={skill.id}
            canEdit={canManageLifecycle}
            onSynced={() => refresh()}
          />
        }
      />

      </> : (
        <section className="space-y-2 rounded-md border p-4">
          <h1 className="text-xl font-semibold">{skill.display_name || skill.name}</h1>
          <p className="text-sm text-muted-foreground">{skill.description}</p>
          {skill.is_executable && <p className="text-sm">{t("executableHint")}</p>}
          <p className="text-sm text-muted-foreground">{t("contentAccessRestricted")}</p>
        </section>
      )}

      {/*
        个人环境变量：**不受 canEditAssets 约束**——配凭据的是 skill 的使用者，
        他通常既不是作者也不是管理员；写的也只是自己那一行。
        skill 没声明 env 模板时组件自己整块不渲染。
      */}
      {skill.is_executable === true && <SkillUserEnvPanel skillId={skill.id} skillDisplayName={skill.display_name || skill.name} />}

      {/* 草稿 vs 已发布对照 */}
      {canViewContent && <SkillDiffDialog
        skillId={diffSkillId}
        skillName={skill.name}
        onOpenChange={(open) => !open && setDiffSkillId(null)}
      />}

      {/* SKILL.md 导出预览 */}
      {canViewContent && <Dialog
        open={exportContent !== null}
        onOpenChange={(open) => !open && setExportContent(null)}
      >
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>{t("exportSkillMd")}</DialogTitle>
          </DialogHeader>
          <pre className="text-xs bg-muted rounded-md p-4 max-h-[60vh] overflow-auto whitespace-pre-wrap">
            {exportContent}
          </pre>
          <div className="flex justify-end">
            <Button
              variant="outline"
              onClick={() => {
                if (exportContent !== null) {
                  const blob = new Blob([exportContent], { type: "text/markdown" });
                  const url = URL.createObjectURL(blob);
                  const a = document.createElement("a");
                  a.href = url;
                  a.download = `${skill.name}.SKILL.md`;
                  a.click();
                  URL.revokeObjectURL(url);
                }
              }}
            >
              <Download className="h-4 w-4 mr-2" />
              {tc("download")}
            </Button>
          </div>
        </DialogContent>
      </Dialog>}
    </div>
  );
}
