"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Loader2 } from "lucide-react";
import axios from "@/lib/axios";
import type { SkillDiff } from "@/types/review";

interface SkillDiffDialogProps {
  /** null = 关闭 */
  skillId: number | null;
  /** 对话框标题里的 skill 名称 */
  skillName?: string;
  onOpenChange: (open: boolean) => void;
}

/**
 * 草稿 vs 已发布两栏对照（GET /api/v1/skills/{id}/diff）。
 * 简单左右 pre 对照，不引 diff 库。
 */
export default function SkillDiffDialog({
  skillId,
  skillName,
  onOpenChange,
}: SkillDiffDialogProps) {
  const t = useTranslations("skills");
  const [diff, setDiff] = useState<SkillDiff | null>(null);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (skillId == null) {
      setDiff(null);
      setFailed(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setFailed(false);
    axios
      .get(`/api/v1/skills/${skillId}/diff`, { suppressErrorToast: true } as any)
      .then((res) => {
        if (cancelled) return;
        const data = res.data as Partial<SkillDiff> | undefined;
        setDiff({ draft: data?.draft ?? "", published: data?.published ?? null });
      })
      .catch((error) => {
        console.error("Fetch skill diff error:", error);
        if (!cancelled) setFailed(true);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [skillId]);

  return (
    <Dialog open={skillId !== null} onOpenChange={(open) => !open && onOpenChange(false)}>
      <DialogContent className="max-w-5xl">
        <DialogHeader>
          <DialogTitle>
            {t("diffTitle")}
            {skillName ? ` · ${skillName}` : ""}
          </DialogTitle>
        </DialogHeader>
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : failed ? (
          <p className="text-sm text-muted-foreground py-8 text-center">{t("diffLoadFailed")}</p>
        ) : diff ? (
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2 min-w-0">
              <p className="text-sm font-medium">{t("diffDraft")}</p>
              <pre className="text-xs bg-muted rounded-md p-3 max-h-[60vh] overflow-auto whitespace-pre-wrap">
                {diff.draft || t("diffEmpty")}
              </pre>
            </div>
            <div className="space-y-2 min-w-0">
              <p className="text-sm font-medium">{t("diffPublished")}</p>
              <pre className="text-xs bg-muted rounded-md p-3 max-h-[60vh] overflow-auto whitespace-pre-wrap">
                {diff.published ?? t("diffNotPublished")}
              </pre>
            </div>
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
