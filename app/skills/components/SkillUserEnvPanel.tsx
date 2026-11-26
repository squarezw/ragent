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
  validateEnvRows,
} from "@/lib/skillUserEnv";
import { isSecretEnvKey } from "@/lib/skillUserEnv";
import { useSkillUserEnv } from "@/hooks/useSkillUserEnv";

import SkillSharedEnvPanel from "./SkillSharedEnvPanel";

interface SkillUserEnvPanelProps {
  accessScope: string | null;
  allowShared: boolean;
  skillId: number;
}

export default function SkillUserEnvPanel({ skillId, accessScope, allowShared }: SkillUserEnvPanelProps) {
  const t = useTranslations("skills");
  const tc = useTranslations("common");

  const { meta, metaLoading, env, declaredKeys, envLoading, envError, reloadEnv, saveEnv, shared, sharedUrl } = useSkillUserEnv(
    skillId,
    true,
    accessScope,
    allowShared
  );

  const [rows, setRows] = useState<EnvRow[]>([]);
  const [revealed, setRevealed] = useState<Set<string>>(new Set());
  // 聚焦过的行才可写，见输入框上的 readOnly——挡浏览器自动填充
  const [focused, setFocused] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);

  // 服务端现值到达（或保存后回填）时重建行；同时收起所有已明文显示的值
  useEffect(() => {
    setRows(buildEnvRows(declaredKeys, env));
    setRevealed(new Set());
    setFocused(new Set());
  }, [declaredKeys, env]);

  const validation = useMemo(() => validateEnvRows(rows), [rows]);
  const dirty = useMemo(() => hasEnvChanges(rows, env), [rows, env]);

  if (metaLoading || (!meta.configurable && !(allowShared && shared.data?.configured_keys.length))) return null;

  const organizationKeys = new Set(allowShared && shared.data?.use_organization ? shared.data.configured_keys : []);

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
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2">
          <KeyRound className="h-4 w-4" />
          {t("envSection")}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-5">
        {allowShared && shared.error && (
          <div role="alert" className="flex items-center gap-2 text-sm text-destructive">
            {t("sharedLoadFailed")}
            <Button type="button" size="sm" variant="outline" onClick={() => shared.mutate()}>{tc("refresh")}</Button>
          </div>
        )}
        {allowShared && shared.data && !shared.error && (
          <SkillSharedEnvPanel url={sharedUrl} config={shared.data}
            update={(data) => data ? shared.mutate(data, { revalidate: false }) : shared.mutate()} />
        )}
        {meta.configurable && (
          <fieldset className="min-w-0 space-y-3">
            <legend className="text-sm font-medium">{t("personalTitle")}</legend>
            {envError ? (
              <div role="alert" className="flex items-center gap-2 text-sm text-destructive">
                {t("personalLoadFailed")}
                <Button type="button" variant="outline" size="sm" onClick={reloadEnv}>{tc("refresh")}</Button>
              </div>
            ) : envLoading ? (
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
                  if (organizationKeys.has(row.key)) {
                    return (
                      <li key={row.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2">
                        <span className="break-all font-mono text-xs sm:w-56">{row.key}</span>
                        <Badge variant="secondary" className="font-normal">{t("sharedActive")}</Badge>
                      </li>
                    );
                  }
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
                            <label
                              htmlFor={`env-value-${row.id}`}
                              className="block font-mono text-xs break-all py-1.5 cursor-pointer"
                            >
                              {row.key}
                            </label>
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
                            // 反自动填充。`autoComplete="off"` 单独用不住：Chrome 看到
                            // 「文本框 + 密码框」相邻就按登录表单处理，把用户名/密码填进来
                            // ——实测把 `admin` 填进了 ChatGPT_BaseURL（2026-08-01）。
                            // 那是全部字段改成 password 型之前不会发生的，此刻不改就等着
                            // 有人连着 `admin` 一起点保存。
                            //   · `new-password`：告诉 Chrome 这不是"已保存的那个密码"
                            //   · name = 环境变量名：别让启发式把它当 username 字段
                            //   · data-*ignore：1Password / LastPass 的关闭开关
                            autoComplete="new-password"
                            name={`skill-env-${row.key || row.id}`}
                            data-1p-ignore
                            data-lpignore="true"
                            // 最后一道，且不依赖任何浏览器启发式：**没聚焦前是只读的**。
                            // Chrome 不会往只读输入框里填东西；点进去即解锁，打字与粘贴
                            // 都照常（本来也得先聚焦才能粘）。
                            readOnly={!focused.has(row.id)}
                            onFocus={() =>
                              setFocused((prev) => new Set(prev).add(row.id))
                            }
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

            {dirty && <p className="text-xs text-muted-foreground">{t("envReplaceNotice")}</p>}

            <div className="flex items-center justify-between gap-2 flex-wrap">
              <Button
                variant="outline"
                size="sm"
                disabled={Boolean(envError) || envLoading}
                onClick={() => setRows((prev) => [...prev, newEnvRow()])}
              >
                <Plus className="h-3.5 w-3.5 mr-1.5" />
                {t("envAddRow")}
              </Button>
              <div className="flex gap-2 ml-auto">
                {dirty && <Button
                  variant="ghost"
                  size="sm"
                  disabled={saving}
                  onClick={() => {
                    setRows(buildEnvRows(declaredKeys, env));
                    setRevealed(new Set());
                    // 一并重新上锁：取消后这些框又回到没被碰过的状态
                    setFocused(new Set());
                  }}
                >
                  {tc("cancel")}
                </Button>}
                <Button size="sm" disabled={saving || Boolean(envError) || envLoading || !validation.valid || !dirty} onClick={handleSave}>
                  {saving && <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />}
                  {t("envSave")}
                </Button>
              </div>
            </div>
          </fieldset>
        )}
      </CardContent>
    </Card>
  );
}
