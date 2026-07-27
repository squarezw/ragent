"use client";

import { useMemo } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { AlertTriangle, CheckCircle2 } from "lucide-react";
import { useAppSkillDiagnostics } from "@/hooks/useAppSkillDiagnostics";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { checkSuperAdmin } from "@/lib/clientPermissions";
import { buildGapGroups, type RenderableGap } from "@/lib/skillRequires";
import type { AppSkillDiagnosticItem } from "@/types/skill";

/**
 * 应用详情页「Skill 生效状态」：requires 门控原先是运行时静默跳过，
 * 界面零反馈。这里把每个未生效 skill 的缺口摊开，并按缺口类型给不同修复入口。
 */
export default function AppSkillDiagnostics({
  appId,
  onBindTools,
}: {
  appId: number;
  /** 打开该应用的工具绑定对话框；不传则「去绑定」入口不显示 */
  onBindTools?: () => void;
}) {
  const t = useTranslations("skills");
  const { summary, loading } = useAppSkillDiagnostics(appId);
  const { user } = useCurrentUser();
  const isSuperAdmin = checkSuperAdmin(user);

  if (loading || summary.tone === "empty") return null;

  // 全部生效时不制造噪音：一行低调的确认，不给卡片
  if (summary.tone === "quiet") {
    return (
      <p className="flex items-center gap-1.5 px-1 text-xs text-muted-foreground">
        <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-emerald-600" aria-hidden="true" />
        {t("diagnosticsAllEffective", { count: summary.effectiveCount })}
      </p>
    );
  }

  return (
    <Card className="border-amber-300 dark:border-amber-800">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <AlertTriangle
            className="h-5 w-5 shrink-0 text-amber-600 dark:text-amber-400"
            aria-hidden="true"
          />
          {t("diagnosticsTitle")}
        </CardTitle>
        <p className="text-sm text-amber-800 dark:text-amber-300">
          {t("diagnosticsSummary", {
            effective: summary.effectiveCount,
            blocked: summary.blockedCount,
          })}
        </p>
        <p className="text-xs text-muted-foreground">{t("diagnosticsBlockedHint")}</p>
      </CardHeader>
      <CardContent className="space-y-4">
        {summary.blocked.map((item) => (
          <BlockedSkill
            key={item.skill_id}
            item={item}
            isSuperAdmin={isSuperAdmin}
            onBindTools={onBindTools}
          />
        ))}
      </CardContent>
    </Card>
  );
}

function BlockedSkill({
  item,
  isSuperAdmin,
  onBindTools,
}: {
  item: AppSkillDiagnosticItem;
  isSuperAdmin: boolean;
  onBindTools?: () => void;
}) {
  const t = useTranslations("skills");
  const groups = useMemo(
    () => buildGapGroups(item.missing, { isSuperAdmin }),
    [item.missing, isSuperAdmin]
  );

  return (
    <section className="rounded-md border p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium break-all">{item.display_name || item.skill_name}</span>
        <span className="font-mono text-xs text-muted-foreground break-all">{item.skill_name}</span>
        <Badge
          variant="outline"
          className="ml-auto border-amber-300 text-amber-700 dark:text-amber-400"
        >
          {t("diagnosticsNotEffective")}
        </Badge>
      </div>

      {item.reason && (
        <p className="mt-1 text-xs text-muted-foreground">
          {item.reason === "missing_workflows"
            ? t("diagnosticsReasonWorkflows")
            : t("diagnosticsReasonTools")}
        </p>
      )}

      {groups.map((group) => (
        <div key={group.kind} className="mt-3">
          <p className="text-xs font-medium text-muted-foreground">
            {group.kind === "workflow"
              ? t("diagnosticsMissingWorkflows")
              : t("diagnosticsMissingTools")}
          </p>
          <ul className="mt-1.5 space-y-2">
            {group.gaps.map((gap) => (
              <GapRow
                key={`${gap.kind}:${gap.name}`}
                gap={gap}
                skillId={item.skill_id}
                onBindTools={onBindTools}
              />
            ))}
          </ul>
        </div>
      ))}
    </section>
  );
}

function GapRow({
  gap,
  skillId,
  onBindTools,
}: {
  gap: RenderableGap;
  skillId: number;
  onBindTools?: () => void;
}) {
  const t = useTranslations("skills");
  const ta = useTranslations("apps");
  const router = useRouter();
  const { action } = gap.guidance;

  return (
    <li className="rounded-md bg-muted/40 p-2.5">
      <div className="flex flex-wrap items-center gap-2">
        <code className="font-mono text-xs break-all">{gap.name}</code>
        {gap.tool_type && gap.tool_type !== "workflow" && (
          <Badge variant="secondary" className="text-xs">
            {gap.tool_type === "mcp" ? ta("mcpTool") : ta("nativeTool")}
          </Badge>
        )}
      </div>
      <p className="mt-1 text-sm">{t(gap.guidance.messageKey)}</p>
      {action === "edit-skill" && (
        <Button
          variant="link"
          size="sm"
          className="h-auto p-0 text-sm"
          onClick={() => router.push(`/skills/${skillId}`)}
        >
          {t("gapActionEditSkill")}
        </Button>
      )}
      {action === "manage-tools" && (
        <Button
          variant="link"
          size="sm"
          className="h-auto p-0 text-sm"
          onClick={() => router.push("/tools")}
        >
          {t("gapActionManageTools")}
        </Button>
      )}
      {action === "bind-tools" && onBindTools && (
        <Button variant="link" size="sm" className="h-auto p-0 text-sm" onClick={onBindTools}>
          {ta("bindTools")}
        </Button>
      )}
    </li>
  );
}
