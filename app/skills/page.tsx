"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Loader2, Plus, Search, Sparkles } from "lucide-react";
import { useDebounce } from "use-debounce";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { useSkills } from "@/hooks/useSkills";
import {
  hasUnpublishedChanges,
  resolveReviewStatus,
  reviewStatusBadge,
} from "@/lib/reviewStatus";
import type { Skill } from "@/types/skill";

const visibilityColors: Record<string, string> = {
  private: "bg-muted text-foreground",
  dept: "bg-blue-100 text-blue-800",
  tenant: "bg-green-100 text-green-800",
  public: "bg-purple-100 text-purple-800",
};

export default function SkillsPage() {
  const router = useRouter();
  const t = useTranslations("skills");
  const tc = useTranslations("common");
  const { user, loading: userLoading } = useCurrentUser();

  const [search, setSearch] = useState("");
  const [debouncedSearch] = useDebounce(search, 300);
  const { skills, loading, deleteSkill } = useSkills(debouncedSearch || undefined);

  // 删除被引用时（409）弹引用应用清单
  const [referencedApps, setReferencedApps] = useState<any[] | null>(null);
  const [deletingSkill, setDeletingSkill] = useState<Skill | null>(null);

  const handleDelete = async (skill: Skill) => {
    if (!confirm(t("deleteConfirm", { name: skill.name }))) return;
    const result = await deleteSkill(skill.id);
    if (!result.ok && result.referencedBy) {
      setDeletingSkill(skill);
      setReferencedApps(result.referencedBy);
    }
  };

  // P5 开放自建：普通用户也可进入 Skill 列表创建自己的 Skill（可见范围由后端裁剪）
  if (userLoading || !user) {
    return <div className="flex items-center justify-center h-64">{tc("loading")}</div>;
  }

  return (
    <div className="container mx-auto p-6">
      <div className="flex justify-between items-center mb-6 gap-4">
        <div>
          <p className="text-muted-foreground">{t("pageDescription")}</p>
        </div>
        <div className="flex items-center gap-2">
          <div className="relative">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t("searchPlaceholder")}
              className="pl-8 w-56"
            />
          </div>
          <Button onClick={() => router.push("/skills/new")}>
            <Plus className="h-4 w-4 mr-2" />
            {t("createSkill")}
          </Button>
        </div>
      </div>

      <Card>
        <CardContent className="pt-6">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : skills.length === 0 ? (
            <div className="text-center py-12">
              <Sparkles className="mx-auto h-12 w-12 text-muted-foreground/50 mb-4" />
              <h3 className="text-lg font-medium mb-2">{t("noSkills")}</h3>
              <p className="text-muted-foreground mb-4">{t("noSkillsDesc")}</p>
              <Button onClick={() => router.push("/skills/new")}>{t("createSkill")}</Button>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("name")}</TableHead>
                  <TableHead>{t("displayName")}</TableHead>
                  <TableHead className="max-w-md">{t("description")}</TableHead>
                  <TableHead>{t("visibility")}</TableHead>
                  <TableHead>{tc("status")}</TableHead>
                  <TableHead className="text-right">{tc("actions")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {skills.map((skill) => {
                  const status = resolveReviewStatus(skill.status, skill.published_content);
                  const badge = reviewStatusBadge(status);
                  const unpublishedChanges = hasUnpublishedChanges(
                    skill.content,
                    skill.published_content
                  );
                  return (
                    <TableRow
                      key={skill.id}
                      className="cursor-pointer"
                      onClick={() => router.push(`/skills/${skill.id}`)}
                    >
                      <TableCell className="font-mono text-sm">{skill.name}</TableCell>
                      <TableCell className="font-medium">{skill.display_name}</TableCell>
                      <TableCell className="max-w-md">
                        <span className="line-clamp-2 text-sm text-muted-foreground">
                          {skill.description}
                        </span>
                      </TableCell>
                      <TableCell>
                        <Badge
                          className={`text-xs ${visibilityColors[skill.visibility] || visibilityColors.private}`}
                        >
                          {t(`visibility_${skill.visibility}`)}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-wrap gap-1">
                          <Badge variant={badge.variant} className={badge.className}>
                            {t(badge.labelKey)}
                          </Badge>
                          {unpublishedChanges && (
                            <Badge variant="outline" className="text-amber-600 border-amber-300">
                              {t("statusUnpublishedChanges")}
                            </Badge>
                          )}
                          {!skill.is_active && <Badge variant="destructive">{t("inactive")}</Badge>}
                        </div>
                      </TableCell>
                      <TableCell className="text-right" onClick={(e) => e.stopPropagation()}>
                        <div className="flex justify-end gap-2">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => router.push(`/skills/${skill.id}`)}
                          >
                            {tc("edit")}
                          </Button>
                          <Button
                            variant="destructive"
                            size="sm"
                            onClick={() => handleDelete(skill)}
                          >
                            {tc("delete")}
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* 删除冲突：被应用引用（409） */}
      <Dialog
        open={referencedApps !== null}
        onOpenChange={(open) => !open && setReferencedApps(null)}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="text-destructive">{t("cannotDelete")}</DialogTitle>
            <DialogDescription>
              {t("skillInUse", {
                name: deletingSkill?.name || "",
                count: referencedApps?.length || 0,
              })}
            </DialogDescription>
          </DialogHeader>
          <div className="max-h-60 overflow-y-auto space-y-2">
            {(referencedApps || []).map((app: any, index: number) => (
              <div key={app.id ?? index} className="p-3 bg-muted rounded-lg border text-sm">
                {app.name || app.app_name || String(app)}
              </div>
            ))}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setReferencedApps(null)}>
              {tc("close")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
