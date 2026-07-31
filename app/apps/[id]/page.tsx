"use client";

import { use, useState, useEffect } from "react";
import { useTranslations } from "next-intl";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { CustomViewRenderer } from "./custom-views/registry";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
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
import { Checkbox } from "@/components/ui/checkbox";
import {
  ArrowLeft,
  Loader2,
  Plus,
  Send,
  Settings,
  Trash2,
  Wrench,
  Activity,
  TrendingUp,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useAppTools, useAppToolsStatistics } from "@/hooks/useAppTools";
import { useInvalidateAppSkillDiagnostics } from "@/hooks/useAppSkillDiagnostics";
import AppSkillsSection from "../components/AppSkillsSection";
import AppSkillDiagnostics from "../components/AppSkillDiagnostics";
import AgentMdEditor from "../components/AgentMdEditor";
import ReviewLogDialog from "@/components/ReviewLogDialog";
import ReviewRejectDialog from "@/components/ReviewRejectDialog";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { checkSuperAdmin, checkTenantAdmin } from "@/lib/clientPermissions";
import { isSelfReview } from "@/lib/reviewQueue";
import { REVIEW_STATUSES, appStatusBadge, type ReviewStatus } from "@/lib/reviewStatus";
import axios from "@/lib/axios";
import { toast } from "sonner";

interface AppInfo {
  id: number;
  name: string;
  description: string;
  app_type: string;
  platform: string;
  ai_model: string;
  agent_md?: string | null;
  /** legacy 提示词绑定；用来判断 Agent.md 区块该说「升级」还是「创建」 */
  prompt_id?: number | null;
  created_at: string;
  updated_at: string;
  settings?: Record<string, any>;
  /** P5 审核状态；后端并行开发中可能缺失（缺失时不渲染状态区，存量行为不变） */
  status?: ReviewStatus;
  visibility?: string;
  /** 创建者（提交人）用户ID，自审判定用 */
  user_id?: number | null;
  owner_dept_id?: number | null;
  owner_tenant_id?: number | null;
}

