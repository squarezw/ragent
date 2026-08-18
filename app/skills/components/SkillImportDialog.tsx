"use client";

import React, { useCallback, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  AlertCircle, ChevronDown, ChevronRight, File as FileIcon, Folder,
  FolderOpen, Loader2, Upload,
} from "lucide-react";
import { toast } from "sonner";
import axios from "@/lib/axios";
import {
  isZipFile, precheck, readDataTransfer, readFileList, readZip, toPayload,
  type BundleFile,
} from "@/lib/skillBundle";
import {
  buildTree, countByStatus, formatSize,
  type FileStatus, type ImportFileVerdict, type TreeNode,
} from "@/lib/skillImportTree";

interface ValidateResult {
  ok: boolean;
  name: string;
  description: string;
  stripped_root: string | null;
  errors: string[];
  warnings: string[];
  files: ImportFileVerdict[];
  total_files: number;
  total_bytes: number;
}

const STATUS_STYLE: Record<FileStatus, string> = {
  error: "text-destructive",
  warning: "text-warning",
  ok: "text-foreground",
  // 跳过的文件压暗但**仍然列出来** —— 不显示会让用户以为文件传丢了
  skipped: "text-muted-foreground/60 line-through",
};

export default function SkillImportDialog({
  open, onOpenChange,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const t = useTranslations("skills");
  const tc = useTranslations("common");
  const router = useRouter();

  const [busy, setBusy] = useState<null | "reading" | "validating" | "importing">(null);
  const [files, setFiles] = useState<BundleFile[]>([]);
  const [result, setResult] = useState<ValidateResult | null>(null);
  const [dragging, setDragging] = useState(false);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  const folderInput = useRef<HTMLInputElement>(null);
  const zipInput = useRef<HTMLInputElement>(null);

  const reset = () => {
    setFiles([]); setResult(null); setBusy(null); setCollapsed(new Set());
  };

  const validate = useCallback(async (bundle: BundleFile[]) => {
    const localError = precheck(bundle);
    if (localError) { toast.error(localError); return; }

    setFiles(bundle);
    setBusy("validating");
    try {
      const { data } = await axios.post<ValidateResult>(
        "/api/v1/skills/import/validate", toPayload(bundle));
      setResult(data);
    } catch (e: any) {
      toast.error(e?.response?.data?.detail || t("importFailed"));
      setResult(null);
    } finally {
      setBusy(null);
    }
  }, [t]);

  const ingest = useCallback(async (read: () => Promise<BundleFile[]>) => {
    setBusy("reading");
    try {
      await validate(await read());
    } catch (e: any) {
      toast.error(e?.message || t("importFailed"));
      setBusy(null);
    }
  }, [validate, t]);

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    void ingest(() => readDataTransfer(e.dataTransfer));
  };

  const doImport = async () => {
    if (!result?.ok || files.length === 0) return;
    setBusy("importing");
    try {
      const { data } = await axios.post("/api/v1/skills/import", toPayload(files));
      toast.success(t("importSuccess"));
      onOpenChange(false);
      reset();
      // 直接进编辑页：显示名留空，用户下一步就是填它
      if (data?.id) router.push(`/skills/${data.id}`);
    } catch (e: any) {
      const detail = e?.response?.data?.detail;
      toast.error(typeof detail === "string" ? detail
        : detail?.message || t("importFailed"));
      // 失败时重新校验一次：可能是这两次请求之间有人占了同名
      if (files.length) void validate(files);
    } finally {
      setBusy(null);
    }
  };

  const counts = result ? countByStatus(result.files) : null;
  const errorCount = (result?.errors.length ?? 0) + (counts?.error ?? 0);

  const toggle = (path: string) => setCollapsed((prev) => {
    const next = new Set(prev);
    next.has(path) ? next.delete(path) : next.add(path);
    return next;
  });

  const renderNode = (node: TreeNode, depth = 0): React.ReactNode => {
    const isCollapsed = collapsed.has(node.path);
    return (
      <div key={node.path}>
        <div
          className={`flex items-start gap-2 py-1 text-sm ${STATUS_STYLE[node.status]}`}
          style={{ paddingLeft: `${depth * 16}px` }}
        >
          {node.isDir ? (
            <button type="button" onClick={() => toggle(node.path)}
              className="flex items-center gap-1 shrink-0 hover:opacity-80">
              {isCollapsed ? <ChevronRight className="h-3.5 w-3.5" />
                           : <ChevronDown className="h-3.5 w-3.5" />}
              {isCollapsed ? <Folder className="h-4 w-4" />
                           : <FolderOpen className="h-4 w-4" />}
            </button>
          ) : (
            <FileIcon className="h-4 w-4 shrink-0 mt-0.5 ml-[18px]" />
          )}

          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-mono break-all">{node.name}</span>
              {!node.isDir && node.kind && (
                <Badge variant="outline" className="text-[10px] py-0">{node.kind}</Badge>
              )}
              <span className="text-xs text-muted-foreground shrink-0">
                {formatSize(node.size)}
              </span>
            </div>
            {/* 原因紧跟在文件下方——把它收进 tooltip 的话，用户得逐个悬停才知道哪里错 */}
            {!node.isDir && node.reason && (
              <div className={`text-xs mt-0.5 ${
                node.status === "error" ? "text-destructive" : "text-muted-foreground"}`}>
                {node.reason}
              </div>
            )}
          </div>
        </div>
        {node.isDir && !isCollapsed && node.children.map((c) => renderNode(c, depth + 1))}
      </div>
    );
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { onOpenChange(v); if (!v) reset(); }}>
      <DialogContent
        className="max-w-3xl"
        style={{ display: "flex", flexDirection: "column", maxHeight: "85vh" }}
      >
        <DialogHeader>
          <DialogTitle>{t("importTitle")}</DialogTitle>
          <DialogDescription>{t("importHint")}</DialogDescription>
        </DialogHeader>

        {!result && (
          <div
            onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
            onDragLeave={() => setDragging(false)}
            onDrop={onDrop}
            className={`border-2 border-dashed rounded-lg p-10 text-center transition-colors ${
              dragging ? "border-primary bg-primary/5" : "border-border"}`}
          >
            {busy ? (
              <div className="flex flex-col items-center gap-2 text-muted-foreground">
                <Loader2 className="h-8 w-8 animate-spin" />
                <span>{busy === "reading" ? t("importReading") : t("importValidating")}</span>
              </div>
            ) : (
              <>
                <Upload className="mx-auto h-10 w-10 text-muted-foreground/50 mb-3" />
                <p className="text-sm text-muted-foreground mb-4">{t("importHint")}</p>
                <div className="flex gap-2 justify-center">
                  <Button variant="outline" size="sm"
                    onClick={() => folderInput.current?.click()}>
                    {t("importPickFolder")}
                  </Button>
                  <Button variant="outline" size="sm"
                    onClick={() => zipInput.current?.click()}>
                    {t("importPickZip")}
                  </Button>
                </div>
              </>
            )}
          </div>
        )}

        {/* webkitdirectory 不是标准属性，React 需要用 ref 之外的方式注入 */}
        <input
          ref={folderInput} type="file" multiple hidden
          // @ts-expect-error —— 非标准属性，但是浏览器选目录的唯一途径
          webkitdirectory="" directory=""
          onChange={(e) => {
            const fl = e.target.files;
            if (fl?.length) void ingest(() => readFileList(fl));
            e.target.value = "";
          }}
        />
        <input
          ref={zipInput} type="file" accept=".zip" hidden
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) {
              if (!isZipFile(f)) { toast.error(t("importPickZip")); return; }
              void ingest(() => readZip(f));
            }
            e.target.value = "";
          }}
        />

        {result && (
          <div className="min-h-0 flex-1 overflow-y-auto space-y-3">
            {result.stripped_root && (
              <div className="text-sm rounded-md bg-muted px-3 py-2">
                {t("importStrippedRoot", { root: result.stripped_root })}
              </div>
            )}

            {result.name && (
              <div className="text-sm space-y-1">
                <div><span className="text-muted-foreground">name:</span>{" "}
                  <span className="font-mono">{result.name}</span></div>
                <div className="text-muted-foreground text-xs">
                  {t("importDisplayNameTip")}
                </div>
              </div>
            )}

            {errorCount > 0 && (
              <div className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2">
                <div className="flex items-center gap-2 text-destructive text-sm font-medium">
                  <AlertCircle className="h-4 w-4" />
                  {t("importHasErrors", { n: errorCount })}
                </div>
                {result.errors.length > 0 && (
                  <ul className="mt-1 ml-6 list-disc text-sm text-destructive space-y-0.5">
                    {result.errors.map((e, i) => <li key={i}>{e}</li>)}
                  </ul>
                )}
              </div>
            )}

            {result.warnings.map((w, i) => (
              <div key={i} className="text-sm text-muted-foreground">⚠️ {w}</div>
            ))}

            {counts && (
              <div className="text-sm text-muted-foreground">
                {t("importSummary", { ok: counts.ok + counts.warning, skipped: counts.skipped })}
              </div>
            )}

            <div className="rounded-md border p-2">
              {buildTree(result.files).map((n) => renderNode(n))}
            </div>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={!!busy}>
            {tc("close")}
          </Button>
          {result && (
            <>
              <Button variant="outline" onClick={reset} disabled={!!busy}>
                {t("importPickFolder")}
              </Button>
              <Button onClick={doImport} disabled={!result.ok || !!busy}>
                {busy === "importing" && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                {t("importConfirm")}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
