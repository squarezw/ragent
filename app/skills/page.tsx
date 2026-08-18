"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import SkillImportDialog from "./components/SkillImportDialog";
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
import { Loader2, Plus, Search, Sparkles, Upload } from "lucide-react";
import { useDebounce } from "use-debounce";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { useSkills } from "@/hooks/useSkills";
import {
  hasUnpublishedChanges,
  resolveReviewStatus,
  reviewStatusBadge,
} from "@/lib/reviewStatus";
import { canEditSkill } from "@/lib/skillPermissions";
import { checkSuperAdmin, checkTenantAdmin } from "@/lib/clientPermissions";
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
  const isSuperAdmin = checkSuperAdmin(user);
  const isTenantAdmin = checkTenantAdmin(user);

  const [search, setSearch] = useState("");
  const [debouncedSearch] = useDebounce(search, 300);
  const { skills, loading, deleteSkill } = useSkills(debouncedSearch || undefined);

  // 删除被引用时（409）弹引用应用清单
  const [referencedApps, setReferencedApps] = useState<any[] | null>(null);
  const [deletingSkill, setDeletingSkill] = useState<Skill | null>(null);
  const [importOpen, setImportOpen] = useState(false);

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
          {/* 导入放在新建左边：从别处搬一个现成 skill 进来，比从空白开始更常见 */}
          <Button variant="outline" onClick={() => setImportOpen(true)}>
            <Upload className="h-4 w-4 mr-2" />
            {t("importSkill")}
          </Button>
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
                  <TableHead className="whitespace-nowrap">{t("author")}</TableHead>
                  <TableHead className="whitespace-nowrap">{t("visibility")}</TableHead>
                  <TableHead className="whitespace-nowrap">{tc("status")}</TableHead>
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
                      <TableCell className="font-medium">
                        <div className="flex items-center gap-2">
                          {/* 不换行：加了徽标后这一格更窄，中文显示名会被压成一列一个字 */}
                          <span className="whitespace-nowrap">{skill.display_name}</span>
                          {/* 内置技能没有编辑/删除按钮，光藏起来用户不知道为什么。
                              徽标 + hover 说明，比一个凭空消失的按钮好懂。 */}
                          {skill.is_managed && (
                            <Badge
                              variant="outline"
                              className="text-xs shrink-0 font-normal"
                              title={t("managedHint")}
                            >
                              {t("managed")}
                            </Badge>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="max-w-md">
                        <span className="line-clamp-2 text-sm text-muted-foreground">
                          {skill.description}
                        </span>
                      </TableCell>
                      <TableCell className="text-sm">
                        {/* 作者账号注销后 author 为空：显示占位符而不是空白单元格，
                            空白会让人以为是渲染坏了 */}
                        {skill.author || <span className="text-muted-foreground">—</span>}
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
                          {/* 没有写权限的人不该看到「编辑」「删除」——原先两个按钮无条件渲染，
                              点下去才被后端 403 拦住。界面先说"你可以改"、动手后再说"不行"，
                              用户会以为是系统坏了而不是自己没权限。
                              但详情页他是能看的，所以按钮换成「查看」而不是整个消失。 */}
                          {canEditSkill(skill, user, isSuperAdmin, isTenantAdmin) ? (
                            <>
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
                            </>
                          ) : (
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => router.push(`/skills/${skill.id}`)}
                            >
                              {tc("view")}
                            </Button>
                          )}
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

      <SkillImportDialog open={importOpen} onOpenChange={setImportOpen} />
    </div>
  );
}
