"use client";

import { use, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ArrowLeft, Download, Loader2 } from "lucide-react";
import SkillEditor from "../components/SkillEditor";
import SkillDiffDialog from "../components/SkillDiffDialog";
import SkillAssetsPanel from "../components/SkillAssetsPanel";
import SkillUserEnvPanel from "../components/SkillUserEnvPanel";
import { useSkill, type SkillPayload } from "@/hooks/useSkills";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { checkSuperAdmin, checkTenantAdmin } from "@/lib/clientPermissions";
import { canEditSkill } from "@/lib/skillPermissions";
import { parseSaveWarnings, takeSaveWarnings } from "@/lib/skillRequires";

export default function SkillDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const router = useRouter();
  const t = useTranslations("skills");
  const tc = useTranslations("common");
  const { id } = use(params);
  const skillId = Number(id);

  const { user, loading: userLoading } = useCurrentUser();
  const {
    skill,
    loading,
    saveDraft,
    transferTenant,
    publish,
    submitReview,
    exportMarkdown,
    refresh,
  } = useSkill(
    Number.isFinite(skillId) ? skillId : null
  );
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
  const canReview = checkSuperAdmin(user) || checkTenantAdmin(user);
  // 资产/exec 配置编辑权 = 作者本人 / 超管 / **本租户**租户管理员，与后端
  // _can_edit_skill 同口径（共用 lib/skillPermissions，别在这里另写一份）。
  //
  // 原先写的是 `canReview || 作者本人`，而 canReview 里的 checkTenantAdmin 不带租户范围
  // ——别的租户的租户管理员在这一页能改，后端 is_reviewer 却要求同租户。松的一侧是界面，
  // 所以表现为"能编辑能保存，保存时 403"。
  const canEditAssets = canEditSkill(
    skill,
    user,
    checkSuperAdmin(user),
    checkTenantAdmin(user)
  );

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
        <Button variant="outline" onClick={handleExport}>
          <Download className="h-4 w-4 mr-2" />
          {t("exportSkillMd")}
        </Button>
      </div>

      <SkillEditor
        skill={skill}
        saving={saving}
        canReview={canReview}
        readOnly={!!skill.is_managed}
        isSuperAdmin={checkSuperAdmin(user)}
        isTenantAdmin={checkTenantAdmin(user)}
        onTransferTenant={async (tenantId) => {
          await transferTenant(tenantId);
        }}
        onSaveDraft={handleSaveDraft}
        onPublish={handlePublish}
        onSubmitReview={handleSubmitReview}
        onShowDiff={() => setDiffSkillId(skill.id)}
        onCancel={() => router.push("/skills")}
        warnings={saveWarnings}
        onDismissWarnings={() => setSaveWarnings([])}
      />

      {/* P8：参考文档/资产文件（任何 skill）+ 可执行运行配置（仅可执行 skill），仅编辑权可见 */}
      <SkillAssetsPanel skill={skill} canEdit={canEditAssets} onSkillChanged={() => refresh()} />

      {/*
        个人环境变量：**不受 canEditAssets 约束**——配凭据的是 skill 的使用者，
        他通常既不是作者也不是管理员；写的也只是自己那一行。
        skill 没声明 env 模板时组件自己整块不渲染。
      */}
      <SkillUserEnvPanel skillId={skill.id} skillDisplayName={skill.display_name || skill.name} />

      {/* 草稿 vs 已发布对照 */}
      <SkillDiffDialog
        skillId={diffSkillId}
        skillName={skill.name}
        onOpenChange={(open) => !open && setDiffSkillId(null)}
      />

      {/* SKILL.md 导出预览 */}
      <Dialog
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
      </Dialog>
    </div>
  );
}
