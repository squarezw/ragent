"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
import {
  AlertCircle,
  AlertTriangle,
  Eye,
  FileText,
  Loader2,
  Sparkles,
  Undo2,
  X,
} from "lucide-react";
import { useAgentMd, type AgentMdValidationError } from "@/hooks/useAgentMd";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { checkSuperAdmin } from "@/lib/clientPermissions";

interface AgentMdEditorProps {
  appId: number;
  platform: string;
  /** Agent.md 状态变化（升级 / 回退）后通知父组件刷新应用信息 */
  onChanged?: () => void;
}

/**
 * 应用详情页的 Agent.md 编辑区块：
 * - legacy（无 agent_md）：显示「升级为 Agent.md」（platform=Wechat 禁用并提示）
 * - 已有 agent_md：全文编辑 + 保存（422 按行号展示）+ 导出视图 + 回退到提示词（二次确认）
 */
export default function AgentMdEditor({ appId, platform, onChanged }: AgentMdEditorProps) {
  const t = useTranslations("skills");
  const tc = useTranslations("common");
  const { user } = useCurrentUser();
  const canManage = checkSuperAdmin(user);

  const { agentMd, loading, save, generate, remove, fetchExport } = useAgentMd(appId);

  const [content, setContent] = useState("");
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [validationErrors, setValidationErrors] = useState<AgentMdValidationError[]>([]);
  const [saveWarnings, setSaveWarnings] = useState<string[]>([]);
  const [exportContent, setExportContent] = useState<string | null>(null);
  const [exportLoading, setExportLoading] = useState(false);
  const [revertDialogOpen, setRevertDialogOpen] = useState(false);

  const isWechat = platform === "Wechat";
  const isLegacy = agentMd?.is_legacy !== false;

  // 后端内容加载/变化时回填（本地有未保存修改则不覆盖）
  useEffect(() => {
    if (!dirty) {
      setContent(agentMd?.content || "");
    }
  }, [agentMd, dirty]);

  const handleSave = async () => {
    setSaving(true);
    setValidationErrors([]);
    const result = await save(content);
    if (result.ok) {
      setDirty(false);
      // 后端会剥掉 frontmatter 的 model，回填归一化全文才不会与库里的内容分叉
      if (typeof result.normalizedContent === "string") {
        setContent(result.normalizedContent);
      }
      setSaveWarnings(result.warnings || []);
    } else if (result.errors) {
      setValidationErrors(result.errors);
    }
    setSaving(false);
  };

  const handleUpgrade = async () => {
    setGenerating(true);
    const ok = await generate();
    setGenerating(false);
    if (ok) {
      setDirty(false);
      setSaveWarnings([]);
      onChanged?.();
    }
  };

  const handleRevert = async () => {
    const ok = await remove();
    if (ok) {
      setRevertDialogOpen(false);
      setDirty(false);
      setContent("");
      setValidationErrors([]);
      setSaveWarnings([]);
      onChanged?.();
    }
  };

  const handleExportView = async () => {
    setExportLoading(true);
    const result = await fetchExport();
    setExportLoading(false);
    if (result) {
      setExportContent(result.content || "");
    }
  };

  if (loading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FileText className="h-5 w-5" />
            Agent.md
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2">
            <FileText className="h-5 w-5" />
            Agent.md
            {isLegacy ? (
              <Badge variant="secondary">{t("legacyMode")}</Badge>
            ) : (
              <Badge>{t("agentMdMode")}</Badge>
            )}
          </CardTitle>
          {!isLegacy && canManage && (
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={handleExportView}
                disabled={exportLoading}
              >
                {exportLoading ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <Eye className="h-4 w-4 mr-2" />
                )}
                {t("exportView")}
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="text-destructive"
                onClick={() => setRevertDialogOpen(true)}
              >
                <Undo2 className="h-4 w-4 mr-2" />
                {t("revertToPrompt")}
              </Button>
              <Button size="sm" onClick={handleSave} disabled={saving || !dirty}>
                {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                {tc("save")}
              </Button>
            </div>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {isLegacy ? (
          <div className="text-center py-6 space-y-3">
            <p className="text-sm text-muted-foreground">{t("legacyDesc")}</p>
            {canManage && (
              <>
                <Button onClick={handleUpgrade} disabled={generating || isWechat}>
                  {generating ? (
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  ) : (
                    <Sparkles className="h-4 w-4 mr-2" />
                  )}
                  {t("upgradeToAgentMd")}
                </Button>
                {isWechat && (
                  <p className="text-xs text-muted-foreground">{t("wechatUpgradeDisabled")}</p>
                )}
              </>
            )}
          </div>
        ) : (
          <>
            {validationErrors.length > 0 && (
              <div className="border border-destructive/50 bg-destructive/5 rounded-md p-3 space-y-1">
                <div className="flex items-center gap-2 text-sm font-medium text-destructive">
                  <AlertCircle className="h-4 w-4" />
                  {t("agentMdValidationFailed")}
                </div>
                <ul className="text-sm text-destructive space-y-0.5 pl-6 list-disc">
                  {validationErrors.map((err, index) => (
                    <li key={`${err.line ?? "x"}-${index}`}>
                      {err.line !== undefined && (
                        <span className="font-mono">{t("lineNumber", { line: err.line })} </span>
                      )}
                      {err.message}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {/* 保存成功但内容被归一化（如剥掉 frontmatter model）：留在页面上直到用户主动关闭 */}
            {saveWarnings.length > 0 && (
              <section
                aria-live="polite"
                className="rounded-md border border-amber-300 bg-amber-50 p-3 dark:border-amber-800 dark:bg-amber-950/30"
              >
                <div className="flex items-start gap-2">
                  <AlertTriangle
                    className="h-4 w-4 mt-0.5 shrink-0 text-amber-600 dark:text-amber-400"
                    aria-hidden="true"
                  />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-amber-900 dark:text-amber-200">
                      {t("agentMdSaveWarningsTitle", { count: saveWarnings.length })}
                    </p>
                    <ul className="mt-1.5 space-y-1 list-disc pl-4">
                      {saveWarnings.map((warning) => (
                        <li
                          key={warning}
                          className="text-sm text-amber-900 break-words dark:text-amber-200"
                        >
                          {warning}
                        </li>
                      ))}
                    </ul>
                    <p className="mt-1.5 text-xs text-amber-800 dark:text-amber-300">
                      {t("agentMdSaveWarningsHint")}
                    </p>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 w-7 p-0 shrink-0"
                    aria-label={tc("close")}
                    onClick={() => setSaveWarnings([])}
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              </section>
            )}
            <Textarea
              value={content}
              onChange={(e) => {
                setContent(e.target.value);
                setDirty(true);
              }}
              rows={20}
              className="font-mono text-sm"
              placeholder={t("agentMdPlaceholder")}
              disabled={!canManage}
            />
            <p className="text-xs text-muted-foreground">{t("agentMdHelp")}</p>
          </>
        )}
      </CardContent>

      {/* 导出视图（?export=true 合成只读版） */}
      <Dialog
        open={exportContent !== null}
        onOpenChange={(open) => !open && setExportContent(null)}
      >
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>{t("exportView")}</DialogTitle>
            <DialogDescription>{t("exportViewNote")}</DialogDescription>
          </DialogHeader>
          <pre className="text-xs bg-muted rounded-md p-4 max-h-[60vh] overflow-auto whitespace-pre-wrap">
            {exportContent}
          </pre>
        </DialogContent>
      </Dialog>

      {/* 回退到提示词：二次确认 */}
      <AlertDialog open={revertDialogOpen} onOpenChange={setRevertDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("confirmRevert")}</AlertDialogTitle>
            <AlertDialogDescription>{t("revertWarning")}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{tc("cancel")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleRevert}
              className="bg-destructive text-destructive-foreground"
            >
              {t("revertToPrompt")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}
