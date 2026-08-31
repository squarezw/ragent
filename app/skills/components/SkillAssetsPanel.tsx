"use client";

import { type DragEvent, useEffect, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import axios from "@/lib/axios";
import { toast } from "sonner";
import SkillAssetPreviewDialog from "./SkillAssetPreviewDialog";
import { planExecCancel } from "@/lib/skillAssets";
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
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  BookOpen,
  Download,
  Eye,
  FileCode2,
  Loader2,
  Package,
  Replace,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import {
  ASSET_KINDS,
  ASSET_MAX_FILE_BYTES,
  ASSET_MAX_TOTAL_BYTES,
  PATH_ERROR_MESSAGE_KEY,
  assetKindWarning,
  formatBytes,
  groupAssetsByDir,
  isModelReadableAsset,
  isPreviewableAsset,
  planUploads,
  shortSha,
  willRevertToDraft,
  partitionStagedUploads,
  splitSkillMd,
  stripRedundantRoot,
} from "@/lib/skillAssets";
import { useSkillAssets } from "@/hooks/useSkillAssets";
import type { Skill, SkillAssetItem, SkillAssetKind, SkillExecConfigPayload } from "@/types/skill";
import SkillExecConfigForm from "./SkillExecConfigForm";

interface SkillAssetsPanelProps {
  skill: Skill;
  /** 无编辑权时整块不渲染（后端也会 403） */
  canEdit: boolean;
  /** 资产/配置变更后刷新 skill（状态可能被打回 draft） */
  onSkillChanged: () => void;
}

interface StagedFile {
  id: string;
  file: File;
  path: string;
  kind?: SkillAssetKind;
}

/** 拖入的目录用 entry API 递归展开；拿不到 entry（部分浏览器）时退回平铺文件名 */
async function collectDroppedFiles(dataTransfer: DataTransfer): Promise<StagedFile[]> {
  const entries: FileSystemEntry[] = [];
  for (const item of Array.from(dataTransfer.items || [])) {
    const entry = item.webkitGetAsEntry?.();
    if (entry) entries.push(entry);
  }
  if (entries.length === 0) {
    return Array.from(dataTransfer.files || []).map((file) => toStaged(file));
  }
  const collected: StagedFile[] = [];
  const walk = async (entry: FileSystemEntry, prefix: string): Promise<void> => {
    if (entry.isFile) {
      const file = await new Promise<File | null>((resolve) =>
        (entry as FileSystemFileEntry).file(resolve, () => resolve(null))
      );
      if (file) collected.push(toStaged(file, `${prefix}${file.name}`));
      return;
    }
    const reader = (entry as FileSystemDirectoryEntry).createReader();
    // readEntries 单次最多返回 100 条，必须读到空数组为止
    for (;;) {
      const batch = await new Promise<FileSystemEntry[]>((resolve) =>
        reader.readEntries(resolve, () => resolve([]))
      );
      if (batch.length === 0) break;
      for (const child of batch) await walk(child, `${prefix}${entry.name}/`);
    }
  };
  for (const entry of entries) await walk(entry, "");
  return collected;
}

let stagedSeq = 0;
function toStaged(file: File, path?: string): StagedFile {
  stagedSeq += 1;
  const relative = (file as File & { webkitRelativePath?: string }).webkitRelativePath;
  return { id: `staged-${stagedSeq}`, file, path: path || relative || file.name };
}

const DIRECTORY_INPUT_PROPS = {
  webkitdirectory: "",
  directory: "",
} as unknown as Record<string, string>;

export default function SkillAssetsPanel({
  skill,
  canEdit,
  onSkillChanged,
}: SkillAssetsPanelProps) {
  const t = useTranslations("skills");
  const tc = useTranslations("common");

  const {
    items,
    readablePaths,
    totalBytes,
    assetsLoading,
    execConfig,
    execConfigPublished,
    execConfigLoading,
    images,
    imagesUnavailable,
    uploading,
    uploadedCount,
    uploadAssets,
    saveAssetText,
    replaceAssetFile,
    deleteAsset,
    saveExecConfig,
    deleteExecConfig,
  } = useSkillAssets(skill.id, canEdit);

  const [staged, setStaged] = useState<StagedFile[]>([]);
  const [exporting, setExporting] = useState(false);
  const [previewTarget, setPreviewTarget] = useState<{
    path: string;
    size_bytes: number;
    /** 原样取自服务端，保存时原封不动传回 —— PUT 是 upsert，kind 传错会把 script
        改判成 reference，它就此不再被执行且不报错 */
    kind: string;
  } | null>(null);

  /**
   * 打包下载 SKILL.md + 全部资产。
   *
   * 走 axios 取 blob，**不能用 `window.location.href` 直接导航**：那样只带 cookie，
   * 而 /api/v1 代理要求 Authorization 头（lib/skillsProxy），结果是一个 401 的
   * 空文件下载下来，看起来像功能坏了。
   */
  const handleExportAll = async () => {
    setExporting(true);
    try {
      const res = await axios.get(`/api/v1/skills/${skill.id}/assets/archive?stage=draft`, {
        responseType: "blob",
      });
      const url = window.URL.createObjectURL(new Blob([res.data], { type: "application/zip" }));
      const link = document.createElement("a");
      link.href = url;
      link.download = `${skill.name || `skill-${skill.id}`}-draft.zip`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(url);
    } catch {
      toast.error(t("assetExportFailed"));
    } finally {
      setExporting(false);
    }
  };
  const [dragging, setDragging] = useState(false);
  const [execFormOpen, setExecFormOpen] = useState(false);
  const [cancelExecOpen, setCancelExecOpen] = useState(false);
  const [alsoStopLive, setAlsoStopLive] = useState(false);
  const [cancelingExec, setCancelingExec] = useState(false);
  const [savingConfig, setSavingConfig] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const [pendingAction, setPendingAction] = useState<(() => void) | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const folderInput = useRef<HTMLInputElement>(null);
  const replaceInput = useRef<HTMLInputElement>(null);
  /** 正在替换哪一份资产。用 ref 而非 state：从 onClick 到 input onChange 之间
      不需要重渲染，而 state 的异步更新会让 onChange 读到上一次的值。 */
  const replaceTarget = useRef<SkillAssetItem | null>(null);
  /** 上次选文件夹时剥掉的顶层目录名，剥了就说出来，不做静默改写 */
  const [strippedRoot, setStrippedRoot] = useState<string | null>(null);

  const groups = useMemo(() => groupAssetsByDir(items), [items]);
  /**
   * 根目录的 SKILL.md 是技能正文，不是资产。
   *
   * 它进资产表就是死重：isModelReadableAsset 把根目录 SKILL.md 排除在模型可读
   * 之外（正文已全量注入），那一行谁也读不到、只占配额。平台在
   * sync_builtin_skills.py 的 NOT_ASSETS 与后端导入里都已经这么约定。
   */
  const { body: bodyStaged, assets: assetStaged } = useMemo(
    () => partitionStagedUploads(staged),
    [staged]
  );
  /** SKILL.md 切出的正文（frontmatter 不进 content）；读文件是异步的，落在 state */
  const [bodySplit, setBodySplit] = useState<{ body: string; error: string | null } | null>(null);

  const plan = useMemo(
    () =>
      planUploads(
        items,
        assetStaged.map((s) => ({ path: s.path, size: s.file.size, kind: s.kind }))
      ),
    [items, assetStaged]
  );
  /** 行渲染按 id 找 entry：plan 只覆盖资产，下标跟 staged 不再一一对应 */
  const entryByStagedId = useMemo(
    () => new Map(assetStaged.map((item, i) => [item.id, plan.entries[i]])),
    [assetStaged, plan]
  );
  /** 待上传总数 = 合格资产 + 一份正文（切分失败的不算） */
  const pendingCount = plan.acceptedCount + (bodyStaged && !bodySplit?.error ? 1 : 0);

  /**
   * 实质编辑（上传/删除/改配置）会让后端把 published/rejected 打回 draft，
   * 发请求前先让用户确认。draft/pending_review 直接执行。
   */
  const guard = (action: () => void) => {
    if (willRevertToDraft(skill.status)) setPendingAction(() => action);
    else action();
  };

  const addFiles = (files: StagedFile[]) => {
    if (files.length > 0) setStaged((prev) => [...prev, ...files]);
  };

  /**
   * 文件夹来的一批：剥掉多余的顶层目录再入队。
   *
   * 只对**本批**判断，不掺已在队列里的文件 —— 连着选两个文件夹时，合起来看顶层
   * 就不唯一了，于是第二个文件夹反而不剥，同一个操作两种结果。
   */
  /**
   * SKILL.md 一进队列就切一次正文。
   *
   * 不放到「点上传」那一刻：切分失败（没有 frontmatter / --- 没闭合）要在列表里
   * 当场看见并且能取消，而不是点了上传才报错 —— 那时资产可能已经传上去一半。
   */
  useEffect(() => {
    if (!bodyStaged) {
      setBodySplit(null);
      return;
    }
    let stale = false;
    bodyStaged.file.text().then((text) => {
      if (!stale) setBodySplit(splitSkillMd(text));
    });
    return () => {
      stale = true;
    };
  }, [bodyStaged]);

  const addFolderFiles = (batch: StagedFile[]) => {
    const { paths, stripped } = stripRedundantRoot(batch.map((b) => b.path));
    setStrippedRoot(stripped);
    addFiles(batch.map((b, i) => ({ ...b, path: paths[i] })));
  };

  const handleDrop = async (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDragging(false);
    addFolderFiles(await collectDroppedFiles(event.dataTransfer));
  };

  /** 把 SKILL.md 的正文写进草稿。frontmatter 不带过去 —— 见 splitSkillMd。 */
  const runBodyUpdate = async (): Promise<boolean> => {
    if (!bodyStaged || !bodySplit || bodySplit.error) return false;
    try {
      await axios.put(`/api/v1/skills/${skill.id}`, { content: bodySplit.body }, {
        suppressErrorToast: true,
      } as never);
      return true;
    } catch {
      return false;
    }
  };

  const runUpload = async () => {
    const uploadable = assetStaged
      .map((item) => ({ entry: entryByStagedId.get(item.id), staged: item }))
      .filter((x) => x.entry && x.entry.error === null)
      .map(({ entry, staged: item }) => ({
        file: item.file,
        // biome-ignore lint/style/noNonNullAssertion: 上一行的 filter 已保证非空
        path: entry!.path,
        // biome-ignore lint/style/noNonNullAssertion: 同上
        kind: entry!.kind,
      }));

    // 正文先写：它失败了就别再往上堆资产，让用户先把 SKILL.md 修对。
    // 反过来（先传资产）会得到一个"资产是新的、正文是旧的"的中间态。
    const bodyPending = bodyStaged !== null && !bodySplit?.error;
    if (bodyPending) {
      const ok = await runBodyUpdate();
      if (!ok) {
        toast.error(t("skillBodyUpdateFailed"));
        return;
      }
      toast.success(t("skillBodyUpdated"));
      setStaged((prev) => prev.filter((x) => x.id !== bodyStaged.id));
    }
    if (uploadable.length === 0) {
      if (bodyPending) onSkillChanged();
      return;
    }

    const results = await uploadAssets(uploadable);
    const failed = results.filter((r) => !r.ok);
    const okPaths = new Set(results.filter((r) => r.ok).map((r) => r.path));
    setStaged((prev) =>
      prev.filter((item) => {
        const entry = entryByStagedId.get(item.id);
        return !entry || !okPaths.has(entry.path);
      })
    );
    onSkillChanged();

    if (failed.length === 0) {
      toast.success(t("uploadDone", { ok: results.length }));
    } else {
      toast.error(
        t("uploadPartial", { ok: results.length - failed.length, failed: failed.length })
      );
      for (const item of failed) {
        console.error(`Upload asset failed: ${item.path}: ${item.detail}`);
      }
    }
  };

  const runReplace = async (target: SkillAssetItem, file: File) => {
    const result = await replaceAssetFile(target.path, target.kind, file);
    if (result.ok) {
      toast.success(t("assetReplaced", { path: target.path }));
      onSkillChanged();
    } else {
      toast.error(result.detail || t("assetReplaceFailed"));
    }
  };

  const runDelete = async (path: string) => {
    const result = await deleteAsset(path);
    if (result.ok) {
      toast.success(t("assetDeleted"));
      onSkillChanged();
    } else {
      toast.error(result.detail || t("assetDeleteFailed"));
    }
  };

  const runSaveConfig = async (payload: SkillExecConfigPayload) => {
    setSavingConfig(true);
    const result = await saveExecConfig(payload);
    setSavingConfig(false);
    if (result.ok) {
      toast.success(t("execConfigSaved"));
      onSkillChanged();
    } else {
      toast.error(result.detail || t("execConfigSaveFailed"));
    }
  };

  const isExecutable = execConfig !== null;
  /** 线上是否真的在跑：published 侧有配置才算，与 skill.status 无关 */
  const hasLiveExec = execConfigPublished !== null;
  /** 删哪个 stage 的判断在 lib/skillAssets 里（planExecCancel），那边有测试 */
  const cancelPlan = planExecCancel({
    hasDraftExec: isExecutable,
    hasLiveExec,
    alsoStopLive,
  });

  /**
   * 取消可执行。默认只撤草稿 —— 与这个面板里其它写操作同一套语义（改草稿，发布才上线）。
   * 已发布的 skill 额外给一个「立刻停线上」勾选：撤草稿要等重新过审发布才生效
   * （publish 是「先删 published 再从 draft 复制」），中间这段时间线上照跑。
   */
  const runCancelExec = async () => {
    setCancelingExec(true);
    // 草稿本来就不可执行时不发这一枪：后端幂等会回 success，白白让人以为撤了什么。
    const draft = cancelPlan.deleteDraft ? await deleteExecConfig("draft") : null;
    // 两个 stage 各删各的，没有「删草稿顺带删线上」这种隐含行为。
    const live = cancelPlan.deleteLive ? await deleteExecConfig("published") : null;
    setCancelingExec(false);
    if (draft && !draft.ok) {
      toast.error(draft.detail || t("execCancelFailed"));
      return;
    }
    if (live && !live.ok) {
      // 草稿已经撤掉了，这里只报线上没停 —— 谎称全成功会让人以为线上已经安全了。
      toast.error(live.detail || t("execCancelFailed"));
      return;
    }
    toast.success(live ? t("execCancelledLive") : t("execCancelled"));
    setCancelExecOpen(false);
    setAlsoStopLive(false);
    setExecFormOpen(false);
    onSkillChanged();
  };

  if (!canEdit) return null;


  return (
    <>
      {/* 参考文档与资产文件：与「是否可执行」解耦，知识型 skill 也能只用这一块 */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <BookOpen className="h-4 w-4" />
            {t("assetFilesSection")}
          </CardTitle>
          <p className="text-sm text-muted-foreground mt-1">{t("assetFilesDesc")}</p>
        </CardHeader>

        <CardContent className="space-y-6">
          {willRevertToDraft(skill.status) && (
            <p className="text-xs rounded-md border border-amber-500/50 text-amber-600 dark:text-amber-400 px-3 py-2">
              {t("assetRevertNotice")}
            </p>
          )}

          {/* 资产清单（draft stage） */}
          <div className="space-y-2">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <p className="text-sm font-medium flex items-center gap-2">
                <FileCode2 className="h-4 w-4" />
                {t("assetManifestSection")}
              </p>
              <div className="flex items-center gap-2">
                <p className="text-xs text-muted-foreground">
                  {t("assetsQuota", {
                    count: items.length,
                    size: formatBytes(totalBytes),
                    limit: formatBytes(ASSET_MAX_TOTAL_BYTES),
                  })}
                </p>
                {/*
                  导出的是 draft stage —— 与上面这张清单同一份。导出跟屏幕上看到的
                  不是同一份会很怪。没有资产时不给按钮：一个只装着 SKILL.md 的 zip
                  没有意义，而 SKILL.md 另有导出入口。
                */}
                {items.length > 0 && (
                  <Button
                    variant="outline"
                    size="sm"
                    title={t("assetExportAllHint")}
                    disabled={exporting}
                    onClick={handleExportAll}
                  >
                    {exporting ? (
                      <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
                    ) : (
                      <Download className="h-3.5 w-3.5 mr-1.5" />
                    )}
                    {t("assetExportAll")}
                  </Button>
                )}
              </div>
            </div>

            {assetsLoading ? (
              <div className="flex justify-center py-6">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              </div>
            ) : items.length === 0 ? (
              <p className="text-sm text-muted-foreground py-4 text-center border rounded-md">
                {t("assetsEmpty")}
              </p>
            ) : (
              <div className="rounded-md border divide-y">
                {groups.map((group) => (
                  <div key={group.dir || "__root__"}>
                    <div className="flex items-center justify-between gap-2 bg-muted/50 px-3 py-1.5 text-xs text-muted-foreground">
                      <span className="font-mono break-all min-w-0">
                        {group.dir ? `${group.dir}/` : t("assetsRootGroup")}
                      </span>
                      <span className="whitespace-nowrap">
                        {group.items.length} · {formatBytes(group.totalBytes)}
                      </span>
                    </div>
                    {/* 行布局而非 table：窄屏下 table-layout:auto 会把路径列压成每字一行并撑出横向滚动 */}
                    <ul className="text-xs">
                      {group.items.map((item) => (
                        <li
                          key={item.path}
                          className="border-t px-3 py-1.5 flex flex-col gap-1 sm:flex-row sm:items-center sm:gap-3"
                        >
                          <div className="min-w-0 sm:flex-1 flex flex-wrap items-center gap-2">
                            <span className="font-mono break-all min-w-0">{item.path}</span>
                            {/* 可读 = 已发布快照里的文本 reference（判据见 isModelReadableAsset） */}
                            {readablePaths.has(item.path) ? (
                              <Badge
                                variant="secondary"
                                className="gap-1 font-normal"
                                title={t("assetReadableHint")}
                              >
                                <BookOpen className="h-3 w-3" />
                                {t("assetReadable")}
                              </Badge>
                            ) : (
                              isModelReadableAsset(item) && (
                                <span
                                  className="text-muted-foreground"
                                  title={t("assetReadableAfterPublishHint")}
                                >
                                  {t("assetReadableAfterPublish")}
                                </span>
                              )
                            )}
                          </div>
                          <div className="flex flex-wrap items-center gap-2 sm:flex-nowrap sm:shrink-0">
                            <Badge variant="outline">{assetKindLabel(t, item.kind)}</Badge>
                            <span className="whitespace-nowrap text-muted-foreground">
                              {formatBytes(item.size_bytes)}
                            </span>
                            <span className="whitespace-nowrap font-mono text-muted-foreground">
                              {shortSha(item.sha256)}
                            </span>
                            {/* 能预览的才给按钮：.zip/.so/.pyc 点开只有一屏乱码，
                                那比没有按钮更让人困惑 */}
                            {isPreviewableAsset(item.path) ? (
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-7 w-7 ml-auto text-muted-foreground"
                                onClick={() => setPreviewTarget(item)}
                                aria-label={t("assetPreview")}
                                title={t("assetPreview")}
                              >
                                <Eye className="h-3.5 w-3.5" />
                              </Button>
                            ) : (
                              <span className="ml-auto" />
                            )}
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7 text-muted-foreground"
                              onClick={() => {
                                replaceTarget.current = item;
                                replaceInput.current?.click();
                              }}
                              aria-label={t("assetReplace")}
                              title={t("assetReplace")}
                            >
                              <Replace className="h-3.5 w-3.5" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7 text-muted-foreground hover:text-destructive"
                              onClick={() => setDeleteTarget(item.path)}
                              aria-label={t("assetDelete")}
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          </div>
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* 上传区 */}
          <div className="space-y-2">
            {/* biome-ignore lint/a11y/noStaticElementInteractions: 拖放区只是鼠标增强，键盘用户走下方两个选择按钮 */}
            <div
              onDragOver={(e) => {
                e.preventDefault();
                setDragging(true);
              }}
              onDragLeave={() => setDragging(false)}
              onDrop={handleDrop}
              className={`rounded-md border border-dashed p-6 text-center space-y-2 ${
                dragging ? "border-primary bg-primary/5" : ""
              }`}
            >
              <Upload className="h-5 w-5 mx-auto text-muted-foreground" />
              <p className="text-sm text-muted-foreground">{t("uploadDropzone")}</p>
              <div className="flex justify-center gap-2">
                <Button variant="outline" size="sm" onClick={() => fileInput.current?.click()}>
                  {t("uploadBrowseFiles")}
                </Button>
                <Button variant="outline" size="sm" onClick={() => folderInput.current?.click()}>
                  {t("uploadBrowseFolder")}
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                {t("uploadHint", { max: formatBytes(ASSET_MAX_FILE_BYTES) })}
              </p>
              <input
                ref={fileInput}
                type="file"
                multiple
                hidden
                onChange={(e) => {
                  addFiles(Array.from(e.target.files || []).map((f) => toStaged(f)));
                  e.target.value = "";
                }}
              />
              {/* 替换用的单文件选择器。挑完文件才过 guard —— 与"先备好再确认"的上传
                  流程一致：先弹退回草稿的确认、用户点了确认才弹文件框，会让人不知道
                  自己刚确认的是什么。 */}
              <input
                ref={replaceInput}
                type="file"
                hidden
                onChange={(e) => {
                  const file = e.target.files?.[0] ?? null;
                  e.target.value = "";
                  const target = replaceTarget.current;
                  replaceTarget.current = null;
                  if (file && target) guard(() => runReplace(target, file));
                }}
              />
              <input
                ref={folderInput}
                type="file"
                multiple
                hidden
                {...DIRECTORY_INPUT_PROPS}
                onChange={(e) => {
                  addFolderFiles(Array.from(e.target.files || []).map((f) => toStaged(f)));
                  e.target.value = "";
                }}
              />
            </div>

            {staged.length > 0 && (
              <div className="rounded-md border">
                <div className="flex items-center justify-between px-3 py-2 bg-muted/50">
                  <p className="text-xs font-medium">
                    {t("uploadPending", { count: staged.length })}
                  </p>
                  <div className="flex gap-2">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        setStaged([]);
                        setStrippedRoot(null);
                      }}
                    >
                      {tc("cancel")}
                    </Button>
                    <Button
                      size="sm"
                      disabled={uploading || pendingCount === 0}
                      onClick={() => guard(runUpload)}
                    >
                      {uploading && <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />}
                      {uploading
                        ? t("uploading", { done: uploadedCount, total: plan.acceptedCount })
                        : t("uploadStart", { count: pendingCount })}
                    </Button>
                  </div>
                </div>
                <p className="border-t px-3 py-2 text-xs text-muted-foreground">
                  {t("assetKindHint")}
                </p>
                {/* 剥掉一层目录是对用户输入的改写，必须看得见。下面那列路径本身已经是
                    改写后的结果，但不说一句，用户会以为自己选错了文件夹。 */}
                {strippedRoot && (
                  <p className="border-t px-3 py-2 text-xs text-muted-foreground">
                    {t("uploadStrippedRoot", { root: strippedRoot })}
                  </p>
                )}
                <ul className="text-xs">
                  {staged.map((item) => {
                    const entry = entryByStagedId.get(item.id);
                    // 正文那一行没有 entry（它不是资产），也就没有类型可选
                    const isBody = entry === undefined;
                    const kindWarning = entry ? assetKindWarning(entry.path, entry.kind) : null;
                    return (
                      <li
                        key={item.id}
                        className="border-t px-3 py-1.5 flex flex-col gap-1.5 sm:flex-row sm:items-start sm:gap-3"
                      >
                        <div className="min-w-0 sm:flex-1">
                          <Input
                            value={item.path}
                            onChange={(e) =>
                              setStaged((prev) =>
                                prev.map((s) =>
                                  s.id === item.id ? { ...s, path: e.target.value } : s
                                )
                              )
                            }
                            className={`h-7 text-xs font-mono ${
                              entry?.error ? "border-destructive" : ""
                            }`}
                            aria-label={t("uploadTargetPath")}
                          />
                          {entry?.error && (
                            <p className="text-destructive mt-1 break-words">
                              {uploadErrorMessage(t, entry.error)}
                            </p>
                          )}
                          {/* 正文行：切分失败要当场看见。成功也要说清 frontmatter 不应用 ——
                              默默只更新一半是最容易误导人的做法。 */}
                          {isBody && bodySplit?.error && (
                            <p className="text-destructive mt-1 break-words">{bodySplit.error}</p>
                          )}
                          {isBody && bodySplit && !bodySplit.error && (
                            <p className="text-muted-foreground mt-1 break-words">
                              {t("uploadSkillMdFrontmatterIgnored")}
                            </p>
                          )}
                          {/* 二进制标成 reference 会进注入块 footer 却读不出来，只提示不拦 */}
                          {kindWarning === "binaryAsReference" && (
                            <p className="text-amber-600 dark:text-amber-400 mt-1 break-words">
                              {t("assetKindWarnBinaryAsReference")}
                            </p>
                          )}
                        </div>
                        <div className="flex flex-wrap items-center gap-2 sm:flex-nowrap sm:shrink-0">
                          {isBody ? (
                            <span className="whitespace-nowrap text-muted-foreground">
                              {t("uploadSkillMdBody")}
                            </span>
                          ) : (
                            <Select
                              value={entry?.kind ?? "reference"}
                              onValueChange={(value) =>
                                setStaged((prev) =>
                                  prev.map((s) =>
                                    s.id === item.id ? { ...s, kind: value as SkillAssetKind } : s
                                  )
                                )
                              }
                            >
                              <SelectTrigger
                                className="h-7 w-28 text-xs"
                                aria-label={t("assetKind")}
                              >
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                {ASSET_KINDS.map((kind) => (
                                  <SelectItem key={kind} value={kind}>
                                    {assetKindLabel(t, kind)}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          )}
                          <span className="whitespace-nowrap text-muted-foreground">
                            {formatBytes(item.file.size)}
                          </span>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7 ml-auto"
                            onClick={() =>
                              setStaged((prev) => prev.filter((s) => s.id !== item.id))
                            }
                            aria-label={t("uploadRemove")}
                          >
                            <X className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* 可执行资产的运行配置：仅可执行 skill（或点了转换）才出现，知识型 skill 不必碰 */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between gap-4">
            <div className="min-w-0">
              <CardTitle className="flex items-center gap-2">
                <Package className="h-4 w-4" />
                {t("execAssetsSection")}
              </CardTitle>
              <p className="text-sm text-muted-foreground mt-1">
                {isExecutable || execFormOpen ? t("execAssetsDesc") : t("execAssetsIdleDesc")}
              </p>
            </div>
            {execConfigLoading ? (
              <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
            ) : isExecutable || hasLiveExec ? (
              <Button
                variant="outline"
                className="text-destructive hover:text-destructive"
                onClick={() => setCancelExecOpen(true)}
              >
                <X className="h-4 w-4 mr-1" />
                {t("execCancel")}
              </Button>
            ) : execFormOpen ? (
              <Button variant="ghost" onClick={() => setExecFormOpen(false)}>
                {tc("cancel")}
              </Button>
            ) : (
              <Button variant="outline" onClick={() => setExecFormOpen(true)}>
                {t("execMakeExecutable")}
              </Button>
            )}
          </div>
        </CardHeader>

        {(isExecutable || execFormOpen) && (
          <CardContent className="space-y-2">
            <p className="text-sm font-medium flex items-center gap-2">
              <FileCode2 className="h-4 w-4" />
              {t("execConfigSection")}
            </p>
            <SkillExecConfigForm
              config={execConfig}
              images={images}
              imagesUnavailable={imagesUnavailable}
              saving={savingConfig}
              onSave={(payload) => guard(() => runSaveConfig(payload))}
            />
          </CardContent>
        )}
      </Card>

      <SkillAssetPreviewDialog
        skillId={skill.id}
        path={previewTarget?.path ?? null}
        sizeBytes={previewTarget?.size_bytes}
        kind={previewTarget?.kind}
        onSave={
          previewTarget
            ? async (text) => {
                const r = await saveAssetText(previewTarget.path, previewTarget.kind, text);
                if (r.ok) toast.success("已保存到草稿");
                else toast.error(r.detail || "保存失败");
                return r.ok;
              }
            : undefined
        }
        onClose={() => setPreviewTarget(null)}
      />

      {/* 删除确认：删的是草稿，published 快照不动 */}
      <AlertDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("assetDeleteConfirm")}</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2">
                <p className="font-mono break-all">{deleteTarget}</p>
                <p>{t("assetDeleteWarning")}</p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{tc("cancel")}</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => {
                const path = deleteTarget;
                setDeleteTarget(null);
                if (path) guard(() => runDelete(path));
              }}
            >
              {tc("delete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* 实质编辑确认：published / rejected 会被打回草稿 */}
      <AlertDialog
        open={pendingAction !== null}
        onOpenChange={(open) => !open && setPendingAction(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("assetRevertConfirmTitle")}</AlertDialogTitle>
            <AlertDialogDescription>{t("assetRevertConfirmDesc")}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{tc("cancel")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                const action = pendingAction;
                setPendingAction(null);
                action?.();
              }}
            >
              {t("assetRevertConfirmOk")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* 取消可执行：草稿必撤，线上要不要一起停由用户勾 */}
      <AlertDialog
        open={cancelExecOpen}
        onOpenChange={(open) => {
          if (cancelingExec) return;
          setCancelExecOpen(open);
          if (!open) setAlsoStopLive(false);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("execCancelConfirmTitle")}</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2">
                <p>{isExecutable ? t("execCancelConfirmDesc") : t("execCancelLiveOnlyDesc")}</p>
                {cancelPlan.offerChoice && (
                  <p className="text-amber-600 dark:text-amber-500">
                    {t("execCancelRevertNote")}
                  </p>
                )}
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>

          {cancelPlan.offerChoice && (
            <div className="flex items-start gap-2 rounded-md border p-3">
              <Checkbox
                id="also-stop-live"
                checked={alsoStopLive}
                onCheckedChange={(v) => setAlsoStopLive(v === true)}
              />
              <div className="grid gap-1">
                <label htmlFor="also-stop-live" className="text-sm font-medium leading-none">
                  {t("execCancelAlsoLive")}
                </label>
                <p className="text-xs text-muted-foreground">{t("execCancelAlsoLiveHint")}</p>
              </div>
            </div>
          )}

          <AlertDialogFooter>
            <AlertDialogCancel disabled={cancelingExec}>{tc("cancel")}</AlertDialogCancel>
            <AlertDialogAction
              disabled={cancelingExec}
              onClick={(e) => {
                // AlertDialogAction 默认点了就关；请求还没回来就关，用户看不到失败。
                e.preventDefault();
                runCancelExec();
              }}
            >
              {cancelingExec && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}
              {t("execCancel")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

type Translator = ReturnType<typeof useTranslations<"skills">>;

function assetKindLabel(t: Translator, kind: string): string {
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
}

function uploadErrorMessage(
  t: Translator,
  error: NonNullable<ReturnType<typeof planUploads>["entries"][number]["error"]>
): string {
  if (error.type === "path") return t(PATH_ERROR_MESSAGE_KEY[error.code]);
  if (error.type === "tooLarge") return t("uploadErrTooLarge", { max: formatBytes(error.limit) });
  return t("uploadErrQuota", { limit: formatBytes(error.limit) });
}
