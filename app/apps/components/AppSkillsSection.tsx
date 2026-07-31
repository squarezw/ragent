"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { Loader2, Plus, Search, Sparkles, Trash2 } from "lucide-react";
import { useAppSkills, normalizeAppSkill } from "@/hooks/useAppSkills";
import { useSkills } from "@/hooks/useSkills";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { checkSuperAdmin, checkTenantAdmin } from "@/lib/clientPermissions";
import type { AppSkill } from "@/types/skill";

/**
 * 应用详情页的 Skills 绑定区（照工具绑定区模式）：
 * 已绑列表（发布状态 / 解绑）+ 添加绑定（可见 skills 搜索多选）。
 * 列表顺序沿用后端返回的绑定顺序，前端不再排序。
 */
export default function AppSkillsSection({ appId }: { appId: number }) {
  const router = useRouter();
  const t = useTranslations("skills");
  const tc = useTranslations("common");
  const { user } = useCurrentUser();
  const canManage = checkSuperAdmin(user) || checkTenantAdmin(user);

  const { appSkills, loading, bindSkill, unbindSkill } = useAppSkills(appId);
  const [bindDialogOpen, setBindDialogOpen] = useState(false);
  const [unbindTarget, setUnbindTarget] = useState<AppSkill | null>(null);

  const handleUnbind = async () => {
    if (!unbindTarget) return;
    const { skillId } = normalizeAppSkill(unbindTarget);
    const ok = await unbindSkill(skillId);
    if (ok) setUnbindTarget(null);
  };

  const boundSkillIds = useMemo(
    () => new Set(appSkills.map((row) => normalizeAppSkill(row).skillId)),
    [appSkills]
  );

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2">
            <Sparkles className="h-5 w-5" />
            {t("boundSkills", { count: appSkills.length })}
          </CardTitle>
          {canManage && (
            <Button size="sm" onClick={() => setBindDialogOpen(true)}>
              <Plus className="h-4 w-4 mr-2" />
              {t("bindSkill")}
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : appSkills.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">{t("noSkillsBound")}</div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("name")}</TableHead>
                <TableHead>{t("description")}</TableHead>
                <TableHead>{tc("status")}</TableHead>
                {canManage && <TableHead className="text-right">{tc("actions")}</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {appSkills.map((row) => {
                const info = normalizeAppSkill(row);
                return (
                  <TableRow key={info.skillId}>
                    <TableCell>
                      <button
                        type="button"
                        className="font-medium hover:underline text-left"
                        onClick={() => router.push(`/skills/${info.skillId}`)}
                      >
                        {info.displayName || info.name}
                      </button>
                      <div className="font-mono text-xs text-muted-foreground">{info.name}</div>
                    </TableCell>
                    <TableCell className="max-w-md">
                      <span className="line-clamp-2 text-sm text-muted-foreground">
                        {info.description}
                      </span>
                    </TableCell>
                    <TableCell>
                      {info.isPublished ? (
                        <Badge>{t("statusPublished")}</Badge>
                      ) : (
                        <Badge variant="secondary">{t("statusDraftOnly")}</Badge>
                      )}
                    </TableCell>
                    {canManage && (
                      <TableCell className="text-right">
                        <Button variant="ghost" size="sm" onClick={() => setUnbindTarget(row)}>
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      </TableCell>
                    )}
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </CardContent>

      <BindSkillsDialog
        open={bindDialogOpen}
        onClose={() => setBindDialogOpen(false)}
        boundSkillIds={boundSkillIds}
        onBind={async (skillIds) => {
          for (const skillId of skillIds) {
            await bindSkill(skillId);
          }
          setBindDialogOpen(false);
        }}
      />

      <AlertDialog
        open={unbindTarget !== null}
        onOpenChange={(open) => !open && setUnbindTarget(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("confirmUnbind")}</AlertDialogTitle>
            <AlertDialogDescription>{t("unbindWarning")}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{tc("cancel")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleUnbind}
              className="bg-destructive text-destructive-foreground"
            >
              {t("unbind")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}

// 添加绑定对话框：可见 skills 搜索 + 多选
function BindSkillsDialog({
  open,
  onClose,
  boundSkillIds,
  onBind,
}: {
  open: boolean;
  onClose: () => void;
  boundSkillIds: Set<number>;
  onBind: (skillIds: number[]) => Promise<void>;
}) {
  const t = useTranslations("skills");
  const tc = useTranslations("common");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<number[]>([]);
  const [binding, setBinding] = useState(false);
  const { skills, loading } = useSkills();

  useEffect(() => {
    if (!open) {
      setSelected([]);
      setSearch("");
    }
  }, [open]);

  const available = useMemo(() => {
    const keyword = search.trim().toLowerCase();
    return skills
      .filter((skill) => !boundSkillIds.has(skill.id))
      .filter(
        (skill) =>
          !keyword ||
          skill.name.toLowerCase().includes(keyword) ||
          (skill.display_name || "").toLowerCase().includes(keyword) ||
          (skill.description || "").toLowerCase().includes(keyword)
      );
  }, [skills, boundSkillIds, search]);

  const toggle = (skillId: number) => {
    setSelected((prev) =>
      prev.includes(skillId) ? prev.filter((id) => id !== skillId) : [...prev, skillId]
    );
  };

  const handleBind = async () => {
    if (selected.length === 0) return;
    setBinding(true);
    await onBind(selected);
    setBinding(false);
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t("bindSkill")}</DialogTitle>
        </DialogHeader>

        <div className="relative">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t("searchPlaceholder")}
            className="pl-8"
          />
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : available.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">{t("noBindableSkills")}</div>
        ) : (
          <div className="space-y-2">
            {available.map((skill) => {
              const isPublished = skill.published_content !== null;
              return (
                <label
                  key={skill.id}
                  htmlFor={`bind-skill-${skill.id}`}
                  className="flex items-center space-x-3 p-3 border rounded-lg hover:bg-muted/50 cursor-pointer"
                >
                  <Checkbox
                    id={`bind-skill-${skill.id}`}
                    checked={selected.includes(skill.id)}
                    onCheckedChange={() => toggle(skill.id)}
                  />
                  <div className="flex-1 min-w-0">
                    <div className="font-medium">{skill.display_name || skill.name}</div>
                    <div className="text-sm text-muted-foreground line-clamp-1">
                      {skill.description}
                    </div>
                  </div>
                  {isPublished ? (
                    <Badge>{t("statusPublished")}</Badge>
                  ) : (
                    <Badge variant="secondary">{t("statusDraftOnly")}</Badge>
                  )}
                </label>
              );
            })}
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={binding}>
            {tc("cancel")}
          </Button>
          <Button onClick={handleBind} disabled={selected.length === 0 || binding}>
            {binding && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            {selected.length > 0 ? t("bindCount", { count: selected.length }) : t("bind")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
