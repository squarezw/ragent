"use client";

import { useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Eye, EyeOff, KeyRound, Loader2, Plus, X } from "lucide-react";
import {
  ENV_KEY_ERROR_MESSAGE_KEY,
  ENV_VALUE_ERROR_MESSAGE_KEY,
  type EnvRow,
  buildEnvPayload,
  buildEnvRows,
  hasEnvChanges,
  newEnvRow,
  summarizeEnvConfig,
  validateEnvRows,
} from "@/lib/skillUserEnv";
import { useSkillUserEnv } from "@/hooks/useSkillUserEnv";

interface SkillUserEnvPanelProps {
  skillId: number;
  /** 这个 skill 的展示名，用在「这份配置只属于你」的说明里 */
  skillDisplayName: string;
}

/**
 * 个人环境变量面板（迁移 041）。
 *
 * 三条硬约束，改这个组件前先读一遍：
 * 1. `meta.configurable === false` 时整块不渲染——没有 `.env.example` /
 *    `.env.template` 模板资产的 skill 不该出现这个入口。
 * 2. **值一律用 password 型输入框，且绝不写进 console / 埋点 / toast**。
 *    保存失败只展示后端 detail（中文校验信息）。
 * 3. 「仅属主」是硬约束：这里只显示当前登录用户自己的那份，没有也不要加
 *    「查看别人的值」的入口——管理员想排查只能看 meta 的键名与计数。
 */