export default function AppDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const router = useRouter();
  const t = useTranslations("apps");
  const tc = useTranslations("common");
  const ts = useTranslations("skills");
  const tr = useTranslations("reviews");
  const { id } = use(params);
  const appId = Number(id);

  const [appInfo, setAppInfo] = useState<AppInfo | null>(null);
  const [loadingApp, setLoadingApp] = useState(true);
  const [bindDialogOpen, setBindDialogOpen] = useState(false);
  const [unbindDialogOpen, setUnbindDialogOpen] = useState(false);
  const [selectedAppToolId, setSelectedAppToolId] = useState<number | null>(null);
  const [rejectDialogOpen, setRejectDialogOpen] = useState(false);
  const [reviewActionPending, setReviewActionPending] = useState(false);
  const [reviewLogOpen, setReviewLogOpen] = useState(false);

  const {
    tools: appTools,
    loading: appToolsLoading,
    unbindTool,
    refresh: refreshAppTools,
  } = useAppTools(appId);
  const { statistics } = useAppToolsStatistics(appId);
  const { user } = useCurrentUser();
  const invalidateSkillDiagnostics = useInvalidateAppSkillDiagnostics();

  useEffect(() => {
    loadAppInfo();
  }, [appId]);

  const loadAppInfo = async () => {
    try {
      const response = await axios.get(`/api/v1/apps/${appId}`);
      setAppInfo(response.data);
    } catch (error) {
      console.error("Failed to load app info:", error);
      toast.error(t("loadAppInfoFailed"));
    } finally {
      setLoadingApp(false);
    }
  };

  const handleBindTools = async (toolIds: number[]) => {
    try {
      await axios.post(`/api/apps/${appId}/tools/batch`, {
        tools: toolIds.map((id) => ({ tool_id: id })),
      });
      toast.success(t("bindToolsSuccess", { count: toolIds.length }));
      refreshAppTools();
      // 新绑的工具可能正好补上某个 skill 的缺口
      invalidateSkillDiagnostics(appId);
      setBindDialogOpen(false);
    } catch (error: any) {
      console.error("Bind tools error:", error);
      toast.error(error.response?.data?.error || t("bindToolsFailed"));
    }
  };

  const handleUnbind = async () => {
    if (!selectedAppToolId) return;

    const success = await unbindTool(selectedAppToolId);
    if (success) {
      // 解绑的工具可能正是某个 skill 的依赖，缺口会立刻长出来
      invalidateSkillDiagnostics(appId);
      setUnbindDialogOpen(false);
      setSelectedAppToolId(null);
    }
  };

  // P5：提交应用审核（draft/rejected → pending_review）
  const handleSubmitReview = async () => {
    setReviewActionPending(true);
    try {
      await axios.post(`/api/v1/apps/${appId}/submit-review`);
      toast.success(ts("submitReviewSuccess"));
      await loadAppInfo();
    } catch (error: any) {
      const detail = error.response?.data?.detail;
      toast.error(typeof detail === "string" ? detail : t("operationFailed"));
    } finally {
      setReviewActionPending(false);
    }
  };

  // P5：审核（通过 / 驳回带理由）
  const handleReview = async (approve: boolean, comment?: string): Promise<boolean> => {
    setReviewActionPending(true);
    try {
      await axios.post(`/api/v1/apps/${appId}/review`, { approve, comment });
      toast.success(approve ? tr("approveSuccess") : tr("rejectSuccess"));
      await loadAppInfo();
      return true;
    } catch (error: any) {
      const detail = error.response?.data?.detail;
      toast.error(typeof detail === "string" ? detail : t("operationFailed"));
      return false;
    } finally {
      setReviewActionPending(false);
    }
  };

  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr);
    return date.toLocaleString("zh-CN");
  };

  if (loadingApp) {
    return (
      <div className="container mx-auto p-6">
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      </div>
    );
  }

  if (!appInfo) {
    return (
      <div className="container mx-auto p-6">
        <div className="text-center py-12">
          <p className="text-muted-foreground">{t("appNotFound")}</p>
          <Button onClick={() => router.push("/apps")} className="mt-4">
            {t("backToAppList")}
          </Button>
        </div>
      </div>
    );
  }

  const isCustom = appInfo.app_type === "Custom";

  // P5 审核状态区：只有后端明确返回合法 status 才渲染（存量应用不变）
  const status =
    appInfo.status && (REVIEW_STATUSES as string[]).includes(appInfo.status)
      ? appInfo.status
      : null;
  // published 不出徽标（正常终态且无出口动作，规则见 lib/reviewStatus.ts）
  const statusBadge = appStatusBadge(appInfo.status);
  const canReview = checkSuperAdmin(user) || checkTenantAdmin(user);
  // 审核人不能审自己提交的对象（超管除外，后端违者 403）
  const selfReview = isSelfReview(user?.id, appInfo.user_id, checkSuperAdmin(user));
  // 状态徽标并入基本信息首行；动作/提示另起一行，且只在真有内容时渲染
  const reviewFooterVisible =
    status === "draft" ||
    status === "rejected" ||
    (status === "pending_review" && canReview);

  return (
    <div
      className={
        isCustom ? "container mx-auto px-6 pt-0 pb-6 space-y-3" : "container mx-auto p-6 space-y-6"
      }
    >
      {/* 顶部导航。绑定工具的按钮已移到「已绑定工具」区的标题右侧，所以这里不再需要
          justify-between 的两端布局。 */}
      <div className="flex items-center gap-3">
        <Button
          variant="ghost"
          size={isCustom ? "sm" : "default"}
          onClick={() => router.push("/apps")}
        >
          <ArrowLeft className="h-4 w-4 mr-2" />
          {t("back")}
        </Button>
        <div>
          <h1 className={isCustom ? "text-xl font-bold leading-tight" : "text-3xl font-bold"}>
            {appInfo.name}
          </h1>
          {(!isCustom || appInfo.description) && (
            <p className="text-muted-foreground text-sm">{appInfo.description}</p>
          )}
        </div>
      </div>

      {/* 应用基本信息（Custom 应用直接进自定义视图，不展示这块元信息）*/}
      {appInfo.app_type !== "Custom" && (
        <Card>
          <CardHeader>
            <CardTitle>{t("basicInfo")}</CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-2 md:grid-cols-5 gap-4">
            <div>
              <div className="text-sm text-muted-foreground mb-1">{t("appType")}</div>
              <Badge variant="outline">{appInfo.app_type}</Badge>
            </div>
            <div>
              <div className="text-sm text-muted-foreground mb-1">{t("platform")}</div>
              <Badge variant="outline">{appInfo.platform}</Badge>
            </div>
            <div>
              <div className="text-sm text-muted-foreground mb-1">{t("aiModel")}</div>
              <div className="text-sm">{appInfo.ai_model}</div>
            </div>
            <div>
              <div className="text-sm text-muted-foreground mb-1">{tc("createdAt")}</div>
              <div className="text-sm">{formatDate(appInfo.created_at)}</div>
            </div>
            {statusBadge && (
              <div>
                <div className="text-sm text-muted-foreground mb-1">{tc("status")}</div>
                <Badge variant={statusBadge.variant} className={statusBadge.className}>
                  {ts(statusBadge.labelKey)}
                </Badge>
              </div>
            )}
            {/* 审核动作与状态提示：仅在确有内容时才占一行，已发布应用不留空带 */}
            {reviewFooterVisible && (
              <div className="col-span-2 md:col-span-5 pt-2 border-t">
                <div className="flex items-center gap-2 flex-wrap">
                  {(status === "draft" || status === "rejected") && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={handleSubmitReview}
                      disabled={reviewActionPending}
                    >
                      <Send className="h-4 w-4 mr-1" />
                      {ts("submitReview")}
                    </Button>
                  )}
                  {status === "pending_review" &&
                    canReview &&
                    (selfReview ? (
                      <span className="text-xs text-muted-foreground">{tr("selfReviewHint")}</span>
                    ) : (
                      <>
                        <Button
                          size="sm"
                          onClick={() => handleReview(true)}
                          disabled={reviewActionPending}
                        >
                          {tr("approve")}
                        </Button>
                        <Button
                          size="sm"
                          variant="destructive"
                          onClick={() => setRejectDialogOpen(true)}
                          disabled={reviewActionPending}
                        >
                          {tr("reject")}
                        </Button>
                      </>
                    ))}
                </div>
                {/* 被驳回：提示 + 驳回理由入口（审核日志弹窗，惰性拉取） */}
                {status === "rejected" && (
                  <p className="text-xs text-destructive mt-2">
                    {tr("rejectedHint")}{" "}
                    <Button
                      variant="link"
                      size="sm"
                      className="h-auto p-0 text-xs underline"
                      onClick={() => setReviewLogOpen(true)}
                    >
                      {tr("viewRejectReason")}
                    </Button>
                  </p>
                )}
                {status === "draft" && (
                  <p className="text-xs text-muted-foreground mt-2">{tr("draftOwnerOnlyHint")}</p>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* 驳回弹窗（理由必填） */}
      <ReviewRejectDialog
        open={rejectDialogOpen}
        onOpenChange={setRejectDialogOpen}
        targetName={appInfo.name}
        onConfirm={(comment) => handleReview(false, comment)}
      />

      {/* 审核记录（驳回理由）弹窗 */}
      <ReviewLogDialog
        targetType="app"
        targetId={reviewLogOpen ? appId : null}
        targetName={appInfo.name}
        onOpenChange={(open) => !open && setReviewLogOpen(false)}
      />

      {/* Custom 应用：渲染自定义视图（settings.view_key → 注册表组件）；缺 view_key 时由组件给出明确提示，不留白 */}
      {appInfo.app_type === "Custom" && <CustomViewRenderer viewKey={appInfo.settings?.view_key} />}

      {/* 以下工具统计 / 绑定列表仅非 Custom 应用展示 */}
      {appInfo.app_type !== "Custom" && (
        <>
          {/* 工具统计 */}
          {statistics && (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm font-medium text-muted-foreground">
                    {t("boundToolsCount")}
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="flex items-center gap-2">
                    <Wrench className="h-5 w-5 text-blue-500" />
                    <div className="text-2xl font-bold">{appTools.length}</div>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm font-medium text-muted-foreground">
                    {t("totalCalls")}
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="flex items-center gap-2">
                    <Activity className="h-5 w-5 text-green-500" />
                    <div className="text-2xl font-bold">{statistics.summary?.total_calls || 0}</div>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm font-medium text-muted-foreground">
                    {t("avgSuccessRate")}
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="flex items-center gap-2">
                    <TrendingUp className="h-5 w-5 text-orange-500" />
                    <div className="text-2xl font-bold">
                      {statistics.summary?.success_rate
                        ? `${(statistics.summary.success_rate * 100).toFixed(1)}%`
                        : "0%"}
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>
          )}

          {/* 已绑定工具列表。绑定入口放在本区标题右侧（与 AppSkillsSection 一致）：
              操作和它作用的对象在一起，比留在页头更好找。 */}
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle>{t("boundTools", { count: appTools.length })}</CardTitle>
                {checkSuperAdmin(user) && (
                  <Button size="sm" onClick={() => setBindDialogOpen(true)}>
                    <Plus className="h-4 w-4 mr-2" />
                    {t("bindTools")}
                  </Button>
                )}
              </div>
            </CardHeader>
            <CardContent>
              {appToolsLoading ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                </div>
              ) : appTools.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">{t("noToolsBound")}</div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t("toolName")}</TableHead>
                      <TableHead>{t("type")}</TableHead>
                      <TableHead>{t("category")}</TableHead>
                      <TableHead>{tc("status")}</TableHead>
                      <TableHead>{t("priority")}</TableHead>
                      <TableHead>{t("statistics")}</TableHead>
                      <TableHead className="text-right">{tc("actions")}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {appTools.map((tool) => (
                      <TableRow key={tool.id}>
                        <TableCell className="font-medium">{tool.tool_display_name}</TableCell>
                        <TableCell>
                          <Badge
                            className={
                              tool.tool_type === "native"
                                ? "bg-blue-100 text-blue-800"
                                : "bg-purple-100 text-purple-800"
                            }
                          >
                            {tool.tool_type === "native" ? t("nativeTool") : t("mcpTool")}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline">{tool.category}</Badge>
                        </TableCell>
                        <TableCell>
                          <Badge variant={tool.is_enabled ? "default" : "secondary"}>
                            {tool.is_enabled ? t("enabled") : t("disabled")}
                          </Badge>
                        </TableCell>
                        <TableCell>{tool.priority}</TableCell>
                        <TableCell>
                          {tool.statistics ? (
                            <div className="text-sm">
                              <div>
                                {t("calls")}: {tool.statistics.total_calls}
                              </div>
                              <div className="text-muted-foreground">
                                {t("successRate")}:{" "}
                                {(tool.statistics.success_rate * 100).toFixed(1)}%
                              </div>
                            </div>
                          ) : (
                            <span className="text-muted-foreground">-</span>
                          )}
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex items-center justify-end gap-2">
                            {checkSuperAdmin(user) && (
                              <>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => router.push(`/tools/${tool.tool_id}`)}
                                >
                                  <Settings className="h-4 w-4" />
                                </Button>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => {
                                    setSelectedAppToolId(tool.id);
                                    setUnbindDialogOpen(true);
                                  }}
                                >
                                  <Trash2 className="h-4 w-4 text-destructive" />
                                </Button>
                              </>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>

          {/* Skills 绑定区 */}
          <AppSkillsSection appId={appId} />

          {/* Skill 生效诊断（requires 门控去静默） */}
          <AppSkillDiagnostics appId={appId} onBindTools={() => setBindDialogOpen(true)} />

          {/* Agent.md 编辑区块 */}
          <AgentMdEditor
            appId={appId}
            platform={appInfo.platform}
            promptId={appInfo.prompt_id}
            onChanged={loadAppInfo}
          />
        </>
      )}

      {/* 绑定工具对话框 */}
      <BindToolsDialog
        open={bindDialogOpen}
        onClose={() => setBindDialogOpen(false)}
        boundToolIds={appTools.map((t) => t.tool_id)}
        onBind={handleBindTools}
      />

      {/* 解绑确认对话框 */}
      <AlertDialog open={unbindDialogOpen} onOpenChange={setUnbindDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("confirmUnbindTool")}</AlertDialogTitle>
            <AlertDialogDescription>{t("unbindToolWarning")}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{tc("cancel")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleUnbind}
              className="bg-destructive text-destructive-foreground"
            >
              {t("unbind")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

// 绑定工具对话框组件
function BindToolsDialog({
  open,
  onClose,
  boundToolIds,
  onBind,
}: {
  open: boolean;
  onClose: () => void;
  boundToolIds: number[];
  onBind: (toolIds: number[]) => void;
}) {
  const t = useTranslations("apps");
  const tc = useTranslations("common");
  const [selectedToolIds, setSelectedToolIds] = useState<number[]>([]);
  const [availableTools, setAvailableTools] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (open) {
      setLoading(true);
      axios
        .get("/api/tools?is_enabled=true")
        .then((res) => {
          const boundSet = new Set(boundToolIds);
          setAvailableTools((res.data?.tools || []).filter((t: any) => !boundSet.has(t.id)));
        })
        .catch(() => {
          setAvailableTools([]);
        })
        .finally(() => setLoading(false));
    } else {
      setSelectedToolIds([]);
      setAvailableTools([]);
    }
  }, [open, boundToolIds]);

  const handleToggle = (toolId: number) => {
    setSelectedToolIds((prev) =>
      prev.includes(toolId) ? prev.filter((id) => id !== toolId) : [...prev, toolId]
    );
  };

  const handleBind = () => {
    if (selectedToolIds.length > 0) {
      onBind(selectedToolIds);
      setSelectedToolIds([]);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t("bindTools")}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {loading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : availableTools.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">{t("allToolsBound")}</div>
          ) : (
            <div className="space-y-2">
              {availableTools.map((tool) => (
                <div
                  key={tool.id}
                  className="flex items-center space-x-3 p-3 border rounded-lg hover:bg-muted/50 cursor-pointer"
                  onClick={() => handleToggle(tool.id)}
                >
                  <Checkbox
                    checked={selectedToolIds.includes(tool.id)}
                    onCheckedChange={() => handleToggle(tool.id)}
                  />
                  <div className="flex-1">
                    <div className="font-medium">{tool.display_name}</div>
                    <div className="text-sm text-muted-foreground">{tool.description}</div>
                  </div>
                  <div className="flex gap-2">
                    <Badge
                      className={
                        tool.tool_type === "native"
                          ? "bg-blue-100 text-blue-800"
                          : "bg-purple-100 text-purple-800"
                      }
                    >
                      {tool.tool_type === "native" ? t("nativeTool") : t("mcpTool")}
                    </Badge>
                    <Badge variant="outline">{tool.category}</Badge>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {tc("cancel")}
          </Button>
          <Button onClick={handleBind} disabled={selectedToolIds.length === 0}>
            {selectedToolIds.length > 0
              ? t("bindCount", { count: selectedToolIds.length })
              : t("bind")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
