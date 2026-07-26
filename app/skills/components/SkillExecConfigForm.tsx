"use client";

import { useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Loader2, Plus, X } from "lucide-react";
import {
  PATH_ERROR_MESSAGE_KEY,
  resolveImageSelection,
  sandboxImageValue,
  validateAssetPath,
  validateWritableSubdir,
} from "@/lib/skillAssets";
import type { SandboxImage, SkillExecConfig, SkillExecConfigPayload } from "@/types/skill";

interface SkillExecConfigFormProps {
  config: SkillExecConfig | null;
  images: SandboxImage[];
  /** 白名单端点不可用：镜像字段降级为手工输入 */
  imagesUnavailable: boolean;
  saving: boolean;
  onSave: (payload: SkillExecConfigPayload) => void;
}

const DEFAULT_TIMEOUT = 120;

export default function SkillExecConfigForm({
  config,
  images,
  imagesUnavailable,
  saving,
  onSave,
}: SkillExecConfigFormProps) {
  const t = useTranslations("skills");

  const [entrypoint, setEntrypoint] = useState(config?.entrypoint ?? "");
  const [image, setImage] = useState("");
  const [timeout, setTimeoutSec] = useState(String(config?.timeout_sec ?? DEFAULT_TIMEOUT));
  const [subdirs, setSubdirs] = useState<string[]>(config?.writable_subdirs ?? []);
  const [needsLlm, setNeedsLlm] = useState(config?.needs_llm ?? false);
  const [warmPool, setWarmPool] = useState(config?.warm_pool ?? false);
  const [newSubdir, setNewSubdir] = useState("");

  const selection = useMemo(
    () => resolveImageSelection(config?.image, images),
    [config?.image, images]
  );

  // 配置或镜像清单异步到达后回填（digest 形态的 image 在此映射回可提交的 name:tag）
  useEffect(() => {
    setEntrypoint(config?.entrypoint ?? "");
    setTimeoutSec(String(config?.timeout_sec ?? DEFAULT_TIMEOUT));
    setSubdirs(config?.writable_subdirs ?? []);
    setNeedsLlm(config?.needs_llm ?? false);
    setWarmPool(config?.warm_pool ?? false);
  }, [config]);

  useEffect(() => {
    setImage(selection.value);
  }, [selection.value]);

  const entrypointError = entrypoint.trim() ? validateAssetPath(entrypoint.trim()) : "empty";
  const timeoutValue = Number(timeout);
  const timeoutInvalid = !Number.isInteger(timeoutValue) || timeoutValue < 1 || timeoutValue > 3600;
  const imageMissing = image.trim().length === 0;
  const newSubdirError = newSubdir.trim() ? validateWritableSubdir(newSubdir) : null;

  const useSelect = !imagesUnavailable && images.length > 0;
  // 已下架或已从白名单移除的镜像：下拉框里没有这一项，补一条避免 Select 显示空白
  const orphanImage = useSelect && image && !images.some((i) => sandboxImageValue(i) === image);

  const canSave = !saving && !entrypointError && !timeoutInvalid && !imageMissing;

  const addSubdir = () => {
    const value = newSubdir.trim();
    if (!value || newSubdirError) return;
    if (!subdirs.includes(value)) setSubdirs([...subdirs, value]);
    setNewSubdir("");
  };

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <Label htmlFor="exec-entrypoint">{t("execEntrypoint")} *</Label>
          <Input
            id="exec-entrypoint"
            value={entrypoint}
            onChange={(e) => setEntrypoint(e.target.value)}
            placeholder="scripts/run.py"
            className={entrypoint && entrypointError ? "border-destructive" : ""}
          />
          <p
            className={`text-xs ${
              entrypoint && entrypointError ? "text-destructive" : "text-muted-foreground"
            }`}
          >
            {entrypoint && entrypointError
              ? t(PATH_ERROR_MESSAGE_KEY[entrypointError])
              : t("execEntrypointHint")}
          </p>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="exec-image">{t("execImage")} *</Label>
          {useSelect ? (
            <Select value={image} onValueChange={setImage}>
              <SelectTrigger id="exec-image">
                <SelectValue placeholder={t("execImagePlaceholder")} />
              </SelectTrigger>
              <SelectContent>
                {orphanImage && <SelectItem value={image}>{image}</SelectItem>}
                {images.map((img) => (
                  <SelectItem key={img.id} value={sandboxImageValue(img)}>
                    {sandboxImageValue(img)}
                    {img.digest ? ` · ${t("execImagePinned")}` : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : (
            <Input
              id="exec-image"
              value={image}
              onChange={(e) => setImage(e.target.value)}
              placeholder="ragent-skill-fund:latest"
            />
          )}
          <p className="text-xs text-muted-foreground">
            {useSelect
              ? selection.matched?.digest
                ? t("execImageDigestNote", { ref: selection.matched.ref })
                : t("execImageHint")
              : t("execImageManual")}
          </p>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="exec-timeout">{t("execTimeout")} *</Label>
          <Input
            id="exec-timeout"
            type="number"
            min={1}
            max={3600}
            value={timeout}
            onChange={(e) => setTimeoutSec(e.target.value)}
            className={timeoutInvalid ? "border-destructive" : ""}
          />
          <p className={`text-xs ${timeoutInvalid ? "text-destructive" : "text-muted-foreground"}`}>
            {t("execTimeoutHint")}
          </p>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="exec-subdir">{t("execWritableSubdirs")}</Label>
          <div className="flex gap-2">
            <Input
              id="exec-subdir"
              value={newSubdir}
              onChange={(e) => setNewSubdir(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  addSubdir();
                }
              }}
              placeholder=".report_state"
              className={newSubdirError ? "border-destructive" : ""}
            />
            <Button
              type="button"
              variant="outline"
              size="icon"
              onClick={addSubdir}
              disabled={!newSubdir.trim() || Boolean(newSubdirError)}
            >
              <Plus className="h-4 w-4" />
            </Button>
          </div>
          {subdirs.length > 0 && (
            <div className="flex flex-wrap gap-1.5 pt-1">
              {subdirs.map((dir) => (
                <span
                  key={dir}
                  className="inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-xs font-mono"
                >
                  {dir}
                  <button
                    type="button"
                    className="text-muted-foreground hover:text-destructive"
                    onClick={() => setSubdirs(subdirs.filter((d) => d !== dir))}
                    aria-label={t("execRemoveSubdir", { dir })}
                  >
                    <X className="h-3 w-3" />
                  </button>
                </span>
              ))}
            </div>
          )}
          <p className={`text-xs ${newSubdirError ? "text-destructive" : "text-muted-foreground"}`}>
            {newSubdirError
              ? t(PATH_ERROR_MESSAGE_KEY[newSubdirError])
              : t("execWritableSubdirsHint")}
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <ToggleRow
          id="exec-needs-llm"
          label={t("execNeedsLlm")}
          hint={t("execNeedsLlmHint")}
          checked={needsLlm}
          onChange={setNeedsLlm}
        />
        <ToggleRow
          id="exec-warm-pool"
          label={t("execWarmPool")}
          hint={t("execWarmPoolHint")}
          checked={warmPool}
          onChange={setWarmPool}
        />
      </div>

      <div className="flex justify-end">
        <Button
          disabled={!canSave}
          onClick={() =>
            onSave({
              entrypoint: entrypoint.trim(),
              image: image.trim(),
              timeout_sec: timeoutValue,
              writable_subdirs: subdirs,
              needs_llm: needsLlm,
              warm_pool: warmPool,
              llm_max_calls: config?.llm_max_calls ?? null,
              llm_max_total_tokens: config?.llm_max_total_tokens ?? null,
            })
          }
        >
          {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
          {t("execConfigSave")}
        </Button>
      </div>
    </div>
  );
}

function ToggleRow({
  id,
  label,
  hint,
  checked,
  onChange,
}: {
  id: string;
  label: string;
  hint: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-start justify-between gap-4 rounded-md border p-3">
      <div className="space-y-0.5 min-w-0">
        <Label htmlFor={id}>{label}</Label>
        <p className="text-xs text-muted-foreground">{hint}</p>
      </div>
      <Switch id={id} checked={checked} onCheckedChange={onChange} />
    </div>
  );
}
