"use client";

import { use, useState, useEffect } from "react";
import { useTranslations } from "next-intl";
import { triggerLabel } from "@/lib/appTrigger";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useAppSkills } from "@/hooks/useAppSkills";
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
import AppAvatar from "../components/AppAvatar";
import ReviewLogDialog from "@/components/ReviewLogDialog";
import ReviewRejectDialog from "@/components/ReviewRejectDialog";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { checkSuperAdmin, checkTenantAdmin } from "@/lib/clientPermissions";
import { canEditApp } from "@/lib/appPermissions";
import { isSelfReview } from "@/lib/reviewQueue";
import { REVIEW_STATUSES, appStatusBadge, type ReviewStatus } from "@/lib/reviewStatus";
import axios from "@/lib/axios";
import { toast } from "sonner";

/**
 * 工具类型对应的文案键。workflow 行原先没有分支，`native ? 原生 : MCP` 把长任务
 * 标成了「MCP」。它是第三类：绑定它不是"给一个工具"，而是收窄这个数字员工的
 * 长任务范围（后端 Phase 3）。
 *
 * 返回键而不是接收 t：next-intl 的 translator 类型不是 `(k: string) => string`，
 * 传进来会类型不兼容；返回字面量联合则天然是合法键。
 */
function toolTypeKey(toolType: string): "nativeTool" | "workflowTool" | "mcpTool" {
  if (toolType === "native") return "nativeTool";
  if (toolType === "workflow") return "workflowTool";
  return "mcpTool";
}

function toolTypeClass(toolType: string) {
  if (toolType === "native") return "bg-blue-100 text-blue-800";
  if (toolType === "workflow") return "bg-amber-100 text-amber-800";
  return "bg-purple-100 text-purple-800";
}

interface AppInfo {
  id: number;
  name: string;
  description: string;
  app_type: string;
  platform: string;
  ai_model: string;
  /** 头像 URL：内置头像静态路径或上传后的 OSS 读代理路径；空=按名称生成占位 */
  avatar_url?: string | null;
  agent_md?: string | null;
  created_at: string;
  updated_at: string;
  settings?: Record<string, any>;
  /** P5 审核状态；后端并行开发中可能缺失（缺失时不渲染状态区，存量行为不变） */
  status?: ReviewStatus;
  visibility?: string;
  /** 创建者（提交人）用户ID，自审判定用 */
  user_id?: number | null;
  /** 作者显示名（nickname 优先退 username）。用户被删除时为空 */
  author?: string | null;
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
  // 只为了 tab 与摘要上那个数字。与 AppSkillsSection 用同一个 SWR key，
  // 请求被 dedupe，父子各调一次不会多打一轮。
  const { appSkills } = useAppSkills(appId);

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
    // 到分钟即可。秒对「这个员工什么时候建的」没有意义，只是把一行撑长
    return date.toLocaleString("zh-CN", {
      year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit",
    });
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
  // 绑工具/改配置 = owner 或超管（与后端 require_app_owner_or_super 同规矩）
  const canEditThisApp = canEditApp(appInfo, user, checkSuperAdmin(user));
  // 审核人不能审自己提交的对象（超管除外，后端违者 403）
  const selfReview = isSelfReview(user?.id, appInfo.user_id, checkSuperAdmin(user));
  // 状态徽标并入基本信息首行；动作/提示另起一行，且只在真有内容时渲染
  // 提交审核按钮已移到标题右侧，草稿态下这条 footer 便没有内容了——留着就是一条
  // 空的分隔线。rejected 仍要留：那里有"查看驳回理由"的链接，塞不进 hover。
  const reviewFooterVisible =
    status === "rejected" || (status === "pending_review" && canReview);

