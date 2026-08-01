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
import { isSecretEnvKey } from "@/lib/skillUserEnv";
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
 * 2. **凭据类的值用 password 型输入框，且任何值都绝不写进 console / 埋点 / toast**。
 *    哪些算凭据看 `isSecretEnvKey`（按键名判：key/secret/token/cookie…）。
 *    BaseURL / Deployment / Providers 这类明文显示：遮住它们没有安全收益，
 *    只让人看不清自己填了什么——2026-08-01 那次「值整体错了一行」就更难被发现。
 *    保存失败只展示后端 detail（中文校验信息）。
 * 3. 「仅属主」是硬约束：这里只显示当前登录用户自己的那份，没有也不要加
 *    「查看别人的值」的入口——管理员想排查只能看 meta 的键名与计数。
 * 4. **键名与输入框必须视觉上绑成一体**。2026-07-31 出过一次：用户把 BaseURL /
 *    ApiKey / Deployment 三个值整体填低了一行，存进库的是隔壁键（提交的是
 *    key→value 字典，链路上不可能平移，所以只能是填的时候看错行）。当时键名在
 *    左边 w-56 列、输入框在很远的右边，而「尚未配置」提示挂在输入框下面、横插在
 *    本行输入框与下一行键名之间——视觉上就读成"键名属于下面那个框"。
 *    现在：label htmlFor 真绑定 + 提示移到键名下方 + focus-within 整行高亮。
 *    这三条别退回去。
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
                <li
                  key={row.id}
                  // 点进输入框时整行（含键名）高亮——填错行这个 bug 就是靠它当场看见
                  className="px-3 py-2 space-y-1 transition-colors focus-within:bg-muted/60"
                >
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-3">
                    <div className="min-w-0 sm:w-56 sm:shrink-0">
                      {row.declared ? (
                        // 模板声明的键名不给改：改了就不再是这个 skill 会读的那个变量。
                        // htmlFor 真绑到本行输入框：点键名即聚焦对应框，读屏也念得对。
                        <>
                          <label
                            htmlFor={`env-value-${row.id}`}
                            className="block font-mono text-xs break-all py-1.5 cursor-pointer"
                          >
                            {row.key}
                          </label>
                          {row.value === "" && (
                            // 提示跟着键名走。挂在输入框下面时它横在本行与下一行之间，
                            // 把"键名—输入框"这对关系在视觉上拆散了。
                            <p className="text-xs text-muted-foreground -mt-1">
                              {t("envDeclaredUnset")}
                            </p>
                          )}
                        </>
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
                        id={`env-value-${row.id}`}
                        // 只有像凭据的键（ApiKey / token / cookie…）默认打码；
                        // BaseURL、Deployment、Providers 这类直接明文——把模型名
                        // 遮成一排圆点没有安全收益，只是让人看不清自己填了什么。
                        // 眼睛按钮对所有行都在，随时可反向切换。
                        type={
                          isSecretEnvKey(row.key) && !revealed.has(row.id)
                            ? "password"
                            : "text"
                        }
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
