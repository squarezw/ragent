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
import { Textarea } from "@/components/ui/textarea";
import { Loader2 } from "lucide-react";
import {
  buildExecConfigPayload,
  resolveImageSelection,
  sandboxImageValue,
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

  const [image, setImage] = useState("");
  const [timeout, setTimeoutSec] = useState(String(config?.timeout_sec ?? DEFAULT_TIMEOUT));
  const [needsNetwork, setNeedsNetwork] = useState(config?.needs_network ?? false);
  const [warmPool, setWarmPool] = useState(config?.warm_pool ?? false);
  // 一行一条 glob；空行忽略。用 textarea 而不是 tag 输入：写的是 glob 不是枚举，
  // 而且多数 skill 一条都不填
  const [artifactExclude, setArtifactExclude] = useState(
    (config?.artifact_exclude ?? []).join("\n")
  );

  const selection = useMemo(
    () => resolveImageSelection(config?.image, images),
    [config?.image, images]
  );

  // 配置或镜像清单异步到达后回填（digest 形态的 image 在此映射回可提交的 name:tag）
  useEffect(() => {
    setTimeoutSec(String(config?.timeout_sec ?? DEFAULT_TIMEOUT));
    setNeedsNetwork(config?.needs_network ?? false);
    setWarmPool(config?.warm_pool ?? false);
    setArtifactExclude((config?.artifact_exclude ?? []).join("\n"));
  }, [config]);

  useEffect(() => {
    setImage(selection.value);
  }, [selection.value]);

  const timeoutValue = Number(timeout);
  const timeoutInvalid = !Number.isInteger(timeoutValue) || timeoutValue < 1 || timeoutValue > 3600;
  const imageMissing = image.trim().length === 0;

  const useSelect = !imagesUnavailable && images.length > 0;
  // 已下架或已从白名单移除的镜像：下拉框里没有这一项，补一条避免 Select 显示空白
  const orphanImage = useSelect && image && !images.some((i) => sandboxImageValue(i) === image);

  const canSave = !saving && !timeoutInvalid && !imageMissing;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
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
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <ToggleRow
          id="exec-needs-network"
          label={t("execNeedsNetwork")}
          hint={t("execNeedsNetworkHint")}
          checked={needsNetwork}
          onChange={setNeedsNetwork}
        />
        <ToggleRow
          id="exec-warm-pool"
          label={t("execWarmPool")}
          hint={t("execWarmPoolHint")}
          checked={warmPool}
          onChange={setWarmPool}
        />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="exec-artifact-exclude">{t("execArtifactExclude")}</Label>
        <Textarea
          id="exec-artifact-exclude"
          rows={2}
          value={artifactExclude}
          onChange={(e) => setArtifactExclude(e.target.value)}
          placeholder="**/findings.json"
          className="font-mono text-xs"
        />
        <p className="text-xs text-muted-foreground">{t("execArtifactExcludeHelp")}</p>
      </div>

      <div className="flex justify-end">
        <Button
          disabled={!canSave}
          onClick={() =>
            onSave(
              buildExecConfigPayload(
                {
                  image: image.trim(),
                  timeout_sec: timeoutValue,
                  needs_network: needsNetwork,
                  warm_pool: warmPool,
                  artifact_exclude: artifactExclude
                    .split("\n")
                    .map((g) => g.trim())
                    .filter(Boolean),
                },
                // 可写目录不在表单里编辑，但要按 GET 现值透传回去——后端全量覆盖，
                // 漏传等于把 fund 的 .report_state 持久状态目录配置清空。
                config
              )
            )
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
