"use client";

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { useTranslations } from "next-intl";
import { triggerLabel } from "@/lib/appTrigger";
import { canEditApp } from "@/lib/appPermissions";
import AppAvatarPicker from "./components/AppAvatarPicker";
import AppAvatar from "./components/AppAvatar";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Plus,
  Edit,
  Trash2,
  Send,
  Smartphone,
  Globe,
  MessageCircle,
  Loader2,
  Network,
  FileText,
  Code,
  List,
  X,
  Sparkles,
  LayoutGrid,
} from "lucide-react";
import { appStatusBadge, type ReviewStatus } from "@/lib/reviewStatus";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import axios from "@/lib/axios";
import { toast } from "sonner";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { checkSuperAdmin } from "@/lib/clientPermissions";
import WorkflowEditor from "./components/WorkflowEditor";
import { syncFormToWorkflow } from "@/lib/workflowUtils";
import { WorkflowConfig } from "@/types/workflow";
import { FeedItemsDialog } from "./components/subscription-agent/FeedItemsDialog";
import { SummaryListDialog } from "./components/subscription-agent/SummaryListDialog";
import { ScheduleConfigSection } from "./components/subscription-agent/ScheduleConfigSection";
import type { StreamFeedFormItem, ScheduleSettings } from "@/types/subscription-agent";

// 类型定义
interface App {
  id: number;
  name: string;
  description: string;
  app_type: "Chat" | "Subscription" | "Email" | "Custom" | "Tool" | "Plugin";
  platform: "Web" | "Wechat" | "Plugin" | "Feishu" | "iOS" | "Android";
  avatar_url?: string | null;
  user_id: number;
  ai_model: string;
  agent_md?: string | null;
  dataset_ids: string[];
  tool_count?: number;
  skill_count?: number;
  email?: string;
  settings: Record<string, any>;
  created_at: string;
  updated_at: string;
  is_default?: boolean;
  /** P5 审核状态；后端并行开发中可能缺失（缺失时不渲染状态徽标，存量行为不变） */
  status?: ReviewStatus;
  visibility?: string;
  owner_dept_id?: number | null;
  owner_tenant_id?: number | null;
}

// 徽标规则见 lib/reviewStatus.ts 的 appStatusBadge：published 与非法/缺失 status 均不出徽标

/** draft / rejected 可（重新）提交审核 */
const canSubmitAppReview = (app: App) => app.status === "draft" || app.status === "rejected";

interface Dataset {
  id: string;
  name: string;
  dimension?: number;
}

interface WechatAgent {
  agentid: number;
  name: string;
  square_logo_url: string;
  description: string;
}

// 平台图标映射
const platformIcons: Record<string, any> = {
  Web: Globe,
  Wechat: MessageCircle,
  Feishu: MessageCircle,
  iOS: Smartphone,
  Android: Smartphone,
};

// 触发方式与平台标签一律中性灰（Badge 的 secondary）。
//
// 原先每个取值一种颜色：紫、绿、黄、蓝、翠、橙……一屏卡片下来像调色板，而这些
// 颜色不承载任何含义——"聊天"是紫的、"Web"也是紫的，读者得先学会一套配色表才
// 知道颜色没在说话。真正需要抢眼的是异常状态（草稿/待审/驳回，见 reviewStatus），
// 颜色留给它们才有对比度。详情页那两个标签一直是中性的 outline，这里跟它对齐。


// 判断是否为订阅聚合应用
const isStreamApp = (app: App) => app.app_type === "Subscription";