export default function SkillUserEnvPanel({ skillId, skillDisplayName }: SkillUserEnvPanelProps) {
  const t = useTranslations("skills");
  const tc = useTranslations("common");

  const { meta, metaLoading, env, declaredKeys, envLoading, saveEnv } = useSkillUserEnv(
    skillId,
    true
  );

  const [rows, setRows] = useState<EnvRow[]>([]);
  const [revealed, setRevealed] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);

  // 服务端现值到达（或保存后回填）时重建行；同时收起所有已明文显示的值
  useEffect(() => {
    setRows(buildEnvRows(declaredKeys, env));
    setRevealed(new Set());
  }, [declaredKeys, env]);

  const validation = useMemo(() => validateEnvRows(rows), [rows]);
  const dirty = useMemo(() => hasEnvChanges(rows, env), [rows, env]);
  const summary = useMemo(() => summarizeEnvConfig(meta), [meta]);

  if (metaLoading || !meta.configurable) return null;

  const patchRow = (id: string, patch: Partial<EnvRow>) => {
    setRows((prev) => prev.map((row) => (row.id === id ? { ...row, ...patch } : row)));
  };

  const toggleReveal = (id: string) => {
    setRevealed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleSave = async () => {
    setSaving(true);
    const result = await saveEnv(buildEnvPayload(rows));
    setSaving(false);
    if (result.ok) toast.success(t("envSaved"));
    else toast.error(result.detail || t("envSaveFailed"));
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <CardTitle className="flex items-center gap-2">
              <KeyRound className="h-4 w-4" />
              {t("envSection")}
            </CardTitle>
            <p className="text-sm text-muted-foreground mt-1">
              {t("envDesc", { name: skillDisplayName })}
            </p>
          </div>
          {summary.declaredCount > 0 && (
            <Badge variant="outline" className="shrink-0 font-normal">
              {t("envConfiguredCount", {
                configured: summary.configuredCount,
                declared: summary.declaredCount,
              })}
            </Badge>
          )}
        </div>
      </CardHeader>

      <CardContent className="space-y-3">
        <p className="text-xs rounded-md border border-amber-500/50 text-amber-600 dark:text-amber-400 px-3 py-2">
          {t("envPrivacyNotice")}
        </p>

        {meta.template_path && (
          <p className="text-xs text-muted-foreground">
            {t("envTemplateSource", {
              path: meta.template_path,
              stage:
                meta.template_stage === "published"
                  ? t("envTemplateStagePublished")
                  : t("envTemplateStageDraft"),
            })}
          </p>
        )}

        {envLoading ? (
          <div className="flex justify-center py-6">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <ul className="rounded-md border divide-y">
            {rows.length === 0 && (
              <li className="px-3 py-4 text-sm text-muted-foreground text-center">
                {t("envEmpty")}
              </li>
            )}
            {rows.map((row) => {
              const keyError = validation.keyErrors[row.id];
              const valueError = validation.valueErrors[row.id];
              return (
                <li key={row.id} className="px-3 py-2 space-y-1">
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-3">
                    <div className="min-w-0 sm:w-56 sm:shrink-0">
                      {row.declared ? (
                        // 模板声明的键名不给改：改了就不再是这个 skill 会读的那个变量
                        <p className="font-mono text-xs break-all py-1.5">{row.key}</p>
                      ) : (
                        <Input
                          value={row.key}
                          onChange={(e) => patchRow(row.id, { key: e.target.value })}
                          placeholder={t("envKeyPlaceholder")}
                          className={`h-8 text-xs font-mono ${
                            keyError ? "border-destructive" : ""
                          }`}
                          aria-label={t("envKeyLabel")}
                        />
                      )}
                    </div>
                    <div className="min-w-0 sm:flex-1 flex items-center gap-1">
                      <Input
                        // 值一律 password 型；点眼睛才临时明文（浏览器不该记住凭据）
                        type={revealed.has(row.id) ? "text" : "password"}
                        autoComplete="off"
                        value={row.value}
                        onChange={(e) => patchRow(row.id, { value: e.target.value })}
                        placeholder={t("envValuePlaceholder")}
                        className={`h-8 text-xs font-mono ${
                          valueError ? "border-destructive" : ""
                        }`}
                        aria-label={t("envValueLabel")}
                      />
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 shrink-0 text-muted-foreground"
                        onClick={() => toggleReveal(row.id)}
                        aria-label={revealed.has(row.id) ? t("envHideValue") : t("envShowValue")}
                      >
                        {revealed.has(row.id) ? (
                          <EyeOff className="h-3.5 w-3.5" />
                        ) : (
                          <Eye className="h-3.5 w-3.5" />
                        )}
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 shrink-0 text-muted-foreground hover:text-destructive"
                        onClick={() => setRows((prev) => prev.filter((item) => item.id !== row.id))}
                        aria-label={t("envRemoveRow")}
                      >
                        <X className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>
                  {keyError && (
                    <p className="text-xs text-destructive break-words">
                      {t(ENV_KEY_ERROR_MESSAGE_KEY[keyError])}
                    </p>
                  )}
                  {valueError && (
                    <p className="text-xs text-destructive break-words">
                      {t(ENV_VALUE_ERROR_MESSAGE_KEY[valueError])}
                    </p>
                  )}
                  {row.declared && row.value === "" && (
                    <p className="text-xs text-muted-foreground">{t("envDeclaredUnset")}</p>
                  )}
                </li>
              );
            })}
          </ul>
        )}

        {validation.formError && (
          <p className="text-xs text-destructive">
            {validation.formError === "tooManyKeys"
              ? t("envErrorTooManyKeys")
              : t("envErrorTooLarge")}
          </p>
        )}

        <p className="text-xs text-muted-foreground">{t("envReplaceNotice")}</p>

        <div className="flex items-center justify-between gap-2 flex-wrap">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setRows((prev) => [...prev, newEnvRow()])}
          >
            <Plus className="h-3.5 w-3.5 mr-1.5" />
            {t("envAddRow")}
          </Button>
          <div className="flex gap-2 ml-auto">
            <Button
              variant="ghost"
              size="sm"
              disabled={saving || !dirty}
              onClick={() => {
                setRows(buildEnvRows(declaredKeys, env));
                setRevealed(new Set());
              }}
            >
              {tc("cancel")}
            </Button>
            <Button size="sm" disabled={saving || !validation.valid || !dirty} onClick={handleSave}>
              {saving && <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />}
              {t("envSave")}
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
