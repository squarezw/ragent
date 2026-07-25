"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { CheckCircle2, ClipboardCheck, History, Loader2, Smartphone, Sparkles } from "lucide-react";
import ReviewLogDialog from "@/components/ReviewLogDialog";
import ReviewRejectDialog from "@/components/ReviewRejectDialog";
import SkillDiffDialog from "@/app/skills/components/SkillDiffDialog";
import { usePendingReviews } from "@/hooks/useReviews";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { checkSuperAdmin, checkTenantAdmin } from "@/lib/clientPermissions";
import { isSelfReview } from "@/lib/reviewQueue";
import type { PendingReviewApp, PendingReviewSkill } from "@/types/review";

/** 驳回弹窗当前指向的对象 */
interface RejectTarget {
  kind: "skills" | "apps";
  id: number;
  name: string;
}

/** 审核记录弹窗当前指向的对象 */
interface LogTarget {
  kind: "skills" | "apps";
  id: number;
  name: string;
}

export default function ReviewsPage() {
  const router = useRouter();
  const t = useTranslations("reviews");
  const tc = useTranslations("common");
  const { user, loading: userLoading } = useCurrentUser();

  const isSuper = checkSuperAdmin(user);
  const canReview = isSuper || checkTenantAdmin(user);
  const { pending, loading, review } = usePendingReviews(canReview);

  const [rejectTarget, setRejectTarget] = useState<RejectTarget | null>(null);
  const [logTarget, setLogTarget] = useState<LogTarget | null>(null);
  const [diffSkill, setDiffSkill] = useState<PendingReviewSkill | null>(null);
  // 行内通过按钮的进行中标记（kind-id）
  const [approvingKey, setApprovingKey] = useState<string | null>(null);

  const handleApprove = async (kind: "skills" | "apps", id: number) => {
    const key = `${kind}-${id}`;
    setApprovingKey(key);
    await review(kind, id, { approve: true });
    setApprovingKey(null);
  };

  const formatDate = (dateStr?: string) => {
    if (!dateStr) return "-";
    const date = new Date(dateStr);
    return Number.isNaN(date.getTime()) ? dateStr : date.toLocaleString();
  };

  if (userLoading || !user) {
    return <div className="flex items-center justify-center h-64">{tc("loading")}</div>;
  }

  if (!canReview) {
    return <div className="flex items-center justify-center h-64">{t("noPermission")}</div>;
  }

  const renderActions = (
    kind: "skills" | "apps",
    id: number,
    name: string,
    submitterId?: number | null
  ) => {
    // 审核人不能审自己提交的对象（超管除外，后端违者 403）
    const selfReview = isSelfReview(user?.id, submitterId, isSuper);
    return (
      <div className="flex items-center justify-end gap-2">
        <Button
          variant="ghost"
          size="sm"
          title={t("reviewLogTooltip")}
          aria-label={t("reviewLogTooltip")}
          onClick={() => setLogTarget({ kind, id, name })}
        >
          <History className="h-4 w-4" />
        </Button>
        {kind === "skills" ? (
          <Button
            variant="outline"
            size="sm"
            onClick={() => setDiffSkill(pending.skills.find((s) => s.id === id) || null)}
          >
            {t("viewDiff")}
          </Button>
        ) : (
          <Button variant="outline" size="sm" onClick={() => router.push(`/apps/${id}`)}>
            {t("viewDetail")}
          </Button>
        )}
        {selfReview ? (
          <span className="text-xs text-muted-foreground">{t("selfReviewHint")}</span>
        ) : (
          <>
            <Button
              size="sm"
              onClick={() => handleApprove(kind, id)}
              disabled={approvingKey === `${kind}-${id}`}
            >
              {approvingKey === `${kind}-${id}` ? (
                <Loader2 className="h-4 w-4 mr-1 animate-spin" />
              ) : (
                <CheckCircle2 className="h-4 w-4 mr-1" />
              )}
              {t("approve")}
            </Button>
            <Button
              variant="destructive"
              size="sm"
              onClick={() => setRejectTarget({ kind, id, name })}
            >
              {t("reject")}
            </Button>
          </>
        )}
      </div>
    );
  };

  return (
    <div className="container mx-auto p-6 space-y-6">
      <div className="flex items-center gap-3">
        <ClipboardCheck className="h-6 w-6 text-muted-foreground" />
        <div>
          <h1 className="text-2xl font-bold">{t("title")}</h1>
          <p className="text-sm text-muted-foreground">{t("pageDescription")}</p>
        </div>
        <Badge variant="secondary" className="ml-2">
          {t("pendingCount", { count: pending.total })}
        </Badge>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <>
          {/* Skills 待审 */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-lg">
                <Sparkles className="h-5 w-5" />
                {t("skillsSection", { count: pending.skills.length })}
              </CardTitle>
            </CardHeader>
            <CardContent>
              {pending.skills.length === 0 ? (
                <p className="text-sm text-muted-foreground py-4">{t("noPendingSkills")}</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t("name")}</TableHead>
                      <TableHead>{t("displayName")}</TableHead>
                      <TableHead>{t("submitter")}</TableHead>
                      <TableHead>{t("submittedAt")}</TableHead>
                      <TableHead className="text-right">{tc("actions")}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {pending.skills.map((skill: PendingReviewSkill) => (
                      <TableRow key={skill.id}>
                        <TableCell className="font-mono text-sm">{skill.name}</TableCell>
                        <TableCell>{skill.display_name || "-"}</TableCell>
                        <TableCell>{skill.submitter || "-"}</TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          {formatDate(skill.submitted_at)}
                        </TableCell>
                        <TableCell className="text-right">
                          {renderActions("skills", skill.id, skill.name, skill.user_id)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>

          {/* Apps 待审 */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-lg">
                <Smartphone className="h-5 w-5" />
                {t("appsSection", { count: pending.apps.length })}
              </CardTitle>
            </CardHeader>
            <CardContent>
              {pending.apps.length === 0 ? (
                <p className="text-sm text-muted-foreground py-4">{t("noPendingApps")}</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t("name")}</TableHead>
                      <TableHead>{t("submitter")}</TableHead>
                      <TableHead>{t("submittedAt")}</TableHead>
                      <TableHead className="text-right">{tc("actions")}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {pending.apps.map((app: PendingReviewApp) => (
                      <TableRow key={app.id}>
                        <TableCell className="font-medium">{app.name}</TableCell>
                        <TableCell>{app.submitter || "-"}</TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          {formatDate(app.submitted_at)}
                        </TableCell>
                        <TableCell className="text-right">
                          {renderActions("apps", app.id, app.name, app.user_id)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </>
      )}

      {/* 驳回（理由必填） */}
      <ReviewRejectDialog
        open={rejectTarget !== null}
        onOpenChange={(open) => !open && setRejectTarget(null)}
        targetName={rejectTarget?.name || ""}
        onConfirm={async (comment) => {
          if (!rejectTarget) return false;
          return review(rejectTarget.kind, rejectTarget.id, { approve: false, comment });
        }}
      />

      {/* Skill 草稿 vs 已发布对照 */}
      <SkillDiffDialog
        skillId={diffSkill?.id ?? null}
        skillName={diffSkill?.name}
        onOpenChange={(open) => !open && setDiffSkill(null)}
      />

      {/* 审核记录（含驳回理由）弹窗 */}
      <ReviewLogDialog
        targetType={logTarget?.kind === "apps" ? "app" : "skill"}
        targetId={logTarget?.id ?? null}
        targetName={logTarget?.name}
        onOpenChange={(open) => !open && setLogTarget(null)}
      />
    </div>
  );
}
