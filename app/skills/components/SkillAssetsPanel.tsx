"use client";

import { type DragEvent, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
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
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { FileCode2, Loader2, Package, Trash2, Upload, X } from "lucide-react";
import {
  ASSET_KINDS,
  ASSET_MAX_FILE_BYTES,
  ASSET_MAX_TOTAL_BYTES,
  PATH_ERROR_MESSAGE_KEY,
  formatBytes,
  groupAssetsByDir,
  planUploads,
  shortSha,
  willRevertToDraft,
} from "@/lib/skillAssets";
import { useSkillAssets } from "@/hooks/useSkillAssets";
import type { Skill, SkillAssetKind, SkillExecConfigPayload } from "@/types/skill";
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
    totalBytes,
    assetsLoading,
    execConfig,
    execConfigLoading,
    images,
    imagesUnavailable,
    uploading,
    uploadedCount,
    uploadAssets,
    deleteAsset,
    saveExecConfig,
  } = useSkillAssets(skill.id, canEdit);

  const [staged, setStaged] = useState<StagedFile[]>([]);
  const [dragging, setDragging] = useState(false);
  const [execFormOpen, setExecFormOpen] = useState(false);
  const [savingConfig, setSavingConfig] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const [pendingAction, setPendingAction] = useState<(() => void) | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const folderInput = useRef<HTMLInputElement>(null);

  const groups = useMemo(() => groupAssetsByDir(items), [items]);
  const plan = useMemo(
    () =>
      planUploads(
        items,
        staged.map((s) => ({ path: s.path, size: s.file.size, kind: s.kind }))
      ),
    [items, staged]
  );

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

  const handleDrop = async (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDragging(false);
    addFiles(await collectDroppedFiles(event.dataTransfer));
  };

  const runUpload = async () => {
    const uploadable = plan.entries
      .map((entry, index) => ({ entry, staged: staged[index] }))
      .filter(({ entry }) => entry.error === null)
      .map(({ entry, staged: item }) => ({
        file: item.file,
        path: entry.path,
        kind: entry.kind,
      }));
    if (uploadable.length === 0) return;

    const results = await uploadAssets(uploadable);
    const failed = results.filter((r) => !r.ok);
    const okPaths = new Set(results.filter((r) => r.ok).map((r) => r.path));
    setStaged((prev) => prev.filter((_, i) => !okPaths.has(plan.entries[i]?.path ?? "")));
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

  if (!canEdit) return null;

  const isExecutable = execConfig !== null;
  const showBody = isExecutable || execFormOpen || items.length > 0;

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-4">
          <div className="min-w-0">
            <CardTitle className="flex items-center gap-2">
              <Package className="h-4 w-4" />
              {t("execAssetsSection")}
            </CardTitle>
            <p className="text-sm text-muted-foreground mt-1">{t("execAssetsDesc")}</p>
          </div>
          {execConfigLoading ? (
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
          ) : (
            !isExecutable &&
            !execFormOpen && (
              <Button variant="outline" onClick={() => setExecFormOpen(true)}>
                {t("execMakeExecutable")}
              </Button>
            )
          )}
        </div>
      </CardHeader>

      {showBody && (
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
              <p className="text-xs text-muted-foreground">
                {t("assetsQuota", {
                  count: items.length,
                  size: formatBytes(totalBytes),
                  limit: formatBytes(ASSET_MAX_TOTAL_BYTES),
                })}
              </p>
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
                          <span className="font-mono break-all min-w-0 sm:flex-1">{item.path}</span>
                          <div className="flex flex-wrap items-center gap-2 sm:flex-nowrap sm:shrink-0">
                            <Badge variant="outline">{assetKindLabel(t, item.kind)}</Badge>
                            <span className="whitespace-nowrap text-muted-foreground">
                              {formatBytes(item.size_bytes)}
                            </span>
                            <span className="whitespace-nowrap font-mono text-muted-foreground">
                              {shortSha(item.sha256)}
                            </span>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7 ml-auto text-muted-foreground hover:text-destructive"
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
              <input
                ref={folderInput}
                type="file"
                multiple
                hidden
                {...DIRECTORY_INPUT_PROPS}
                onChange={(e) => {
                  addFiles(Array.from(e.target.files || []).map((f) => toStaged(f)));
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
                    <Button variant="ghost" size="sm" onClick={() => setStaged([])}>
                      {tc("cancel")}
                    </Button>
                    <Button
                      size="sm"
                      disabled={uploading || plan.acceptedCount === 0}
                      onClick={() => guard(runUpload)}
                    >
                      {uploading && <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />}
                      {uploading
                        ? t("uploading", { done: uploadedCount, total: plan.acceptedCount })
                        : t("uploadStart", { count: plan.acceptedCount })}
                    </Button>
                  </div>
                </div>
                <ul className="text-xs">
                  {staged.map((item, index) => {
                    const entry = plan.entries[index];
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
                        </div>
                        <div className="flex flex-wrap items-center gap-2 sm:flex-nowrap sm:shrink-0">
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
                            <SelectTrigger className="h-7 w-28 text-xs">
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

          {/* exec 运行配置 */}
          <div className="space-y-2">
            <p className="text-sm font-medium">{t("execConfigSection")}</p>
            <SkillExecConfigForm
              config={execConfig}
              images={images}
              imagesUnavailable={imagesUnavailable}
              saving={savingConfig}
              onSave={(payload) => guard(() => runSaveConfig(payload))}
            />
          </div>
        </CardContent>
      )}

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
    </Card>
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