  return (
    <div
      className={
        isCustom ? "container mx-auto px-6 pt-0 pb-6 space-y-3" : "container mx-auto p-6 space-y-6"
      }
    >
      {/* 顶部：只有一个返回图标 + 面包屑。
          头像和描述都下沉到下面那张卡里 —— 同一个员工的身份信息散在两处，
          页头和卡片会重复显示一遍名字和描述。 */}
      <div className="flex items-center gap-2">
        <Button
          variant="outline"
          size="icon"
          className="h-9 w-9 shrink-0"
          onClick={() => router.push("/apps")}
          aria-label={t("back")}
          title={t("back")}
        >
          <ArrowLeft className="h-4 w-4" />
        </Button>
        {/* 面包屑：两级同字号，靠颜色和字重分主次。
            text-sm 太轻，压不住下面那张卡的标题，页面读起来没有层级 */}
        <nav className="flex items-center gap-2 text-lg">
          <button
            type="button"
            className="text-muted-foreground hover:text-foreground"
            onClick={() => router.push("/apps")}
          >
            {t("title")}
          </button>
          <span className="text-muted-foreground">/</span>
          <span className="font-semibold">{appInfo.name}</span>
        </nav>
      </div>

      {/* 应用基本信息（Custom 应用直接进自定义视图，不展示这块元信息）*/}
      {appInfo.app_type !== "Custom" && (
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-start justify-between gap-4">
              <div className="flex items-start gap-3 min-w-0">
                {/* 头像放在卡内：页头只留面包屑，身份信息集中在这一处 */}
                <AppAvatar src={appInfo.avatar_url} name={appInfo.name} size={44} />
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <CardTitle className="text-base">{appInfo.name}</CardTitle>
                    {statusBadge && (
                      <Badge variant={statusBadge.variant} className={statusBadge.className}>
                        {ts(statusBadge.labelKey)}
                      </Badge>
                    )}
                    {(status === "draft" || status === "rejected") && (
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7"
                        onClick={handleSubmitReview}
                        disabled={reviewActionPending}
                        title={status === "draft" ? tr("draftOwnerOnlyHint") : undefined}
                      >
                        <Send className="h-3.5 w-3.5 mr-1" />
                        {ts("submitReview")}
                      </Button>
                    )}
                  </div>
                  {/* 副标题：说明 · 触发方式 · 平台。描述可能为空，空时不留下孤零零的分隔点 */}
                  <p className="text-sm text-muted-foreground mt-0.5">
                    {[appInfo.description, triggerLabel(appInfo.app_type, t), appInfo.platform]
                      .filter(Boolean)
                      .join(" · ")}
                  </p>
                </div>
              </div>
              {/* 元信息三行，贴卡片右上角 */}
              <div className="text-right text-xs text-muted-foreground shrink-0 space-y-0.5">
                <div>
                  {t("aiModel")} <span className="text-foreground">{appInfo.ai_model}</span>
                </div>
                {/* 作者可能为 null（用户已删）：给 — 而不是整行消失，
                    否则「没有作者」和「没渲染这一行」看起来一样 */}
                <div>
                  {t("author")} <span className="text-foreground">{appInfo.author || "—"}</span>
                </div>
                <div>{formatDate(appInfo.created_at)}</div>
              </div>
            </div>
          </CardHeader>
          <CardContent className="pt-0">
            <div className="flex flex-wrap items-center gap-2">
              {/* 汇总在 summary 子对象里，不在顶层——取错层级会得到 undefined，
                  再乘 100 就渲染成「成功率 NaN%」（改版初稿正是这个 bug） */}
              {statistics?.summary && appTools.length > 0 && (
                <>
                  <Badge variant="secondary" className="font-normal">
                    {t("calls")} {statistics.summary.total_calls}
                  </Badge>
                  <Badge variant="secondary" className="font-normal">
                    {t("successRate")}{" "}
                    {((statistics.summary.success_rate ?? 0) * 100).toFixed(1)}%
                  </Badge>
                </>
              )}
            </div>

            {reviewFooterVisible && (
              <div className="col-span-2 md:col-span-3 lg:col-span-6 pt-2 border-t">
                <div className="flex items-center gap-2 flex-wrap">
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
          /* 四个 tab 取代原先六块竖排。此前要看 Agent.md 得滚过工具表和
             Skill 列表；分 tab 后每一块都在第一屏，切换成本一次点击。
             每块内部的数据获取、权限判断、保存逻辑逐行原样搬，未改动。 */
          <Tabs defaultValue="persona" className="w-full">
            <TabsList>
              <TabsTrigger value="persona">{t("tabPersona")}</TabsTrigger>
              <TabsTrigger value="skills">
                {t("tabSkills")}
                <span className="ml-1.5 text-muted-foreground">{appSkills.length}</span>
              </TabsTrigger>
              <TabsTrigger value="tools">
                {t("tabTools")}
                <span className="ml-1.5 text-muted-foreground">{appTools.length}</span>
              </TabsTrigger>
              <TabsTrigger value="memory">{t("tabMemory")}</TabsTrigger>
            </TabsList>

            <TabsContent value="persona" className="mt-4">
            {/* Agent.md 编辑区块 */}
            <AgentMdEditor
              appId={appId}
              ownerUserId={appInfo.user_id}
              platform={appInfo.platform}
              onChanged={loadAppInfo}
            />

            </TabsContent>

            <TabsContent value="skills" className="mt-4 space-y-4">
            {/* Skills 绑定区 */}
            <AppSkillsSection appId={appId} ownerUserId={appInfo.user_id} />
            {/* Skill 生效诊断（requires 门控去静默） */}
            <AppSkillDiagnostics appId={appId} onBindTools={() => setBindDialogOpen(true)} />

            </TabsContent>

            <TabsContent value="tools" className="mt-4">
            {/* 已绑定工具列表。绑定入口放在本区标题右侧（与 AppSkillsSection 一致）：
                操作和它作用的对象在一起，比留在页头更好找。 */}
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle>{t("boundTools", { count: appTools.length })}</CardTitle>
                  {canEditThisApp && (
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
                              className={toolTypeClass(tool.tool_type)}
                            >
                              {t(toolTypeKey(tool.tool_type))}
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
                              {canEditThisApp && (
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

            </TabsContent>

            <TabsContent value="memory" className="mt-4">
              {/* 平台尚无「记忆」概念。占位而不是留白：让用户知道这一块
                  是规划中的，而不是加载失败或权限不足 */}
              <Card>
                <CardContent className="py-10 text-center text-sm text-muted-foreground">
                  {t("memoryNotEnabled")}
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>
        )}

      {/* 绑定工具对话框 */}
      <BindToolsDialog
        open={bindDialogOpen}
        onClose={() => setBindDialogOpen(false)}
        boundToolIds={appTools.map((t) => t.tool_id)}
        boundHasWorkflow={appTools.some((t) => t.tool_type === "workflow")}
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
  boundHasWorkflow,
  onBind,
}: {
  open: boolean;
  onClose: () => void;
  boundToolIds: number[];
  /** 这个应用是否已经绑过长任务——决定要不要提示"绑了就只剩绑定的" */
  boundHasWorkflow: boolean;
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
              {/*
                绑第一个长任务会把这个数字员工从"全部长任务"切成"只有已绑定的"
                （后端 Phase 3：未绑 = 不限制）。不说出来就是个静默陷阱——管理员
                以为在加一项能力，实际上同时移除了其余所有长任务。
                只在真要发生这件事时才提示：本次选中了长任务、且原先一个都没绑。
              */}
              {selectedToolIds.some(
                (id) => availableTools.find((x) => x.id === id)?.tool_type === "workflow"
              ) &&
                !boundHasWorkflow && (
                  <p className="text-xs rounded-md border border-amber-500/50 text-amber-600 dark:text-amber-400 px-3 py-2">
                    {t("workflowBindNotice")}
                  </p>
                )}
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
                      className={toolTypeClass(tool.tool_type)}
                    >
                      {t(toolTypeKey(tool.tool_type))}
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
