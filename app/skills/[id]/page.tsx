"use client";

import { use, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ArrowLeft, Download, Loader2 } from "lucide-react";
import SkillEditor from "../components/SkillEditor";
import { useSkill, type SkillPayload } from "@/hooks/useSkills";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { checkSuperAdmin, checkTenantAdmin } from "@/lib/clientPermissions";

export default function SkillDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const router = useRouter();
  const t = useTranslations("skills");
  const tc = useTranslations("common");
  const { id } = use(params);
  const skillId = Number(id);

  const { user, loading: userLoading } = useCurrentUser();
  const { skill, loading, saveDraft, publish, exportMarkdown } = useSkill(
    Number.isFinite(skillId) ? skillId : null
  );
  const [saving, setSaving] = useState(false);
  const [exportContent, setExportContent] = useState<string | null>(null);

  const handleSaveDraft = async (payload: SkillPayload) => {
    setSaving(true);
    await saveDraft(payload);
    setSaving(false);
  };

  const handlePublish = async (payload: SkillPayload) => {
    setSaving(true);
    const saved = await saveDraft(payload);
    if (saved) {
      await publish();
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

  if (!checkSuperAdmin(user) && !checkTenantAdmin(user)) {
    return <div className="flex items-center justify-center h-64">{t("noPermission")}</div>;
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
    <div className="container mx-auto p-6 max-w-4xl space-y-4">
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
        onSaveDraft={handleSaveDraft}
        onPublish={handlePublish}
        onCancel={() => router.push("/skills")}
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