export default function AppsPage() {
  const router = useRouter();
  const { user } = useCurrentUser();
  const isSuperAdmin = checkSuperAdmin(user);
  const t = useTranslations("apps");
  const tc = useTranslations("common");
  const ts = useTranslations("skills");

  const [apps, setApps] = useState<App[]>([]);
  /** 超管的租户筛选。"all" = 不筛。 */
  const [tenantFilter, setTenantFilter] = useState<string>("all");
  const [tenants, setTenants] = useState<{ id: number; name: string }[]>([]);

  /**
   * 按租户筛选后的列表。
   *
   * **这是便利筛选，不是权限边界** —— 后端已经按角色收窄过 `/api/v1/apps`，
   * 非超管本来就只拿得到自己看得见的那些。这里只是让超管在一堆租户里挑一个看，
   * 前端过滤改变不了任何人能拿到什么。
   */
  const visibleApps = useMemo(() => {
    if (!isSuperAdmin || tenantFilter === "all") return apps;
    if (tenantFilter === "none") return apps.filter((a) => !a.owner_tenant_id);
    return apps.filter((a) => String(a.owner_tenant_id) === tenantFilter);
  }, [apps, isSuperAdmin, tenantFilter]);

  /** 只在真的存在未归属应用时才给这个选项，免得挂一个永远为空的条目。 */
  const hasUnassigned = useMemo(() => apps.some((a) => !a.owner_tenant_id), [apps]);
  const [datasets, setDatasets] = useState<Dataset[]>([]);
  const [wechatAgents, setWechatAgents] = useState<WechatAgent[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingApp, setEditingApp] = useState<App | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [deletingApp, setDeletingApp] = useState<App | null>(null);
  const [loadingWechatAgents, setLoadingWechatAgents] = useState(false);
  const [workflowDialogOpen, setWorkflowDialogOpen] = useState(false);
  const [workflowApp, setWorkflowApp] = useState<App | null>(null);
  const [templateDialogOpen, setTemplateDialogOpen] = useState(false);
  const [creatingFromTemplate, setCreatingFromTemplate] = useState(false);
  const [selectedTemplate, setSelectedTemplate] = useState<string | null>(null);

  const [embedDialogOpen, setEmbedDialogOpen] = useState(false);
  const [embedAppId, setEmbedAppId] = useState<string>("");

  // Stream Agent 相关状态
  const [feedItemsDialogOpen, setFeedItemsDialogOpen] = useState(false);
  const [summaryListDialogOpen, setSummaryListDialogOpen] = useState(false);
  const [selectedStreamApp, setSelectedStreamApp] = useState<App | null>(null);
  const [streamFeeds, setStreamFeeds] = useState<StreamFeedFormItem[]>([]);
  const [newStreamUrl, setNewStreamUrl] = useState("");
  const [addingFeed, setAddingFeed] = useState(false);
  const [viewMode, setViewMode] = useState<"table" | "grid">("grid");
  const [autoSelectDatasets, setAutoSelectDatasets] = useState(true);

  // 自动选择第一个应用作为默认嵌入对象
  useEffect(() => {
    if (embedDialogOpen && apps.length > 0 && !embedAppId) {
      setEmbedAppId(apps[0].id.toString());
    }
  }, [embedDialogOpen, apps, embedAppId]);

  // 使用 ref 跟踪是否已加载数据，避免严格模式下的重复请求
  const dataLoadedRef = useRef(false);

  // 表单状态
  const [formData, setFormData] = useState<{
    name: string;
    description: string;
    app_type: "Chat" | "Subscription" | "Email" | "Custom" | "Tool" | "Plugin";
    platform: "Web" | "Wechat" | "Plugin" | "Feishu" | "iOS" | "Android";
    // 空串 = 用户主动清空（后端据此落 NULL）；null = 本来就没设过
    avatar_url: string | null;
    ai_model: string;
      dataset_ids: string[];
    email?: string;
    settings: Record<string, any>;
    is_default?: boolean;
  }>({
    name: "",
    description: "",
    app_type: "Chat",
    platform: "Web",
    avatar_url: null,
    ai_model: "deepseek",
    dataset_ids: [],
    email: "",
    settings: {},
    is_default: false,
  });

  // 定义加载函数（必须在 useEffect 之前）
  const loadApps = useCallback(async () => {
    try {
      setLoading(true);
      const response = await axios.get("/api/v1/apps");
      setApps(response.data.items || []);
    } catch (error: any) {
      toast.error(error.response?.data?.detail || t("operationFailed"));
    } finally {
      setLoading(false);
    }
  }, [t]);

  const loadDatasets = useCallback(async () => {
    try {
      const response = await axios.get("/api/datasets");
      setDatasets(response.data || []);
    } catch {
      // silently fail - datasets will show as empty
    }
  }, []);


  const loadWechatAgents = useCallback(async () => {
    try {
      setLoadingWechatAgents(true);
      const response = await axios.get("/api/v1/wechat/agents");
      const agents = response.data.agents || [];
      setWechatAgents(agents);
    } catch {
      toast.error(t("operationFailed"));
    } finally {
      setLoadingWechatAgents(false);
    }
  }, [t]);

  // 加载数据（只在首次挂载时调用一次，避免严格模式的重复请求）
  useEffect(() => {
    if (dataLoadedRef.current) return;

    dataLoadedRef.current = true;

    // 并行加载所有数据
    Promise.all([loadApps(), loadDatasets()]).catch(() => {
      dataLoadedRef.current = false;
    });

    // 租户列表只给超管用（接口本身也只对超管返回全部）。失败就静默留空 ——
    // 筛选器不出现、列表照常；一个可选的筛选控件不该让整页挂掉。
    axios
      .get("/api/organization/tenants")
      .then((r) => setTenants(r.data?.tenants ?? []))
      .catch(() => setTenants([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // 不依赖 isSuperAdmin，所有人都可以加载数据

  // 当平台改变为微信时，加载微信应用列表
  useEffect(() => {
    if (dialogOpen && formData.platform === "Wechat") {
      loadWechatAgents();
    }
  }, [formData.platform, dialogOpen, loadWechatAgents]);

  // 添加 Stream URL（立即请求 API 创建订阅）
  const handleAddStreamUrl = useCallback(async () => {
    if (!newStreamUrl) return;
    setAddingFeed(true);
    try {
      const res = await axios.post("/api/v1/subscription-agent/feeds", {
        url: newStreamUrl,
      });
      const feedId = res.data.id;
      setStreamFeeds((prev) => {
        // 检查是否已存在，避免重复添加
        if (prev.some((f) => f.id === feedId)) {
          return prev;
        }
        return [
          ...prev,
          {
            id: feedId,
            url: res.data.source_url || res.data.url || newStreamUrl,
            name: res.data.name,
            platform: res.data.platform,
          },
        ];
      });
      setNewStreamUrl("");
      toast.success(t("subscriptionAdded", { name: res.data.name || newStreamUrl }));
    } catch (error: any) {
      toast.error(error.response?.data?.message || t("addSubscriptionFailed"));
    } finally {
      setAddingFeed(false);
    }
  }, [newStreamUrl]);

  // 删除订阅（从本地列表移除）
  const handleRemoveStreamFeed = useCallback((feedId: string) => {
    setStreamFeeds((prev) => prev.filter((f) => f.id !== feedId));
  }, []);

  // Default schedule settings
  const defaultScheduleSettings: ScheduleSettings = {
    enabled: false,
    time: "10:00",
    timezone: "Asia/Shanghai",
    report_type: "daily",
  };

  // 打开创建对话框
  const handleCreate = useCallback(() => {
    setEditingApp(null);
    setFormData({
      name: "",
      description: "",
      app_type: "Chat",
      platform: "Web",
      avatar_url: null,
      ai_model: "deepseek",
        dataset_ids: [],
      email: "",
      settings: {},
      is_default: false,
    });
    setStreamFeeds([]);
    setNewStreamUrl("");
    setAutoSelectDatasets(true);
    setDialogOpen(true);
  }, []);

  // 打开模板选择对话框
  const handleCreateFromTemplate = useCallback(() => {
    setTemplateDialogOpen(true);
    setSelectedTemplate(null); // 重置选择状态
  }, []);

  // 创建质量分类智能体
  const handleCreateQualityAgent = useCallback(async () => {
    try {
      setCreatingFromTemplate(true);

      const qualityAgentData = {
        name: t("qualityAgent"),
        description: t("qualityAgentDesc"),
        app_type: "Chat" as const,
        platform: "Web" as const,
        ai_model: "deepseek",
            dataset_ids: ["quality_knowledge_base"], // 使用质量知识库
        settings: {
          workflow: {
            nodes: [
              {
                id: "input-1",
                type: "inputNode",
                position: { x: 100, y: 100 },
                data: {
                  name: t("templateEmployeeFeedback"),
                  type: "input",
                  platform: "Web",
                },
              },
              {
                id: "input-2",
                type: "inputNode",
                position: { x: 100, y: 250 },
                data: {
                  name: t("templateWechatWork"),
                  type: "input",
                  platform: "Wechat",
                },
              },
              {
                id: "input-3",
                type: "inputNode",
                position: { x: 100, y: 400 },
                data: {
                  name: t("templateEmail"),
                  type: "input",
                  platform: "Web",
                },
              },
              {
                id: "ai-1",
                type: "aiNode",
                position: { x: 400, y: 250 },
                data: {
                  name: t("templateQualityClassification"),
                  type: "ai",
                  aiModel: "deepseek",
                  agentType: "quality_classify",
                  knowledgeBase: t("templateQualityKnowledgeBase"),
                },
              },
              {
                id: "human-1",
                type: "humanNode",
                position: { x: 700, y: 250 },
                data: {
                  name: t("templateQeConfirmation"),
                  operator: t("templateQualityEngineer"),
                  detail: t("templateQeConfirmDetail"),
                  phase: t("templateManualReview"),
                },
              },
              {
                id: "system-1",
                type: "systemNode",
                position: { x: 1000, y: 250 },
                data: {
                  name: t("templateQmsSystem"),
                  systemType: t("templateDatabaseType"),
                  operation: t("templateDataEntry"),
                  detail: t("templateQmsDetail"),
                },
              },
            ],
            edges: [
              { id: "e1", source: "input-1", target: "ai-1" },
              { id: "e2", source: "input-2", target: "ai-1" },
              { id: "e3", source: "input-3", target: "ai-1" },
              { id: "e4", source: "ai-1", target: "human-1" },
              { id: "e5", source: "human-1", target: "system-1" },
            ],
          },
        },
      };

      await axios.post("/api/v1/apps", qualityAgentData);
      toast.success(t("qualityAgentCreated"));
      setTemplateDialogOpen(false);
      setSelectedTemplate(null);
      loadApps();
    } catch (error: any) {
      toast.error(error.response?.data?.detail || t("operationFailed"));
    } finally {
      setCreatingFromTemplate(false);
    }
  }, [loadApps]);

  // 选择模板
  const handleSelectTemplate = useCallback((templateId: string) => {
    setSelectedTemplate(templateId);
  }, []);

  // 创建选中的模板
  const handleCreateSelectedTemplate = useCallback(async () => {
    if (selectedTemplate === "quality-agent") {
      await handleCreateQualityAgent();
    }
  }, [selectedTemplate, handleCreateQualityAgent]);

  // 打开编辑对话框
  const handleEdit = useCallback(async (app: App) => {
    setEditingApp(app);
    const datasetIds = app.dataset_ids || [];
    setFormData({
      name: app.name,
      description: app.description,
      app_type: app.app_type,
      platform: app.platform,
      avatar_url: app.avatar_url ?? null,
      ai_model: app.ai_model,
      dataset_ids: datasetIds,
      email: app.email || "",
      settings: app.settings || {},
      is_default: app.is_default || false,
    });
    // 如果 dataset_ids 为空，则自动选择知识库为 true，否则为 false
    setAutoSelectDatasets(datasetIds.length === 0);

    // 如果是 Stream 应用，加载已有的订阅信息
    if (isStreamApp(app) && app.settings?.stream_feed_ids?.length > 0) {
      // 优先从 settings.stream_feeds 读取（包含完整的 url 信息）
      if (app.settings?.stream_feeds?.length > 0) {
        setStreamFeeds(app.settings.stream_feeds);
      } else {
        // 兼容旧数据：从 API 获取
        try {
          const feedPromises = app.settings.stream_feed_ids.map((id: string) =>
            axios.get(`/api/v1/subscription-agent/feeds/${id}`)
          );
          const responses = await Promise.all(feedPromises);
          setStreamFeeds(
            responses.map((r) => ({
              id: r.data.id,
              url: r.data.source_url || r.data.url || "",
              name: r.data.name,
              platform: r.data.platform,
            }))
          );
        } catch {
          setStreamFeeds([]);
        }
      }
    } else {
      setStreamFeeds([]);
    }
    setNewStreamUrl("");
    setDialogOpen(true);
  }, []);

  // 提交表单
  const handleSubmit = useCallback(async () => {
    if (!formData.name.trim()) {
      toast.error(tc("required"));
      return;
    }

    try {
      setSubmitting(true);

      let submitData: any;

      // Stream 应用特殊处理
      if (formData.app_type === "Subscription") {
        submitData = {
          ...formData,
          settings: {
            ...formData.settings,
            stream_feed_ids: streamFeeds.map((f) => f.id),
            // 保存完整的 feed 信息，因为外部 API 可能不返回 url
            stream_feeds: streamFeeds.map((f) => ({
              id: f.id,
              url: f.url,
              name: f.name,
              platform: f.platform,
            })),
          },
        };
      } else {
        // 同步表单数据到工作流配置
        const workflow = syncFormToWorkflow(
          { ...formData },
          editingApp?.settings?.workflow,
          datasets
        );

        submitData = {
          ...formData,
          settings: {
            ...formData.settings,
            workflow,
          },
        };
      }

      if (editingApp) {
        // 更新
        await axios.put(`/api/v1/apps/${editingApp.id}`, submitData);
        toast.success(t("appUpdated"));
      } else {
        // 创建
        await axios.post("/api/v1/apps", submitData);
        toast.success(t("appCreated"));
      }
      setDialogOpen(false);
      loadApps();
    } catch (error: any) {
      const detail = error.response?.data?.detail;
      const message =
        typeof detail === "string"
          ? detail
          : Array.isArray(detail)
            ? detail.map((e: any) => e.msg || e.message).join(", ")
            : t("operationFailed");
      toast.error(message);
    } finally {
      setSubmitting(false);
    }
  }, [formData, editingApp, loadApps, datasets, streamFeeds]);

  // 提交应用审核（draft/rejected → pending_review；建即 draft，仅 owner 可测）
  const handleSubmitAppReview = useCallback(
    async (app: App) => {
      try {
        await axios.post(`/api/v1/apps/${app.id}/submit-review`);
        toast.success(ts("submitReviewSuccess"));
        loadApps();
      } catch (error: any) {
        const detail = error.response?.data?.detail;
        toast.error(typeof detail === "string" ? detail : t("operationFailed"));
      }
    },
    [loadApps, t, ts]
  );

  // 删除应用
  const handleDelete = useCallback(async () => {
    if (!deletingApp) return;

    try {
      // 如果是 Stream 应用，同时删除关联的所有订阅
      if (isStreamApp(deletingApp) && deletingApp.settings?.stream_feed_ids?.length > 0) {
        for (const feedId of deletingApp.settings.stream_feed_ids) {
          try {
            await axios.delete(`/api/v1/subscription-agent/feeds/${feedId}`);
          } catch (error) {
            console.error(`删除订阅 ${feedId} 失败:`, error);
          }
        }
      }

      await axios.delete(`/api/v1/apps/${deletingApp.id}`);
      toast.success(t("appDeleted"));
      setDeleteConfirmOpen(false);
      setDeletingApp(null);
      loadApps();
    } catch (error: any) {
      toast.error(error.response?.data?.detail || t("operationFailed"));
    }
  }, [deletingApp, loadApps, t]);

  return (
    <div className="container mx-auto p-6 space-y-6">
      <Card className="border">
        <CardHeader className="px-6 py-4 border-b">
          <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
            <div className="space-y-1">
              <CardTitle className="text-2xl font-bold text-foreground whitespace-nowrap">
                {t("title")}
              </CardTitle>
              <p className="text-sm text-muted-foreground leading-relaxed">{t("description")}</p>
            </div>
            <div className="flex flex-wrap gap-2 justify-end shrink-0">
              {/* P5 开放自建：普通用户也可创建（建即 draft，走提交审核） */}
              <Button onClick={handleCreate}>
                <Plus className="h-4 w-4 mr-2" />
                {t("createApp")}
              </Button>
              {isSuperAdmin && (
                <>
                  <Button variant="outline" onClick={handleCreateFromTemplate}>
                    <FileText className="h-4 w-4 mr-2" />
                    {t("appTemplate")}
                  </Button>
                  <Button variant="outline" onClick={() => setEmbedDialogOpen(true)}>
                    <Code className="h-4 w-4 mr-2" />
                    {t("websiteEmbed")}
                  </Button>
                </>
              )}
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-6">
          {loading ? (
            <div className="flex flex-col justify-center items-center py-20 space-y-4">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
              <p className="text-sm text-muted-foreground">{t("loadingApps")}</p>
            </div>
          ) : apps.length === 0 ? (
            <div className="flex flex-col justify-center items-center py-20 space-y-4">
              <div className="w-20 h-20 rounded-full bg-muted flex items-center justify-center">
                <Sparkles className="h-10 w-10 text-muted-foreground" />
              </div>
              <div className="text-center space-y-2">
                <h3 className="text-lg font-semibold text-foreground">{t("noApps")}</h3>
                <p className="text-sm text-muted-foreground max-w-md">{t("noAppsDesc")}</p>
              </div>
              <Button onClick={handleCreate} size="lg" className="mt-4">
                <Plus className="h-4 w-4 mr-2" />
                {t("createApp")}
              </Button>
            </div>
          ) : (
            <>
              {/* 视图切换和统计信息 */}
              <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-6 pb-4 border-b">
                <div className="flex items-center gap-4">
                  <span className="text-sm font-medium text-muted-foreground">
                    {t("totalApps", { count: visibleApps.length })}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  {/* 租户筛选：仅超管可见。
                      非超管本来就只拿得到自己租户的应用（后端收窄），给他一个
                      只有一个选项的下拉是噪音。 */}
                  {isSuperAdmin && tenants.length > 0 && (
                    <Select value={tenantFilter} onValueChange={setTenantFilter}>
                      <SelectTrigger className="h-9 w-[180px]">
                        <SelectValue placeholder={t("filterByTenant")} />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">{t("allTenants")}</SelectItem>
                        {tenants.map((tn) => (
                          <SelectItem key={tn.id} value={String(tn.id)}>
                            {tn.name}
                          </SelectItem>
                        ))}
                        {hasUnassigned && (
                          <SelectItem value="none">{t("unassignedTenant")}</SelectItem>
                        )}
                      </SelectContent>
                    </Select>
                  )}
                  <Button
                    variant={viewMode === "table" ? "default" : "outline"}
                    size="sm"
                    onClick={() => setViewMode("table")}
                  >
                    <List className="h-4 w-4" />
                  </Button>
                  <Button
                    variant={viewMode === "grid" ? "default" : "outline"}
                    size="sm"
                    onClick={() => setViewMode("grid")}
                  >
                    <LayoutGrid className="h-4 w-4" />
                  </Button>
                </div>
              </div>
              {/* 筛完一个都不剩，要说清是筛没了、不是没有应用 ——
                  否则用户会以为这个租户下的应用被删了。 */}
              {visibleApps.length === 0 ? (
                <div className="py-16 text-center">
                  <p className="text-sm text-muted-foreground">{t("noAppsForTenant")}</p>
                  <Button
                    variant="link"
                    size="sm"
                    className="mt-1"
                    onClick={() => setTenantFilter("all")}
                  >
                    {t("clearTenantFilter")}
                  </Button>
                </div>
              ) : viewMode === "table" ? (
                <div className="rounded-lg border overflow-hidden">
                  <Table>
                    <TableHeader>
                      <TableRow className="bg-muted/50 hover:bg-muted/50">
                        <TableHead className="font-semibold">{t("tableHeaderAppName")}</TableHead>
                        <TableHead className="font-semibold">{tc("status")}</TableHead>
                        <TableHead className="font-semibold">{t("tableHeaderType")}</TableHead>
                        <TableHead className="font-semibold">{t("tableHeaderPlatform")}</TableHead>
                        <TableHead className="font-semibold">{t("tableHeaderAiModel")}</TableHead>
                        <TableHead className="font-semibold">{t("tableHeaderDatasets")}</TableHead>
                        <TableHead className="font-semibold">{t("tableHeaderTools")}</TableHead>
                        <TableHead className="font-semibold">{t("tableHeaderSkills")}</TableHead>
                        <TableHead className="font-semibold">
                          {t("tableHeaderCreatedTime")}
                        </TableHead>
                        <TableHead className="text-right font-semibold">
                          {t("tableHeaderActions")}
                        </TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {visibleApps.map((app) => {
                        const PlatformIcon = platformIcons[app.platform] || Globe;
                        return (
                          <TableRow key={app.id} className="hover:bg-muted/30 transition-colors">
                            <TableCell>
                              <div className="flex items-center gap-3">
                                <AppAvatar src={app.avatar_url} name={app.name} size={32} />
                                <div className="space-y-1 min-w-0">
                                <div className="font-semibold flex items-center gap-2">
                                  <Link
                                    href={`/apps/${app.id}`}
                                    className="hover:text-primary transition-colors hover:underline"
                                  >
                                    {app.name}
                                  </Link>
                                  {app.is_default && (
                                    <Badge
                                      variant="outline"
                                      className="text-xs bg-primary/10 text-primary border-primary/30 font-medium"
                                    >
                                      {t("default")}
                                    </Badge>
                                  )}
                                </div>
                                {app.platform === "Wechat" && app.settings?.wechat?.agent_id && (
                                  <div className="text-xs text-muted-foreground mt-1">
                                    ID: {app.settings.wechat.agent_id}
                                  </div>
                                )}
                                </div>
                              </div>
                            </TableCell>
                            <TableCell>
                              {(() => {
                                const badge = appStatusBadge(app.status);
                                return badge ? (
                                  <Badge variant={badge.variant} className={badge.className}>
                                    {ts(badge.labelKey)}
                                  </Badge>
                                ) : (
                                  <span className="text-xs text-muted-foreground">-</span>
                                );
                              })()}
                            </TableCell>
                            <TableCell>
                              <Badge variant="secondary" className="font-medium">
                                {triggerLabel(app.app_type, t)}
                              </Badge>
                            </TableCell>
                            <TableCell>
                              <Badge variant="secondary" className="font-medium">
                                <PlatformIcon className="h-3 w-3 mr-1" />
                                {app.platform}
                              </Badge>
                            </TableCell>
                            <TableCell>
                              <code className="text-xs bg-muted px-2.5 py-1 rounded font-mono font-medium">
                                {app.ai_model}
                              </code>
                            </TableCell>
                            <TableCell>
                              {/* 同卡片：0 表示"默认全库智能选"，不是没有。表格是固定列，
                                  不能整格省掉，所以用 — 而不是 0。*/}
                              <span className="text-sm font-medium text-muted-foreground">
                                {app.dataset_ids?.length ? app.dataset_ids.length : "—"}
                              </span>
                            </TableCell>
                            <TableCell>
                              <span className="text-sm font-medium text-muted-foreground">
                                {app.tool_count || 0}
                              </span>
                            </TableCell>
                            <TableCell>
                              <span className="text-sm font-medium text-muted-foreground">
                                {app.skill_count || 0}
                              </span>
                            </TableCell>
                            <TableCell>
                              <span className="text-sm text-muted-foreground">
                                {new Date(app.created_at).toLocaleDateString()}
                              </span>
                            </TableCell>
                            <TableCell className="text-right">
                              <div className="flex justify-end gap-1">
                                {/* Stream 应用特有操作 */}
                                {isStreamApp(app) && (
                                  <>
                                    <TooltipProvider>
                                      <Tooltip>
                                        <TooltipTrigger asChild>
                                          <Button
                                            variant="ghost"
                                            size="icon"
                                            onClick={() => {
                                              setSelectedStreamApp(app);
                                              setFeedItemsDialogOpen(true);
                                            }}
                                            className="h-8 w-8 hover:bg-primary/10 hover:text-primary"
                                          >
                                            <List className="h-4 w-4" />
                                          </Button>
                                        </TooltipTrigger>
                                        <TooltipContent>{t("viewContent")}</TooltipContent>
                                      </Tooltip>
                                    </TooltipProvider>
                                    <TooltipProvider>
                                      <Tooltip>
                                        <TooltipTrigger asChild>
                                          <Button
                                            variant="ghost"
                                            size="icon"
                                            onClick={() => {
                                              setSelectedStreamApp(app);
                                              setSummaryListDialogOpen(true);
                                            }}
                                            className="h-8 w-8 hover:bg-green-500/10 hover:text-green-600"
                                          >
                                            <FileText className="h-4 w-4" />
                                          </Button>
                                        </TooltipTrigger>
                                        <TooltipContent>{t("viewReport")}</TooltipContent>
                                      </Tooltip>
                                    </TooltipProvider>
                                  </>
                                )}
                                {/* 非 Stream 应用显示工作流按钮 */}
                                {!isStreamApp(app) && (
                                  <TooltipProvider>
                                    <Tooltip>
                                      <TooltipTrigger asChild>
                                        <Button
                                          variant="ghost"
                                          size="icon"
                                          onClick={() => {
                                            setWorkflowApp(app);
                                            setWorkflowDialogOpen(true);
                                          }}
                                          className="h-8 w-8 hover:bg-purple-500/10 hover:text-purple-600"
                                        >
                                          <Network className="h-4 w-4" />
                                        </Button>
                                      </TooltipTrigger>
                                      <TooltipContent>{t("workflowConfig")}</TooltipContent>
                                    </Tooltip>
                                  </TooltipProvider>
                                )}
                                {canSubmitAppReview(app) && (
                                  <TooltipProvider>
                                    <Tooltip>
                                      <TooltipTrigger asChild>
                                        <Button
                                          variant="ghost"
                                          size="icon"
                                          onClick={() => handleSubmitAppReview(app)}
                                          className="h-8 w-8 hover:bg-blue-500/10 hover:text-blue-600"
                                        >
                                          <Send className="h-4 w-4" />
                                        </Button>
                                      </TooltipTrigger>
                                      <TooltipContent>{ts("submitReview")}</TooltipContent>
                                    </Tooltip>
                                  </TooltipProvider>
                                )}
                                {canEditApp(app, user, isSuperAdmin) && (
                                  <>
                                    <TooltipProvider>
                                      <Tooltip>
                                        <TooltipTrigger asChild>
                                          <Button
                                            variant="ghost"
                                            size="icon"
                                            onClick={() => handleEdit(app)}
                                            className="h-8 w-8 hover:bg-primary/10 hover:text-primary"
                                          >
                                            <Edit className="h-4 w-4" />
                                          </Button>
                                        </TooltipTrigger>
                                        <TooltipContent>{tc("edit")}</TooltipContent>
                                      </Tooltip>
                                    </TooltipProvider>
                                    <TooltipProvider>
                                      <Tooltip>
                                        <TooltipTrigger asChild>
                                          <Button
                                            variant="ghost"
                                            size="icon"
                                            onClick={() => {
                                              setDeletingApp(app);
                                              setDeleteConfirmOpen(true);
                                            }}
                                            className="h-8 w-8 hover:bg-destructive/10 hover:text-destructive"
                                          >
                                            <Trash2 className="h-4 w-4" />
                                          </Button>
                                        </TooltipTrigger>
                                        <TooltipContent>{tc("delete")}</TooltipContent>
                                      </Tooltip>
                                    </TooltipProvider>
                                  </>
                                )}
                              </div>
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {visibleApps.map((app) => {
                    const PlatformIcon = platformIcons[app.platform] || Globe;
                    const isDefault = app.is_default;
                    return (
                      <Card
                        key={app.id}
                        onClick={() => router.push(`/apps/${app.id}`)}
                        className={`hover:shadow-lg transition-all duration-200 border-2 cursor-pointer flex flex-col h-full ${
                          isDefault
                            ? "bg-primary/5 border-primary/40 hover:border-primary/60"
                            : "hover:border-primary/20"
                        }`}
                      >
                        <CardHeader className="pb-3">
                          <div className="flex items-start gap-3">
                            <AppAvatar src={app.avatar_url} name={app.name} size={44} />
                            <div className="space-y-2 flex-1 min-w-0">
                              {/* 「默认」跟在名称后面，与表格视图一致（那边一直是内联的，
                                  只有卡片单独占一行）。
                                  badge 必须 shrink-0：名称带 truncate，不锁住的话长名字会
                                  把「默认」压扁到看不见——挤掉的是标识而不是名字。*/}
                              <div className="flex items-center gap-2 min-w-0">
                                <CardTitle className="text-lg font-bold truncate hover:text-primary transition-colors">
                                  {app.name}
                                </CardTitle>
                                {app.is_default && (
                                  <Badge
                                    variant="outline"
                                    className="text-xs bg-primary/10 text-primary border-primary/30 shrink-0"
                                  >
                                    {t("default")}
                                  </Badge>
                                )}
                              </div>
                              {app.description && (
                                <p className="text-sm text-muted-foreground line-clamp-2">
                                  {app.description}
                                </p>
                              )}
                            </div>
                          </div>
                        </CardHeader>
                        <CardContent className="flex flex-col flex-grow">
                          <div className="flex flex-wrap gap-2 mb-4">
                            {(() => {
                              const badge = appStatusBadge(app.status);
                              return badge ? (
                                <Badge variant={badge.variant} className={badge.className}>
                                  {ts(badge.labelKey)}
                                </Badge>
                              ) : null;
                            })()}
                            <Badge variant="secondary" className="font-medium">
                              {triggerLabel(app.app_type, t)}
                            </Badge>
                            <Badge variant="secondary" className="font-medium">
                              <PlatformIcon className="h-3 w-3 mr-1" />
                              {app.platform}
                            </Badge>
                          </div>
                          <div className="text-sm">
                            <div className="flex items-center gap-4">
                              {/* 数据集为 0 不显示。
                                  0 不是"没有知识库"——`dataset_ids` 为空时后端走
                                  `kb_classifier_service.select_relevant_datasets(user_id=...)`，
                                  在该用户有权限的**所有**知识库里智能选（auto_select_kb）。
                                  所以 0 表示的是默认行为，把它显示成 0 会读成"这个员工没知识"。*/}
                              {(app.dataset_ids?.length || 0) > 0 && (
                                <div className="flex items-center gap-2">
                                  <span className="text-muted-foreground">{t("datasets")}</span>
                                  <span className="font-medium">{app.dataset_ids.length}</span>
                                </div>
                              )}
                              <div className="flex items-center gap-2">
                                <span className="text-muted-foreground">
                                  {t("tableHeaderTools")}
                                </span>
                                <span className="font-medium">{app.tool_count || 0}</span>
                              </div>
                              <div className="flex items-center gap-2">
                                <span className="text-muted-foreground">
                                  {t("tableHeaderSkills")}
                                </span>
                                <span className="font-medium">{app.skill_count || 0}</span>
                              </div>
                            </div>
                          </div>
                          <div className="flex items-center justify-between pt-2 border-t mt-auto">
                            <span className="text-xs text-muted-foreground">
                              {new Date(app.created_at).toLocaleDateString()}
                            </span>
                            <div className="flex gap-1">
                              {isStreamApp(app) && (
                                <>
                                  <TooltipProvider>
                                    <Tooltip>
                                      <TooltipTrigger asChild>
                                        <Button
                                          variant="ghost"
                                          size="icon"
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            setSelectedStreamApp(app);
                                            setFeedItemsDialogOpen(true);
                                          }}
                                          className="h-8 w-8"
                                        >
                                          <List className="h-4 w-4" />
                                        </Button>
                                      </TooltipTrigger>
                                      <TooltipContent>{t("viewContent")}</TooltipContent>
                                    </Tooltip>
                                  </TooltipProvider>
                                  <TooltipProvider>
                                    <Tooltip>
                                      <TooltipTrigger asChild>
                                        <Button
                                          variant="ghost"
                                          size="icon"
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            setSelectedStreamApp(app);
                                            setSummaryListDialogOpen(true);
                                          }}
                                          className="h-8 w-8"
                                        >
                                          <FileText className="h-4 w-4" />
                                        </Button>
                                      </TooltipTrigger>
                                      <TooltipContent>{t("viewReport")}</TooltipContent>
                                    </Tooltip>
                                  </TooltipProvider>
                                </>
                              )}
                              {!isStreamApp(app) && (
                                <TooltipProvider>
                                  <Tooltip>
                                    <TooltipTrigger asChild>
                                      <Button
                                        variant="ghost"
                                        size="icon"
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          setWorkflowApp(app);
                                          setWorkflowDialogOpen(true);
                                        }}
                                        className="h-8 w-8"
                                      >
                                        <Network className="h-4 w-4" />
                                      </Button>
                                    </TooltipTrigger>
                                    <TooltipContent>{t("workflowConfig")}</TooltipContent>
                                  </Tooltip>
                                </TooltipProvider>
                              )}
                              {canSubmitAppReview(app) && (
                                <TooltipProvider>
                                  <Tooltip>
                                    <TooltipTrigger asChild>
                                      <Button
                                        variant="ghost"
                                        size="icon"
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          handleSubmitAppReview(app);
                                        }}
                                        className="h-8 w-8"
                                      >
                                        <Send className="h-4 w-4" />
                                      </Button>
                                    </TooltipTrigger>
                                    <TooltipContent>{ts("submitReview")}</TooltipContent>
                                  </Tooltip>
                                </TooltipProvider>
                              )}
                              {canEditApp(app, user, isSuperAdmin) && (
                                <>
                                  <TooltipProvider>
                                    <Tooltip>
                                      <TooltipTrigger asChild>
                                        <Button
                                          variant="ghost"
                                          size="icon"
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            handleEdit(app);
                                          }}
                                          className="h-8 w-8"
                                        >
                                          <Edit className="h-4 w-4" />
                                        </Button>
                                      </TooltipTrigger>
                                      <TooltipContent>{tc("edit")}</TooltipContent>
                                    </Tooltip>
                                  </TooltipProvider>
                                  <TooltipProvider>
                                    <Tooltip>
                                      <TooltipTrigger asChild>
                                        <Button
                                          variant="ghost"
                                          size="icon"
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            setDeletingApp(app);
                                            setDeleteConfirmOpen(true);
                                          }}
                                          className="h-8 w-8 text-destructive hover:text-destructive"
                                        >
                                          <Trash2 className="h-4 w-4" />
                                        </Button>
                                      </TooltipTrigger>
                                      <TooltipContent>{tc("delete")}</TooltipContent>
                                    </Tooltip>
                                  </TooltipProvider>
                                </>
                              )}
                            </div>
                          </div>
                        </CardContent>
                      </Card>
                    );
                  })}
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>

      {/* 创建/编辑对话框 */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader className="pb-4 border-b">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
                {editingApp ? (
                  <Edit className="h-5 w-5 text-primary" />
                ) : (
                  <Plus className="h-5 w-5 text-primary" />
                )}
              </div>
              <div>
                <DialogTitle className="text-2xl font-bold">
                  {editingApp ? t("editApp") : t("createApp")}
                </DialogTitle>
                <p className="text-sm text-muted-foreground mt-1">
                  {editingApp ? t("modifyAppConfig") : t("createNewApp")}
                </p>
              </div>
            </div>
          </DialogHeader>
          <div className="space-y-6 py-6">
            <div className="space-y-2">
              <Label htmlFor="name" className="text-sm font-semibold">
                {t("appNameRequired")}
              </Label>
              <Input
                id="name"
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                placeholder={t("appNamePlaceholder")}
                className="h-10"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="description" className="text-sm font-semibold">
                {t("appDesc")}
              </Label>
              <Textarea
                id="description"
                value={formData.description}
                onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                placeholder={t("appDescPlaceholder")}
                rows={3}
                className="resize-none"
              />
            </div>

            <div className="space-y-2">
              <Label className="text-sm font-semibold">{t("avatar")}</Label>
              <AppAvatarPicker
                value={formData.avatar_url}
                name={formData.name}
                onChange={(v) => setFormData({ ...formData, avatar_url: v })}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="email" className="text-sm font-semibold">
                {t("email")}
              </Label>
              <Input
                id="email"
                type="email"
                value={formData.email || ""}
                onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                placeholder={t("emailPlaceholder")}
                className="h-10"
              />
            </div>

            <div className="space-y-3 p-4 rounded-lg border bg-muted/30">
              <div className="flex items-center space-x-2">
                <Checkbox
                  id="is_default"
                  checked={formData.is_default || false}
                  onCheckedChange={(checked) =>
                    setFormData({ ...formData, is_default: checked === true })
                  }
                />
                <Label
                  htmlFor="is_default"
                  className="text-sm font-semibold leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70 cursor-pointer"
                >
                  {t("setAsDefault")}
                </Label>
              </div>
              <p className="text-xs text-muted-foreground ml-6">{t("setAsDefaultDesc")}</p>
            </div>

            {/*
              触发方式 / 平台 / AI 模型 同一行。AI 模型对 Subscription、Custom
              不适用，隐藏时列数跟着降到 2——否则会空出三分之一，看着像少了个字段。
            */}
            <div
              className={`grid gap-4 ${
                formData.app_type !== "Subscription" && formData.app_type !== "Custom"
                  ? "grid-cols-3"
                  : "grid-cols-2"
              }`}
            >
              <div className="space-y-2">
                <Label className="text-sm font-semibold">{t("appType")}</Label>
                <Select
                  value={formData.app_type}
                  onValueChange={(value: any) => {
                    // 切换类型时清掉非本类型的专属 settings，不残留
                    const newSettings = { ...formData.settings };
                    if (value !== "Subscription") {
                      delete newSettings.stream_feed_ids;
                      setStreamFeeds([]);
                    }
                    if (value !== "Custom") {
                      delete newSettings.view_key;
                    }
                    setFormData({
                      ...formData,
                      app_type: value,
                      settings: newSettings,
                    });
                  }}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {/*
                      触发方式 = 这个数字员工被什么触发。
                      · 订阅聚合归到「定时任务」，但**底层值仍是 Subscription**——
                        isStreamApp 靠它决定要不要显示订阅源管理（8 处调用）。
                      · Tool / Plugin 已撤下：Plugin 属于「平台」维度（下面那个选择器），
                        Tool 既不是触发方式也不是平台，生产上零使用。
                        存量数据里若还有这两个值，下面的 legacy 分支仍会显示出来，
                        不会变成一个空白的下拉框。
                    */}
                    <SelectItem value="Chat">{t("chatType")}</SelectItem>
                    <SelectItem value="Subscription">{t("subscriptionType")}</SelectItem>
                    <SelectItem value="Email">{t("emailType")}</SelectItem>
                    <SelectItem value="Custom">{t("customType")}</SelectItem>
                    {(formData.app_type === "Tool" || formData.app_type === "Plugin") && (
                      <SelectItem value={formData.app_type}>
                        {formData.app_type === "Tool" ? t("toolType") : t("pluginType")}
                      </SelectItem>
                    )}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label className="text-sm font-semibold">{t("platform")}</Label>
                <Select
                  value={formData.platform}
                  onValueChange={(value: any) => setFormData({ ...formData, platform: value })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Web">Web</SelectItem>
                    <SelectItem value="Wechat">{t("wechat")}</SelectItem>
                    <SelectItem value="Plugin">{t("pluginPlatform")}</SelectItem>
                    <SelectItem value="Feishu">{t("feishu")}</SelectItem>
                    <SelectItem value="iOS">iOS</SelectItem>
                    <SelectItem value="Android">Android</SelectItem>
                    <SelectItem value="Harmony">{t("harmony")}</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {formData.app_type !== "Subscription" && formData.app_type !== "Custom" && (
                <div className="space-y-2">
                  <Label className="text-sm font-semibold">{t("aiModel")}</Label>
                  <Select
                    value={formData.ai_model}
                    onValueChange={(value) => setFormData({ ...formData, ai_model: value })}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="deepseek">Deepseek</SelectItem>
                      <SelectItem value="qwen">Qwen</SelectItem>
                      <SelectItem value="openai">OpenAI</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              )}
            </div>

            {/* Stream 应用订阅源管理 */}
            {formData.app_type === "Subscription" && (
              <div className="space-y-3 p-4 rounded-lg border bg-muted/30">
                <Label className="text-sm font-semibold">{t("subscriptionSource")}</Label>
                <div className="flex gap-2">
                  <Input
                    value={newStreamUrl}
                    onChange={(e) => setNewStreamUrl(e.target.value)}
                    placeholder={t("subscriptionUrlPlaceholder")}
                    disabled={addingFeed}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        handleAddStreamUrl();
                      }
                    }}
                  />
                  <Button
                    type="button"
                    onClick={handleAddStreamUrl}
                    disabled={addingFeed || !newStreamUrl}
                  >
                    {addingFeed ? <Loader2 className="h-4 w-4 animate-spin" /> : t("add")}
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">{t("subscriptionUrlHelp")}</p>
                {streamFeeds.length > 0 && (
                  <div className="border rounded-md p-3 space-y-2 bg-background">
                    {streamFeeds.map((feed) => (
                      <div
                        key={feed.id}
                        className="flex items-center justify-between py-2 px-3 rounded-md bg-muted/50 gap-2 hover:bg-muted transition-colors"
                      >
                        <div className="flex items-center gap-2 min-w-0 flex-1">
                          <Badge variant="outline" className="text-xs shrink-0 font-medium">
                            {feed.platform}
                          </Badge>
                          <span className="text-sm truncate font-medium" title={feed.url}>
                            {feed.url || feed.name || feed.id}
                          </span>
                        </div>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleRemoveStreamFeed(feed.id)}
                          className="h-7 w-7 p-0 hover:bg-destructive/10 hover:text-destructive"
                        >
                          <X className="h-4 w-4" />
                        </Button>
                      </div>
                    ))}
                  </div>
                )}

                <div className="space-y-2 pt-2 border-t">
                  <Label className="text-sm font-medium">{t("topicFilter")}</Label>
                  <Input
                    value={formData.settings?.topic || ""}
                    onChange={(e) =>
                      setFormData({
                        ...formData,
                        settings: {
                          ...formData.settings,
                          topic: e.target.value,
                        },
                      })
                    }
                    placeholder={t("topicFilterPlaceholder")}
                    maxLength={200}
                  />
                  <p className="text-xs text-muted-foreground">{t("topicFilterHelp")}</p>
                </div>

                <div className="space-y-2">
                  <Label className="text-sm font-medium">{t("webhookUrl")}</Label>
                  <Input
                    value={formData.settings?.webhook_url || ""}
                    onChange={(e) =>
                      setFormData({
                        ...formData,
                        settings: {
                          ...formData.settings,
                          webhook_url: e.target.value,
                        },
                      })
                    }
                    placeholder={t("webhookUrlPlaceholder")}
                    type="url"
                  />
                  <p className="text-xs text-muted-foreground">{t("webhookUrlHelp")}</p>
                </div>

                {/* Schedule Configuration */}
                <ScheduleConfigSection
                  schedule={formData.settings?.schedule || defaultScheduleSettings}
                  onChange={(schedule) =>
                    setFormData({
                      ...formData,
                      settings: {
                        ...formData.settings,
                        schedule,
                      },
                    })
                  }
                />
              </div>
            )}

            {/* Custom 应用：选择要渲染的自定义视图（选项来自前端注册表，写死） */}
            {formData.app_type === "Custom" && (
              <div className="space-y-2 p-4 rounded-lg border bg-muted/30">
                <Label className="text-sm font-semibold">{t("customView")}</Label>
                <Select
                  value={formData.settings?.view_key || ""}
                  onValueChange={(value) =>
                    setFormData({
                      ...formData,
                      settings: { ...formData.settings, view_key: value },
                    })
                  }
                >
                  <SelectTrigger>
                    <SelectValue placeholder={t("customViewPlaceholder")} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="observe-dashboard">{t("viewObserveDashboard")}</SelectItem>
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">{t("customViewHelp")}</p>
              </div>
            )}

            {/* 微信应用选择（仅当平台为微信时显示） */}
            {formData.platform === "Wechat" && (
              <div className="grid grid-cols-2 gap-4 p-4 rounded-lg border bg-muted/30">
                <div className="space-y-2">
                  <Label className="text-sm font-semibold">{t("wechatApp")}</Label>
                  {loadingWechatAgents ? (
                    <div className="flex items-center gap-2 text-sm text-muted-foreground py-2">
                      <Loader2 className="h-4 w-4 animate-spin" />
                      <span>{t("loadingWechatApps")}</span>
                    </div>
                  ) : (
                    <Select
                      value={formData.settings?.wechat?.agent_id?.toString() || ""}
                      onValueChange={(value) => {
                        setFormData({
                          ...formData,
                          settings: {
                            ...formData.settings,
                            wechat: {
                              ...formData.settings?.wechat,
                              agent_id: value,
                            },
                          },
                        });
                      }}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder={t("wechatAppPlaceholder")} />
                      </SelectTrigger>
                      <SelectContent>
                        {wechatAgents.map((agent) => (
                          <SelectItem key={agent.agentid} value={agent.agentid.toString()}>
                            {agent.name} (ID: {agent.agentid})
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                  {wechatAgents.length === 0 && !loadingWechatAgents && (
                    <p className="text-xs text-muted-foreground">{t("noWechatApps")}</p>
                  )}
                </div>

                <div className="space-y-2">
                  <Label className="text-sm font-semibold">{t("replyType")}</Label>
                  <Select
                    value={formData.settings?.wechat?.reply_type || ""}
                    onValueChange={(value) => {
                      setFormData({
                        ...formData,
                        settings: {
                          ...formData.settings,
                          wechat: {
                            ...formData.settings?.wechat,
                            reply_type: value,
                          },
                        },
                      });
                    }}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder={t("replyTypePlaceholder")} />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="text">{t("textMessage")}</SelectItem>
                      <SelectItem value="mpnews">{t("mpnewsMessage")}</SelectItem>
                      <SelectItem value="markdown">{t("markdownMessage")}</SelectItem>
                      <SelectItem value="file">{t("fileMessage")}</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
            )}

            {/*
              角色设定单独一行：它是这个数字员工的说明书入口，和上面几个下拉不是
              一类东西，挤在同一行会被当成"又一个选项"。
              新建态没有 editingApp、也就没有 id 可跳，整块不显示——角色在应用
              建好之后编辑（后端建应用时已自动铺一份起始角色）。
            */}
            {editingApp &&
              formData.app_type !== "Subscription" &&
              formData.app_type !== "Custom" && (
                <div className="space-y-2">
                  <Label className="text-sm font-semibold">{ts("agentMdMode")}</Label>
                  <div>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => router.push(`/apps/${editingApp.id}`)}
                    >
                      <FileText className="h-4 w-4 mr-2" />
                      {ts("editAgentMd")}
                    </Button>
                  </div>
                  <p className="text-xs text-muted-foreground">{ts("agentMdModeDesc")}</p>
                </div>
              )}

            {/* 关联知识库（Stream 应用不显示） */}
            {formData.app_type !== "Subscription" && (
              <div className="space-y-3 p-4 rounded-lg border bg-muted/30">
                <Label className="text-sm font-semibold">{t("relatedDatasets")}</Label>
                <div className="flex items-center space-x-2 mb-3">
                  <Checkbox
                    id="auto-select-datasets"
                    checked={autoSelectDatasets}
                    onCheckedChange={(checked) => {
                      const isChecked = checked === true;
                      setAutoSelectDatasets(isChecked);
                      // 如果勾选了自动选择知识库，清空所有已选择的知识库
                      if (isChecked) {
                        setFormData({
                          ...formData,
                          dataset_ids: [],
                        });
                      }
                    }}
                  />
                  <label
                    htmlFor="auto-select-datasets"
                    className="text-sm font-medium cursor-pointer"
                  >
                    {t("autoSelectDatasets")}
                  </label>
                </div>
                {!autoSelectDatasets && (
                  <TooltipProvider>
                    <div className="border rounded-md p-3 max-h-40 overflow-y-auto space-y-2 bg-background">
                      {datasets.length === 0 ? (
                        <p className="text-sm text-muted-foreground">{t("noAvailableDatasets")}</p>
                      ) : (
                        (() => {
                          // 计算已选知识库的 dimension
                          const selectedDatasetIds = formData.dataset_ids;
                          const selectedDatasets = datasets.filter((d) =>
                            selectedDatasetIds.includes(d.id)
                          );
                          // 获取所有已选知识库的 dimension，确保它们都相同
                          const selectedDimensions = selectedDatasets
                            .map((d) => d.dimension)
                            .filter((d) => d !== undefined);
                          const selectedDimension =
                            selectedDimensions.length > 0 &&
                            selectedDimensions.every((d) => d === selectedDimensions[0])
                              ? selectedDimensions[0]
                              : undefined;

                          return datasets.map((dataset) => {
                            // 判断是否应该禁用：如果已选知识库有 dimension，且当前知识库的 dimension 不同，则禁用
                            const isDisabled =
                              selectedDimension !== undefined &&
                              dataset.dimension !== undefined &&
                              dataset.dimension !== selectedDimension &&
                              !selectedDatasetIds.includes(dataset.id);

                            return (
                              <Tooltip key={dataset.id}>
                                <TooltipTrigger asChild>
                                  <div
                                    className={`flex items-center space-x-2 ${
                                      isDisabled ? "opacity-50 cursor-not-allowed" : ""
                                    }`}
                                  >
                                    <input
                                      type="checkbox"
                                      id={`dataset-${dataset.id}`}
                                      checked={formData.dataset_ids.includes(dataset.id)}
                                      disabled={isDisabled}
                                      onChange={(e) => {
                                        if (e.target.checked) {
                                          setFormData({
                                            ...formData,
                                            dataset_ids: [...formData.dataset_ids, dataset.id],
                                          });
                                        } else {
                                          setFormData({
                                            ...formData,
                                            dataset_ids: formData.dataset_ids.filter(
                                              (id) => id !== dataset.id
                                            ),
                                          });
                                        }
                                      }}
                                      className="rounded"
                                    />
                                    <label
                                      htmlFor={`dataset-${dataset.id}`}
                                      className={`text-sm flex-1 ${
                                        isDisabled ? "cursor-not-allowed" : "cursor-pointer"
                                      }`}
                                    >
                                      {dataset.name}
                                    </label>
                                  </div>
                                </TooltipTrigger>
                                {isDisabled && (
                                  <TooltipContent>
                                    <p>{t("datasetDimensionWarning")}</p>
                                  </TooltipContent>
                                )}
                              </Tooltip>
                            );
                          });
                        })()
                      )}
                    </div>
                  </TooltipProvider>
                )}
              </div>
            )}
          </div>
          <DialogFooter className="pt-4 border-t gap-2">
            <Button variant="outline" onClick={() => setDialogOpen(false)} disabled={submitting}>
              {tc("cancel")}
            </Button>
            <Button onClick={handleSubmit} disabled={submitting} className="min-w-[100px]">
              {submitting ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  {tc("processing")}
                </>
              ) : editingApp ? (
                t("saveChanges")
              ) : (
                t("createApp")
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 删除确认对话框 */}
      <Dialog open={deleteConfirmOpen} onOpenChange={setDeleteConfirmOpen}>
        <DialogContent>
          <DialogHeader className="pb-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-destructive/10 flex items-center justify-center">
                <Trash2 className="h-5 w-5 text-destructive" />
              </div>
              <DialogTitle className="text-xl font-bold">{t("deleteApp")}</DialogTitle>
            </div>
          </DialogHeader>
          <div className="py-4">
            <p className="text-sm text-muted-foreground mb-2">
              {t("deleteConfirm", { name: deletingApp?.name || "" })}
            </p>
            <p className="text-xs text-destructive font-medium">{t("deleteWarning")}</p>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setDeleteConfirmOpen(false)}>
              {tc("cancel")}
            </Button>
            <Button variant="destructive" onClick={handleDelete} className="min-w-[100px]">
              {t("confirmDelete")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 工作流编辑器 */}
      <WorkflowEditor
        open={workflowDialogOpen}
        onOpenChange={setWorkflowDialogOpen}
        app={workflowApp}
        datasets={datasets}
        isSuperAdmin={isSuperAdmin}
        onSave={async (workflow: WorkflowConfig) => {
          if (!workflowApp) return;

          // 从工作流中提取数据并同步到应用字段
          const aiNode = workflow.nodes.find((n) => n.type === "aiNode");
          const knowledgeNode = workflow.nodes.find((n) => n.type === "knowledgeNode");
          const inputNode = workflow.nodes.find((n) => n.type === "inputNode");

          // 保存工作流配置和同步的字段
          const updatedSettings = {
            ...workflowApp.settings,
            workflow,
          };

          const updateData: any = {
            settings: updatedSettings,
          };

          // 同步 AI 模型
          if (aiNode?.data.aiModel) {
            updateData.ai_model = aiNode.data.aiModel;
          }

          // 同步数据集 IDs
          if (knowledgeNode?.data.datasetIds) {
            updateData.dataset_ids = knowledgeNode.data.datasetIds;
          } else {
            // 如果工作流中删除了知识库节点，清空数据集
            updateData.dataset_ids = [];
          }

          // 同步平台
          if (inputNode?.data.platform) {
            updateData.platform = inputNode.data.platform;
          }

          await axios.put(`/api/v1/apps/${workflowApp.id}`, updateData);

          // 重新加载应用列表
          loadApps();
        }}
      />

      {/* 应用模板选择对话框 */}
      <Dialog open={templateDialogOpen} onOpenChange={setTemplateDialogOpen}>
        <DialogContent className="max-w-4xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-xl font-bold">{t("selectTemplate")}</DialogTitle>
            <p className="text-sm text-muted-foreground">{t("selectTemplateDesc")}</p>
          </DialogHeader>
          <div className="space-y-6 py-4">
            <div className="grid gap-6">
              <Card
                className={`cursor-pointer transition-all duration-200 hover:shadow-lg hover:border-primary ${
                  creatingFromTemplate
                    ? "opacity-50 pointer-events-none"
                    : selectedTemplate === "quality-agent"
                      ? "border-primary bg-primary/10 shadow-lg"
                      : "hover:bg-primary/5"
                }`}
                onClick={() => handleSelectTemplate("quality-agent")}
              >
                <CardContent className="p-6">
                  <div className="flex items-start justify-between">
                    <div className="space-y-3 flex-1">
                      <div className="flex items-center gap-3">
                        <div className="w-12 h-12 bg-primary/10 rounded-lg flex items-center justify-center">
                          <Network className="h-6 w-6 text-primary" />
                        </div>
                        <div>
                          <h3 className="font-bold text-xl text-foreground">{t("qualityAgent")}</h3>
                          <p className="text-sm text-primary font-medium">
                            {t("qualityAgentSubtitle")}
                          </p>
                        </div>
                      </div>

                      <p className="text-muted-foreground leading-relaxed">
                        {t("qualityAgentDesc")}
                      </p>

                      <div className="flex flex-wrap gap-2">
                        <Badge variant="secondary" className="bg-primary/10 text-primary">
                          {t("aiClassification")}
                        </Badge>
                        <Badge variant="secondary" className="bg-success/10 text-success">
                          {t("multiPlatformInput")}
                        </Badge>
                        <Badge variant="secondary" className="bg-orange-100 text-orange-800">
                          {t("manualReview")}
                        </Badge>
                        <Badge variant="secondary" className="bg-purple-100 text-purple-800">
                          {t("qmsIntegration")}
                        </Badge>
                      </div>
                    </div>

                    <div className="ml-6 w-80">
                      <div className="bg-muted rounded-lg p-4">
                        <h4 className="font-semibold text-sm text-foreground mb-3">
                          {t("workflowProcess")}
                        </h4>
                        <div className="space-y-2 text-xs">
                          <div className="flex items-center gap-2">
                            <div className="w-2 h-2 bg-primary rounded-full"></div>
                            <span className="text-muted-foreground">{t("workflowDescLine1")}</span>
                          </div>
                          <div className="flex items-center gap-2">
                            <div className="w-2 h-2 bg-success rounded-full"></div>
                            <span className="text-muted-foreground">{t("workflowDescLine2")}</span>
                          </div>
                          <div className="flex items-center gap-2">
                            <div className="w-2 h-2 bg-warning rounded-full"></div>
                            <span className="text-muted-foreground">{t("workflowDescLine3")}</span>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="mt-4 pt-4 border-t">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-4 text-sm text-muted-foreground">
                        <span>• {t("autoClassification")}</span>
                        <span>• {t("multiPlatformSupport")}</span>
                        <span>• {t("manualReview")}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        {selectedTemplate === "quality-agent" && (
                          <div className="flex items-center gap-1 text-primary">
                            <div className="w-2 h-2 bg-primary rounded-full"></div>
                            <span className="text-sm font-medium">{t("selected")}</span>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setTemplateDialogOpen(false)}
              disabled={creatingFromTemplate}
            >
              {tc("cancel")}
            </Button>
            <Button
              onClick={handleCreateSelectedTemplate}
              disabled={!selectedTemplate || creatingFromTemplate}
            >
              {creatingFromTemplate ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  {t("creating")}
                </>
              ) : (
                t("createApp")
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 网站嵌入集成对话框 */}
      <Dialog open={embedDialogOpen} onOpenChange={setEmbedDialogOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader className="pb-4 border-b">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
                <Code className="h-5 w-5 text-primary" />
              </div>
              <div>
                <DialogTitle className="text-xl font-bold">{t("embedIntegration")}</DialogTitle>
                <p className="text-sm text-muted-foreground mt-1">{t("embedIntegrationDesc")}</p>
              </div>
            </div>
          </DialogHeader>
          <div className="space-y-6 py-6">
            <div className="space-y-2">
              <Label className="text-sm font-semibold">{t("selectAppToEmbed")}</Label>
              <Select value={embedAppId} onValueChange={setEmbedAppId}>
                <SelectTrigger>
                  <SelectValue placeholder={t("selectAppToEmbedPlaceholder")} />
                </SelectTrigger>
                <SelectContent>
                  {apps.map((app) => (
                    <SelectItem key={app.id} value={app.id.toString()}>
                      {app.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-3">
              <div className="text-sm text-muted-foreground">{t("embedCodeDesc")}</div>
              <div className="relative">
                <div className="bg-muted rounded-lg p-4 border-2 border-dashed">
                  <pre className="text-xs overflow-auto font-mono leading-relaxed">
                    {(() => {
                      const selectedApp = apps.find((a) => a.id.toString() === embedAppId);
                      const datasetId = selectedApp?.dataset_ids?.[0] || "";
                      const appId = selectedApp?.id || "";
                      return `${t("embedCodeComment1")}
<script src="https://cdn.ragents.net/chatbot.js"
  data-app-id="${appId}"
  data-dataset-id="${datasetId}"
  data-user-token="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.demo.token"
></script>
${t("embedCodeComment2")}`;
                    })()}
                  </pre>
                </div>
              </div>
            </div>
          </div>
          <DialogFooter className="pt-4 border-t gap-2">
            <Button variant="outline" onClick={() => setEmbedDialogOpen(false)}>
              {tc("close")}
            </Button>
            <Button
              onClick={async () => {
                const selectedApp = apps.find((a) => a.id.toString() === embedAppId);
                const datasetId = selectedApp?.dataset_ids?.[0] || "";
                const appId = selectedApp?.id || "";
                const code = `${t("embedCodeComment1")}
<script src="https://cdn.ragents.net/chatbot.js"
  data-app-id="${appId}"
  data-dataset-id="${datasetId}"
  data-user-token="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.demo.token"
></script>
${t("embedCodeComment2")}`;
                try {
                  await navigator.clipboard.writeText(code);
                  toast.success(tc("copiedToClipboard"));
                } catch {
                  toast.error(tc("copyFailed"));
                }
              }}
              className="min-w-[120px]"
            >
              <Code className="h-4 w-4 mr-2" />
              {tc("copyCode")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Stream Agent 订阅内容查看弹窗 */}
      <FeedItemsDialog
        open={feedItemsDialogOpen}
        onOpenChange={setFeedItemsDialogOpen}
        feedIds={
          Array.isArray(selectedStreamApp?.settings?.stream_feed_ids)
            ? selectedStreamApp.settings.stream_feed_ids
            : []
        }
        appName={selectedStreamApp?.name}
      />

      {/* Stream Agent 报告列表弹窗 */}
      <SummaryListDialog
        open={summaryListDialogOpen}
        onOpenChange={setSummaryListDialogOpen}
        feedIds={
          Array.isArray(selectedStreamApp?.settings?.stream_feed_ids)
            ? selectedStreamApp.settings.stream_feed_ids
            : []
        }
        appName={selectedStreamApp?.name}
        topic={selectedStreamApp?.settings?.topic}
        webhookUrl={selectedStreamApp?.settings?.webhook_url}
      />
    </div>
  );
}
