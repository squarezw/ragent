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
  // 一行一个相对路径。同样用 textarea：写的是路径不是枚举，且多数 skill 不填。
  //
  // 这个字段此前**只能改库**——API 支持、diff 里会显示，却没有输入框。
  // 结果是全平台只有 1 个 skill 用了它（fund 的 .report_state），而那不是因为
  // 没人需要跨对话持久化，是因为没有入口。
  const [writableSubdirs, setWritableSubdirs] = useState(
    (config?.writable_subdirs ?? []).join("\n")
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
    setWritableSubdirs((config?.writable_subdirs ?? []).join("\n"));
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

  // 选中的镜像本机没有 —— 只提示不拦截（同上：先配置后构建是合理流程）。
  // present 为 null 时不提示：那说明 docker 不可达，判不出来，不是"不存在"。
  const selectedMissing =
    useSelect && images.some((i) => sandboxImageValue(i) === image && i.present === false);

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
                    {/* 标注而**不禁用**：镜像完全可能是先配置、后构建，禁用会挡住
                        这条合理路径。这里的目的是让"选了会跑不起来"在选之前就看得见，
                        而不是替用户决定不许选。present 为 null（docker 不可达）时
                        什么都不标——那时所有镜像都判不出来，逐个标"不存在"是误导。 */}
                    {img.present === false ? (
                      <span className="ml-1.5 text-xs text-amber-600">· 本机无此镜像</span>
                    ) : null}
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
          {selectedMissing && (
            <p className="text-xs text-amber-600">
              该镜像已登记但本机不存在，保存后运行会失败（exit 125）。
              平台的 skill 运行镜像多为本地构建、未推送 registry，docker 会报
              「pull access denied」——那不是权限问题。请重新构建该镜像，或改选一个本机已有的。
            </p>
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

      {/* 两个都是「一行一条」的列表字段，并排放：它们的形态一样，
          而且一个管「什么不给用户看」、一个管「什么跨执行留下来」，
          放在一起比隔开更容易一起想清楚。 */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
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

        <div className="space-y-1.5">
          <Label htmlFor="exec-writable-subdirs">{t("execWritableSubdirs")}</Label>
          <Textarea
            id="exec-writable-subdirs"
            rows={2}
            value={writableSubdirs}
            onChange={(e) => setWritableSubdirs(e.target.value)}
            placeholder=".lark"
            className="font-mono text-xs"
          />
          <p className="text-xs text-muted-foreground">{t("execWritableSubdirsHelp")}</p>
        </div>
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
                  writable_subdirs: writableSubdirs
                    .split("\n")
                    .map((d) => d.trim().replace(/^\/+|\/+$/g, ""))
                    .filter(Boolean),
                },
                // 仍然传 config：两个列表字段现在都可编辑，但 buildExecConfigPayload
                // 里的兜底还在——它保护的是「表单没渲染出这个字段」的情形（比如
                // GET 失败、config 为 null），那时不该把已有配置清空。
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
