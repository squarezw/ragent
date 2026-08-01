"use client";

import { type ReactNode, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { FileCode2, Loader2, Settings2 } from "lucide-react";
import axios from "@/lib/axios";
import {
  diffExecConfig,
  formatBytes,
  parseSkillDiff,
  shortSha,
  summarizeAssetDiff,
  type ExecConfigField,
} from "@/lib/skillAssets";
import type { SkillAssetDiffItem, SkillDiff, SkillExecConfigSummary } from "@/types/review";
import TextDiffView from "./TextDiffView";

interface SkillDiffDialogProps {
  /** null = 关闭 */
  skillId: number | null;
  /** 对话框标题里的 skill 名称 */
  skillName?: string;
  onOpenChange: (open: boolean) => void;
}

const CHANGE_BADGE_CLASS: Record<string, string> = {
  added: "border-emerald-500/50 text-emerald-600 dark:text-emerald-400",
  removed: "border-red-500/50 text-red-600 dark:text-red-400",
  modified: "border-amber-500/50 text-amber-600 dark:text-amber-400",
  unchanged: "text-muted-foreground",
};

function AssetSizeCell({ item }: { item: SkillAssetDiffItem }) {
  if (item.change === "removed") {
    return <span className="line-through">{formatBytes(item.published_size)}</span>;
  }
  if (item.change === "modified" && item.published_size !== item.draft_size) {
    return (
      <span>
        <span className="text-muted-foreground">{formatBytes(item.published_size)}</span>
        {" → "}
        {formatBytes(item.draft_size)}
      </span>
    );
  }
  return <span>{formatBytes(item.draft_size)}</span>;
}

/** 文本型资产（后端给了 draft_text/published_text）可展开逐行对照；二进制只给指纹与大小 */
function AssetDiffRow({
  item,
  kindLabel,
  changeLabel,
}: {
  item: SkillAssetDiffItem;
  kindLabel: string;
  changeLabel: string;
}) {
  const t = useTranslations("skills");
  const [open, setOpen] = useState(false);
  const hasText = item.draft_text !== null || item.published_text !== null;
  const diffable = hasText && item.change !== "unchanged";
  const fingerprintChanged =
    item.change === "modified" && item.draft_sha256 !== item.published_sha256;

  return (
    <>
      <tr className="border-b last:border-0">
        <td className="font-mono px-3 py-1.5 break-all">
          {item.path}
          {!hasText && fingerprintChanged && (
            <span className="block font-sans text-[11px] text-muted-foreground">
              {t("diffAssetBinary")} ·{" "}
              {t("diffAssetFingerprint", {
                from: shortSha(item.published_sha256),
                to: shortSha(item.draft_sha256),
              })}
            </span>
          )}
          {diffable && (
            <button
              type="button"
              onClick={() => setOpen((prev) => !prev)}
              className="block font-sans text-[11px] text-primary hover:underline"
            >
              {open ? t("diffAssetTextHide") : t("diffAssetTextShow")}
            </button>
          )}
        </td>
        <td className="px-3 py-1.5">{kindLabel}</td>
        <td className="px-3 py-1.5 whitespace-nowrap">
          <AssetSizeCell item={item} />
        </td>
        <td className="px-3 py-1.5 text-right">
          <Badge variant="outline" className={CHANGE_BADGE_CLASS[item.change] ?? ""}>
            {changeLabel}
          </Badge>
        </td>
      </tr>
      {diffable && open && (
        <tr className="border-b last:border-0">
          <td colSpan={4} className="px-3 py-2 bg-muted/30">
            <TextDiffView
              left={item.published_text ?? ""}
              right={item.draft_text ?? ""}
              leftLabel={t("diffPublished")}
              rightLabel={t("diffDraft")}
              maxHeightClass="max-h-[30vh]"
            />
          </td>
        </tr>
      )}
    </>
  );
}

/** 单侧（draft 或 published）exec 配置摘要；changedFields 标注与另一侧的差异 */
function ExecConfigColumn({
  config,
  changedFields,
}: {
  config: SkillExecConfigSummary | null;
  changedFields: ExecConfigField[];
}) {
  const t = useTranslations("skills");

  if (!config) {
    return <p className="text-xs text-muted-foreground py-2">{t("execNone")}</p>;
  }

  const rows: Array<{ field: ExecConfigField; label: string; value: ReactNode }> = [
    {
      field: "image",
      label: t("execImage"),
      value: (
        <span className="inline-flex items-center gap-1.5 break-all">
          {config.image}
          {!config.image_enabled && (
            <Badge variant="outline" className={CHANGE_BADGE_CLASS.removed}>
              {t("execImageDisabled")}
            </Badge>
          )}
        </span>
      ),
    },
    {
      field: "timeout_sec",
      label: t("execTimeout"),
      value: t("execTimeoutValue", { seconds: config.timeout_sec }),
    },
    {
      field: "writable_subdirs",
      label: t("execWritableSubdirs"),
      value: config.writable_subdirs.length > 0 ? config.writable_subdirs.join(", ") : "-",
    },
    {
      field: "needs_network",
      label: t("execNeedsNetwork"),
      value: config.needs_network ? t("execEnabled") : t("execDisabled"),
    },
    {
      field: "warm_pool",
      label: t("execWarmPool"),
      value: config.warm_pool ? t("execEnabled") : t("execDisabled"),
    },
    {
      field: "artifact_exclude",
      label: t("execArtifactExclude"),
      value:
        config.artifact_exclude.length > 0 ? config.artifact_exclude.join(", ") : "-",
    },
  ];

  return (
    <dl className="text-xs space-y-1.5">
      {rows.map((row) => (
        <div key={row.field} className="flex gap-2">
          <dt className="w-20 shrink-0 text-muted-foreground">{row.label}</dt>
          <dd
            className={`font-mono min-w-0 ${
              changedFields.includes(row.field)
                ? "text-amber-600 dark:text-amber-400 font-medium"
                : ""
            }`}
          >
            {row.value}
          </dd>
        </div>
      ))}
    </dl>
  );
}

/**
 * 草稿 vs 已发布两栏对照（GET /api/v1/skills/{id}/diff）。
 * 行级 + 字符级 diff 由自研的 lib/textDiff 计算（无第三方 diff 依赖），渲染见 TextDiffView。
 * 左栏固定为旧版（已发布）、右栏为新版（草稿），与通用 diff 工具的红左绿右方位一致。
 * P8a：可执行 skill 追加资产清单对照（新增/删除/变更标注）+ exec 配置摘要。
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
        setDiff(parseSkillDiff(res.data));
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

  const assetKindLabel = (kind: string) => {
    switch (kind) {
      case "script":
        return t("assetKindScript");
      case "reference":
        return t("assetKindReference");
      case "asset":
        return t("assetKindAsset");
      case "data":
        return t("assetKindData");
      default:
        return kind;
    }
  };

  const changeLabel = (change: string) => {
    switch (change) {
      case "added":
        return t("assetChangeAdded");
      case "removed":
        return t("assetChangeRemoved");
      case "modified":
        return t("assetChangeModified");
      default:
        return t("assetChangeUnchanged");
    }
  };

  const summary = diff ? summarizeAssetDiff(diff.assets) : null;
  const hasExecConfig = Boolean(diff?.exec_config_draft || diff?.exec_config_published);
  const changedExecFields = diff
    ? diffExecConfig(diff.exec_config_draft, diff.exec_config_published)
    : [];

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
          <div className="space-y-4 max-h-[70vh] overflow-y-auto">
            <TextDiffView
              left={diff.published ?? ""}
              right={diff.draft}
              leftLabel={
                diff.published === null
                  ? `${t("diffPublished")} ${t("diffNotPublished")}`
                  : t("diffPublished")
              }
              rightLabel={t("diffDraft")}
            />

            {/* P8a：可执行资产清单（draft vs published 变更标注） */}
            {diff.assets.length > 0 && summary && (
              <div className="space-y-2">
                <p className="text-sm font-medium flex items-center gap-2">
                  <FileCode2 className="h-4 w-4" />
                  {t("assetsSection")}
                  <span className="text-xs text-muted-foreground font-normal">
                    {t("assetsSummary", {
                      count: summary.total,
                      size: formatBytes(summary.totalBytes),
                    })}
                  </span>
                </p>
                <div className="rounded-md border">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b bg-muted/50 text-muted-foreground">
                        <th className="text-left font-medium px-3 py-1.5">{t("assetPath")}</th>
                        <th className="text-left font-medium px-3 py-1.5">{t("assetKind")}</th>
                        <th className="text-left font-medium px-3 py-1.5">{t("assetSize")}</th>
                        <th className="text-right font-medium px-3 py-1.5">{t("assetChange")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {diff.assets.map((item) => (
                        <AssetDiffRow
                          key={`${item.change}-${item.path}`}
                          item={item}
                          kindLabel={assetKindLabel(item.kind)}
                          changeLabel={changeLabel(item.change)}
                        />
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* P8a：exec 配置摘要（镜像 / 超时 / 可写目录等），字段差异标黄 */}
            {hasExecConfig && (
              <div className="space-y-2">
                <p className="text-sm font-medium flex items-center gap-2">
                  <Settings2 className="h-4 w-4" />
                  {t("execConfigSection")}
                </p>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1 min-w-0 bg-muted rounded-md p-3">
                    <p className="text-xs font-medium">{t("diffDraft")}</p>
                    <ExecConfigColumn
                      config={diff.exec_config_draft}
                      changedFields={changedExecFields}
                    />
                  </div>
                  <div className="space-y-1 min-w-0 bg-muted rounded-md p-3">
                    <p className="text-xs font-medium">{t("diffPublished")}</p>
                    <ExecConfigColumn config={diff.exec_config_published} changedFields={[]} />
                  </div>
                </div>
              </div>
            )}
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
