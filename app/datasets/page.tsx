"use client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Plus,
  Database,
  FolderOpen,
  Settings,
  Trash2,
  Lock,
  Users,
  Building2,
  Globe,
  Search,
  Edit2,
} from "lucide-react";
import { useState, useEffect, useMemo } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { useRouter } from "next/navigation";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { useDatasets } from "@/hooks/useDatasets";
import { useOrganization } from "@/hooks/useOrganization";
import DatasetSettings from "./components/DatasetSettings";
import DeptSelect from "@/components/DeptSelect";
import { UserSearchDialog } from "@/components/UserSearchDialog";
import { formatDistanceToNow } from "date-fns";
import { zhCN, enUS } from "date-fns/locale";
import { useTranslations, useLocale } from "next-intl";

// 格式化时间的工具函数
const formatUploadTime = (dateString: string, locale: string) => {
  return formatDistanceToNow(new Date(dateString), {
    addSuffix: true,
    locale: locale === "en" ? enUS : zhCN,
  });
};

// 知识库默认配置
const DEFAULT_DATASET_CONFIG = {
  visibility: "private",
  splitMode: "auto",
  fixedLength: 500,
  segmentModel: "aliyun-v4",
  contentParsing: "local",
  enhanced: false,
  enableOcr: false,
  promptType: "3",
  vectorWeight: 0.6,
  textWeight: 0.4,
  rerankService: "aliyun",
};

// 数据集卡片组件
interface DatasetCardProps {
  dataset: any;
  onSelect: (dataset: any) => void;
  onEdit: (dataset: any) => void;
  onDelete: (dataset: any) => void;
}

const DatasetCard = ({ dataset, onSelect, onEdit, onDelete }: DatasetCardProps) => {
  const router = useRouter();
  const t = useTranslations("datasets");
  const tc = useTranslations("common");
  const locale = useLocale();

  const getVisibilityIcon = (visibility: string) => {
    switch (visibility) {
      case "private":
        return <Lock className="h-5 w-5 text-muted-foreground shrink-0" />;
      case "dept":
        return <Users className="h-5 w-5 text-muted-foreground shrink-0" />;
      case "tenant":
        return <Building2 className="h-5 w-5 text-muted-foreground shrink-0" />;
      case "public":
        return <Globe className="h-5 w-5 text-muted-foreground shrink-0" />;
      default:
        return <Users className="h-5 w-5 text-muted-foreground shrink-0" />;
    }
  };

  return (
    <Card
      className="hover:shadow-md transition-shadow cursor-pointer group"
      onClick={() => onSelect(dataset)}
    >
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-2">
          <div className="flex-1 min-w-0">
            <CardTitle className="text-lg flex items-center gap-2 min-w-0">
              {getVisibilityIcon(dataset.visibility)}
              <div className="truncate flex-1 min-w-0">{dataset.name}</div>
            </CardTitle>
            <CardDescription className="mt-2">
              <div className="flex items-center gap-2 text-sm">
                <span>{tc("files", { count: dataset.file_count || 0 })}</span>
              </div>
            </CardDescription>
          </div>
          <div className="flex items-center gap-2 w-0 min-w-0 overflow-hidden opacity-0 group-hover:w-auto group-hover:opacity-100 transition-all duration-200">
            <Button
              size="sm"
              variant="ghost"
              onClick={(e) => {
                e.stopPropagation();
                onEdit(dataset);
              }}
            >
              <Settings className="h-4 w-4" />
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={(e) => {
                e.stopPropagation();
                router.push(`/search?dataset=${dataset.id}`);
              }}
              title={t("intelligentSearch")}
            >
              <Search className="h-4 w-4" />
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={(e) => {
                e.stopPropagation();
                onDelete(dataset);
              }}
              className="text-destructive hover:text-destructive/80"
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="pt-0">
        <div className="flex items-center justify-between">
          <div className="text-sm text-muted-foreground">
            {tc("updatedAt", { time: formatUploadTime(dataset.updated_at, locale) })}
          </div>
          <div className="flex items-center gap-2">
            <FolderOpen className="h-4 w-4 text-primary" />
          </div>
        </div>
      </CardContent>
    </Card>
  );
};

export default function DatasetsPage() {
  const router = useRouter();
  const { user } = useCurrentUser();
  const t = useTranslations("datasets");
  const tc = useTranslations("common");

  // 使用 SWR hook
  const { datasets, loading, createDataset, updateDataset, deleteDataset } = useDatasets();
  const { tenants, departments } = useOrganization();

  // 对话框状态
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [showEditDialog, setShowEditDialog] = useState(false);
  const [editingDataset, setEditingDataset] = useState<any>(null);
  const [creating, setCreating] = useState(false);
  const [updating, setUpdating] = useState(false);

  // 数据集表单状态
  const [datasetName, setDatasetName] = useState("");
  const [datasetDescription, setDatasetDescription] = useState("");
  const [datasetVisibility, setDatasetVisibility] = useState(DEFAULT_DATASET_CONFIG.visibility);
  const [selectedTenantId, setSelectedTenantId] = useState<number | null>(null);
  const [selectedDeptId, setSelectedDeptId] = useState<number | null>(null);

  const filteredDepts = useMemo(
    () => departments.filter((dept) => !selectedTenantId || dept.tenant_id === selectedTenantId),
    [departments, selectedTenantId]
  );
  const [splitMode, setSplitMode] = useState(DEFAULT_DATASET_CONFIG.splitMode);
  const [fixedLength, setFixedLength] = useState(DEFAULT_DATASET_CONFIG.fixedLength);
  const [segmentModel, setSegmentModel] = useState(DEFAULT_DATASET_CONFIG.segmentModel);
  const [contentParsing, setContentParsing] = useState(DEFAULT_DATASET_CONFIG.contentParsing);
  const [enhanced, setEnhanced] = useState(DEFAULT_DATASET_CONFIG.enhanced);
  const [enableOcr, setEnableOcr] = useState(DEFAULT_DATASET_CONFIG.enableOcr);
  const [promptType, setPromptType] = useState(DEFAULT_DATASET_CONFIG.promptType);
  const [vectorWeight, setVectorWeight] = useState(DEFAULT_DATASET_CONFIG.vectorWeight);
  const [textWeight, setTextWeight] = useState(DEFAULT_DATASET_CONFIG.textWeight);
  const [rerankService, setRerankService] = useState(DEFAULT_DATASET_CONFIG.rerankService);

  // 高级设置展开状态
  const [showAdvancedSettings, setShowAdvancedSettings] = useState(false);

  // 可见性筛选状态（按租户分别管理）
  const [visibilityFilters, setVisibilityFilters] = useState<{
    [tenantName: string]: string;
  }>({});

  // 获取某租户的筛选值
  const getVisibilityFilter = (tenantName: string) => {
    return visibilityFilters[tenantName] || "all";
  };

  // 设置某租户的筛选值
  const setVisibilityFilter = (tenantName: string, value: string) => {
    setVisibilityFilters((prev) => ({
      ...prev,
      [tenantName]: value,
    }));
  };

  // 创建者相关状态
  const [showUserSearchDialog, setShowUserSearchDialog] = useState(false);
  const [selectedOwnerId, setSelectedOwnerId] = useState<number | null>(null);
  const [ownerName, setOwnerName] = useState<string>("");

  // 权限判断
  const isSuperAdmin = user?.isSuperAdmin || false;
  const isTenantAdmin = user?.isTenantAdmin || false;
  const isDeptAdmin = user?.isDeptAdmin || false;

  // 初始化租户和部门选择
  useEffect(() => {
    if (!user || !showCreateDialog) return;

    const userTenantId = user.tenant_id ?? null;
    const userDeptId = user.dept_id ?? null;

    if (isSuperAdmin) {
      // 如果超级管理员尚未选择租户，则默认自己的租户
      setSelectedTenantId((prev) => prev ?? userTenantId);
      setSelectedDeptId((prev) => prev ?? userDeptId);
    } else {
      setSelectedTenantId(userTenantId);
      if (isTenantAdmin) {
        setSelectedDeptId((prev) => prev ?? null);
      } else {
        setSelectedDeptId(userDeptId);
      }
    }
  }, [user, showCreateDialog, isSuperAdmin, isTenantAdmin]);

  // 当租户改变时，清空部门选择
  useEffect(() => {
    if (selectedTenantId === null) {
      setSelectedDeptId(null);
    }
  }, [selectedTenantId]);

  // 重置所有配置到默认值
  const resetToDefaults = () => {
    setDatasetName("");
    setDatasetDescription("");
    setDatasetVisibility(DEFAULT_DATASET_CONFIG.visibility);
    setSelectedTenantId(null);
    setSelectedDeptId(null);
    setSplitMode(DEFAULT_DATASET_CONFIG.splitMode);
    setFixedLength(DEFAULT_DATASET_CONFIG.fixedLength);
    setSegmentModel(DEFAULT_DATASET_CONFIG.segmentModel);
    setContentParsing(DEFAULT_DATASET_CONFIG.contentParsing);
    setEnhanced(DEFAULT_DATASET_CONFIG.enhanced);
    setEnableOcr(DEFAULT_DATASET_CONFIG.enableOcr);
    setPromptType(DEFAULT_DATASET_CONFIG.promptType);
    setVectorWeight(DEFAULT_DATASET_CONFIG.vectorWeight);
    setTextWeight(DEFAULT_DATASET_CONFIG.textWeight);
    setRerankService(DEFAULT_DATASET_CONFIG.rerankService);
    setShowAdvancedSettings(false);
  };

  // 重置新建对话框状态
  const resetCreateDialogState = () => {
    resetToDefaults();
  };

  // 重置编辑对话框状态
  const resetEditDialogState = () => {
    setEditingDataset(null);
    setSelectedOwnerId(null);
    setOwnerName("");
    resetToDefaults();
  };

  // 处理用户选择
  const handleUserSelect = (selectedUser: { id: number; nickname: string; username: string }) => {
    setSelectedOwnerId(selectedUser.id);
    setOwnerName(selectedUser.nickname || selectedUser.username);
  };

  // 根据可见性筛选数据集
  const filterDatasetsByVisibility = (datasets: any[], filter: string) => {
    if (filter === "all") return datasets;
    return datasets.filter((dataset) => dataset.visibility === filter);
  };

  // 按租户分组数据集（仅超级管理员使用）- 不做筛选，只分组
  const groupDatasetsByTenant = (datasets: any[]) => {
    const groups: { [key: string]: any[] } = {};
    const groupOrder: string[] = []; // 保持租户出现的顺序

    datasets.forEach((dataset) => {
      const tenantName = dataset.owner_tenant_name || t("other");
      if (!groups[tenantName]) {
        groups[tenantName] = [];
        groupOrder.push(tenantName); // 记录租户第一次出现的顺序
      }
      groups[tenantName].push(dataset);
    });

    return { groups, groupOrder };
  };

  // 创建数据集
  const handleCreate = async () => {
    if (!datasetName.trim()) {
      return;
    }

    setCreating(true);
    try {
      // 构建 settings 对象
      const settings: any = {
        splitMode,
        segmentModel,
        contentParsing,
        enhanced,
        enableOcr,
        vectorWeight,
        textWeight,
        rerankService,
      };

      if (splitMode === "fixed") {
        settings.fixedLength = fixedLength;
      }

      if (enhanced) {
        settings.promptType = promptType;
      }

      const result = await createDataset({
        name: datasetName,
        description: datasetDescription,
        visibility: datasetVisibility,
        settings,
        owner_tenant_id: selectedTenantId || undefined,
        owner_dept_id: selectedDeptId || undefined,
      });

      if (result) {
        setShowCreateDialog(false);
        resetCreateDialogState();
      }
    } finally {
      setCreating(false);
    }
  };

  // 更新数据集
  const handleUpdate = async () => {
    if (!editingDataset || !datasetName.trim()) {
      return;
    }

    // 检查是否有分段相关设置发生变化
    const originalSegmentModel = editingDataset.settings?.segmentModel || "aliyun-v4";
    const originalSplitMode = editingDataset.settings?.splitMode || "auto";
    const segmentModelChanged = segmentModel !== originalSegmentModel;
    const splitModeChanged = splitMode !== originalSplitMode;

    // 如果有分段相关设置发生变化，显示确认信息
    if (segmentModelChanged || splitModeChanged) {
      let confirmMessage = t("segmentSettingsChanged") + "：\n\n";

      if (segmentModelChanged) {
        confirmMessage += `- ${t("segmentModelChangedTo", { from: originalSegmentModel, to: segmentModel })}\n`;
      }
      if (splitModeChanged) {
        confirmMessage += `- ${t("splitModeChangedTo", { from: originalSplitMode, to: splitMode })}\n`;
      }

      confirmMessage += `\n${t("segmentSettingsWarning")}\n\n${t("continueQuestion")}`;

      if (!window.confirm(confirmMessage)) {
        return;
      }
    }

    setUpdating(true);
    try {
      // 构建 settings 对象
      const settings: any = {
        splitMode,
        segmentModel,
        contentParsing,
        enhanced,
        enableOcr,
        vectorWeight,
        textWeight,
        rerankService,
      };

      if (splitMode === "fixed") {
        settings.fixedLength = fixedLength;
      }

      if (enhanced) {
        settings.promptType = promptType;
      }

      const result = await updateDataset(editingDataset.id, {
        name: datasetName,
        description: datasetDescription,
        visibility: datasetVisibility,
        settings,
        owner_tenant_id: selectedTenantId ?? null,
        owner_dept_id: selectedDeptId ?? null,
        user_id:
          isSuperAdmin && selectedOwnerId !== editingDataset.user_id ? selectedOwnerId : undefined,
      });

      if (result) {
        setShowEditDialog(false);
        resetEditDialogState();
      }
    } finally {
      setUpdating(false);
    }
  };

  // 删除数据集
  const handleDelete = async (dataset: any) => {
    if (!window.confirm(t("deleteConfirm", { name: dataset.name }))) {
      return;
    }

    await deleteDataset(dataset.id);
  };

  // 从数据集配置中加载设置（使用默认值作为回退）
  const loadDatasetSettings = (dataset: any) => {
    const s = dataset.settings || {};

    setDatasetName(dataset.name);
    setDatasetDescription(dataset.description || "");
    setDatasetVisibility(dataset.visibility || DEFAULT_DATASET_CONFIG.visibility);
    setSelectedTenantId(dataset.owner_tenant_id ?? null);
    setSelectedDeptId(dataset.owner_dept_id ?? null);

    // 加载创建者信息
    setSelectedOwnerId(dataset.user_id ?? null);
    setOwnerName(dataset.owner_name || t("unknown"));

    // 分段方式
    setSplitMode(s.splitMode || DEFAULT_DATASET_CONFIG.splitMode);
    setFixedLength(
      s.splitMode === "fixed" && s.fixedLength ? s.fixedLength : DEFAULT_DATASET_CONFIG.fixedLength
    );

    // 其他配置
    setSegmentModel(s.segmentModel || DEFAULT_DATASET_CONFIG.segmentModel);
    setContentParsing(s.contentParsing || DEFAULT_DATASET_CONFIG.contentParsing);
    setEnhanced(s.enhanced || DEFAULT_DATASET_CONFIG.enhanced);
    setEnableOcr(s.enableOcr || DEFAULT_DATASET_CONFIG.enableOcr);
    setPromptType(s.promptType || DEFAULT_DATASET_CONFIG.promptType);
    setRerankService(s.rerankService || DEFAULT_DATASET_CONFIG.rerankService);

    // 权重
    if (s.vectorWeight !== undefined) {
      setVectorWeight(s.vectorWeight);
      setTextWeight(s.textWeight || 1 - s.vectorWeight);
    } else {
      setVectorWeight(DEFAULT_DATASET_CONFIG.vectorWeight);
      setTextWeight(DEFAULT_DATASET_CONFIG.textWeight);
    }

    // 编辑时默认不展开高级设置
    setShowAdvancedSettings(false);
  };

  // 编辑数据集
  const handleEdit = (dataset: any) => {
    setEditingDataset(dataset);
    loadDatasetSettings(dataset);
    setShowEditDialog(true);
  };

  // 选择数据集
  const handleSelect = (dataset: any) => {
    router.push(`/knowledge?dataset=${dataset.id}`);
  };

  return (
    <div className="container mx-auto p-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-3xl font-bold">{t("title")}</h1>
          <p className="text-muted-foreground mt-2">{t("description")}</p>
        </div>
        <Button
          onClick={() => {
            resetCreateDialogState();
            setShowCreateDialog(true);
          }}
        >
          <Plus className="h-4 w-4 mr-2" />
          {t("createDataset")}
        </Button>
      </div>

      {loading ? (
        <div className="text-center py-12">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto"></div>
          <p className="mt-2 text-muted-foreground">{tc("loading")}</p>
        </div>
      ) : datasets.length === 0 ? (
        <div className="text-center py-12">
          <Database className="h-12 w-12 mx-auto mb-4 opacity-50" />
          <h3 className="text-lg font-medium mb-2">{t("noDatasets")}</h3>
          <p className="text-muted-foreground mb-4">{t("noDatasetsDesc")}</p>
          <Button
            onClick={() => {
              resetCreateDialogState();
              setShowCreateDialog(true);
            }}
          >
            <Plus className="h-4 w-4 mr-2" />
            {t("createDataset")}
          </Button>
        </div>
      ) : (
        <>
          {user?.isSuperAdmin ? (
            // 超级管理员：按租户分组显示
            (() => {
              const { groups, groupOrder } = groupDatasetsByTenant(datasets);

              return (
                <div className="space-y-8">
                  {groupOrder.map((tenantName) => (
                    <div key={tenantName}>
                      <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
                        <div className="flex items-center gap-2 min-w-0 flex-1">
                          <Building2 className="h-5 w-5 text-primary shrink-0" />
                          <h3 className="text-lg font-semibold text-foreground truncate">
                            {tenantName}
                          </h3>
                          <span className="text-sm text-muted-foreground shrink-0">
                            (
                            {t("knowledgeBaseCount", {
                              count: filterDatasetsByVisibility(
                                groups[tenantName],
                                getVisibilityFilter(tenantName)
                              ).length,
                            })}
                            )
                          </span>
                        </div>

                        <Tabs
                          value={getVisibilityFilter(tenantName)}
                          onValueChange={(value) => setVisibilityFilter(tenantName, value)}
                        >
                          <TabsList className="h-8">
                            <TabsTrigger value="all" className="text-xs px-2 py-1 h-6">
                              {tc("all")}
                            </TabsTrigger>
                            <TabsTrigger
                              value="public"
                              className="text-xs px-2 py-1 h-6 flex items-center gap-1"
                            >
                              <Globe className="h-3 w-3" />
                              {t("public")}
                            </TabsTrigger>
                            <TabsTrigger
                              value="tenant"
                              className="text-xs px-2 py-1 h-6 flex items-center gap-1"
                            >
                              <Building2 className="h-3 w-3" />
                              {t("tenant")}
                            </TabsTrigger>
                            <TabsTrigger
                              value="dept"
                              className="text-xs px-2 py-1 h-6 flex items-center gap-1"
                            >
                              <Users className="h-3 w-3" />
                              {t("dept")}
                            </TabsTrigger>
                            <TabsTrigger
                              value="private"
                              className="text-xs px-2 py-1 h-6 flex items-center gap-1"
                            >
                              <Lock className="h-3 w-3" />
                              {t("private")}
                            </TabsTrigger>
                          </TabsList>
                        </Tabs>
                      </div>
                      {filterDatasetsByVisibility(
                        groups[tenantName],
                        getVisibilityFilter(tenantName)
                      ).length === 0 ? (
                        <div className="text-center py-8 text-muted-foreground">
                          <Database className="h-8 w-8 mx-auto mb-2 opacity-50" />
                          <p>{t("noDatasetsInCategory")}</p>
                        </div>
                      ) : (
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                          {filterDatasetsByVisibility(
                            groups[tenantName],
                            getVisibilityFilter(tenantName)
                          ).map((dataset) => (
                            <DatasetCard
                              key={dataset.id}
                              dataset={dataset}
                              onSelect={handleSelect}
                              onEdit={handleEdit}
                              onDelete={handleDelete}
                            />
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              );
            })()
          ) : (
            // 普通用户：正常网格显示
            <div>
              <div className="flex items-center justify-end mb-4">
                <Tabs
                  value={getVisibilityFilter("__user__")}
                  onValueChange={(value) => setVisibilityFilter("__user__", value)}
                >
                  <TabsList className="h-8">
                    <TabsTrigger value="all" className="text-xs px-2 py-1 h-6">
                      {tc("all")}
                    </TabsTrigger>
                    <TabsTrigger
                      value="public"
                      className="text-xs px-2 py-1 h-6 flex items-center gap-1"
                    >
                      <Globe className="h-3 w-3" />
                      {t("public")}
                    </TabsTrigger>
                    <TabsTrigger
                      value="tenant"
                      className="text-xs px-2 py-1 h-6 flex items-center gap-1"
                    >
                      <Building2 className="h-3 w-3" />
                      {t("tenant")}
                    </TabsTrigger>
                    <TabsTrigger
                      value="dept"
                      className="text-xs px-2 py-1 h-6 flex items-center gap-1"
                    >
                      <Users className="h-3 w-3" />
                      {t("dept")}
                    </TabsTrigger>
                    <TabsTrigger
                      value="private"
                      className="text-xs px-2 py-1 h-6 flex items-center gap-1"
                    >
                      <Lock className="h-3 w-3" />
                      {t("private")}
                    </TabsTrigger>
                  </TabsList>
                </Tabs>
              </div>

              {filterDatasetsByVisibility(datasets, getVisibilityFilter("__user__")).length ===
              0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  <Database className="h-8 w-8 mx-auto mb-2 opacity-50" />
                  <p>{t("noDatasetsInCategory")}</p>
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                  {filterDatasetsByVisibility(datasets, getVisibilityFilter("__user__")).map(
                    (dataset) => (
                      <DatasetCard
                        key={dataset.id}
                        dataset={dataset}
                        onSelect={handleSelect}
                        onEdit={handleEdit}
                        onDelete={handleDelete}
                      />
                    )
                  )}
                </div>
              )}
            </div>
          )}
        </>
      )}

      {/* 创建数据集对话框 */}
      <Dialog.Root open={showCreateDialog} onOpenChange={setShowCreateDialog}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 bg-black/30 z-50" />
          <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-full max-w-md -translate-x-1/2 -translate-y-1/2 rounded-lg bg-card shadow-lg max-h-[90vh] flex flex-col">
            <Dialog.Title className="text-lg font-bold mb-4 px-6 pt-6">
              {t("createDataset")}
            </Dialog.Title>

            <div className="flex-1 overflow-y-auto px-6">
              <div className="space-y-4">
                {/* 租户和部门选择 */}
                <div className="pb-3 border-b">
                  <div className="flex items-center gap-4 text-sm">
                    {/* 租户选择/显示 */}
                    <div className="flex items-center gap-2 flex-1 min-w-0">
                      <span className="font-medium text-foreground whitespace-nowrap">
                        {t("tenantLabel")}：
                      </span>
                      {isSuperAdmin ? (
                        // 超级管理员：可以修改租户
                        <select
                          className="flex-1 min-w-0 border rounded px-2 py-1.5"
                          value={selectedTenantId || ""}
                          onChange={(e) =>
                            setSelectedTenantId(e.target.value ? Number(e.target.value) : null)
                          }
                          disabled={creating}
                        >
                          <option value="">{t("tenantPlaceholder")}</option>
                          {tenants.map((tenant) => (
                            <option key={tenant.id} value={tenant.id}>
                              {tenant.name}
                            </option>
                          ))}
                        </select>
                      ) : (
                        // 租户管理员、部门管理员、普通用户：只显示当前租户
                        <div className="flex-1 min-w-0 px-2 py-1.5 bg-muted border rounded text-muted-foreground">
                          {user?.tenant_name || t("notSet")}
                        </div>
                      )}
                    </div>

                    {/* 部门选择/显示 */}
                    <div className="flex items-center gap-2 flex-1 min-w-0">
                      {isSuperAdmin || isTenantAdmin ? (
                        // 超级管理员和租户管理员：可以修改部门
                        <DeptSelect
                          depts={filteredDepts}
                          value={selectedDeptId}
                          onChange={setSelectedDeptId}
                          disabled={creating || (isSuperAdmin && !selectedTenantId)}
                          placeholder={t("deptPlaceholder")}
                          className="flex-1 min-w-0 border rounded px-2 py-1.5 text-sm"
                        />
                      ) : (
                        // 部门管理员和普通用户：只显示当前部门
                        <div className="flex-1 min-w-0 px-2 py-1.5 bg-muted border rounded text-muted-foreground">
                          {user?.dept_name || t("notSet")}
                        </div>
                      )}
                    </div>
                  </div>
                </div>

                <DatasetSettings
                  datasetName={datasetName}
                  setDatasetName={setDatasetName}
                  datasetDescription={datasetDescription}
                  setDatasetDescription={setDatasetDescription}
                  datasetVisibility={datasetVisibility}
                  setDatasetVisibility={setDatasetVisibility}
                  autoFocus
                  splitMode={splitMode}
                  setSplitMode={setSplitMode}
                  fixedLength={fixedLength}
                  setFixedLength={setFixedLength}
                  segmentModel={segmentModel}
                  setSegmentModel={setSegmentModel}
                  contentParsing={contentParsing}
                  setContentParsing={setContentParsing}
                  enhanced={enhanced}
                  setEnhanced={setEnhanced}
                  enableOcr={enableOcr}
                  setEnableOcr={setEnableOcr}
                  promptType={promptType}
                  setPromptType={setPromptType}
                  vectorWeight={vectorWeight}
                  setVectorWeight={setVectorWeight}
                  textWeight={textWeight}
                  setTextWeight={setTextWeight}
                  rerankService={rerankService}
                  setRerankService={setRerankService}
                  showAdvancedSettings={showAdvancedSettings}
                  setShowAdvancedSettings={setShowAdvancedSettings}
                  disabled={creating}
                  isEditMode={false}
                />
              </div>
            </div>

            <div className="flex gap-2 justify-end mt-6 px-6 pb-6 border-t pt-4 flex-shrink-0">
              <Button
                variant="outline"
                onClick={() => {
                  setShowCreateDialog(false);
                  resetCreateDialogState();
                }}
                disabled={creating}
              >
                {tc("cancel")}
              </Button>
              <Button onClick={handleCreate} disabled={creating || !datasetName.trim()}>
                {creating ? t("creating") : tc("create")}
              </Button>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>

      {/* 编辑数据集对话框 */}
      <Dialog.Root open={showEditDialog} onOpenChange={setShowEditDialog}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 bg-black/30 z-50" />
          <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-full max-w-md -translate-x-1/2 -translate-y-1/2 rounded-lg bg-card shadow-lg max-h-[90vh] flex flex-col">
            <div className="flex items-start justify-between mb-4 px-6 pt-6">
              <Dialog.Title className="text-lg font-bold">{t("editDataset")}</Dialog.Title>
              {/* 创建者显示 */}
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <span>
                  {t("owner")}: {ownerName}
                </span>
                {isSuperAdmin && (
                  <button
                    onClick={() => setShowUserSearchDialog(true)}
                    className="flex items-center gap-1 text-muted-foreground hover:text-foreground transition-colors"
                    title={t("modifyOwner")}
                  >
                    <Edit2 className="h-3 w-3" />
                  </button>
                )}
              </div>
            </div>

            <div className="flex-1 overflow-y-auto px-6">
              <div className="space-y-4">
                <div className="pb-3 border-b">
                  <div className="flex items-center gap-4 text-sm">
                    {/* 租户 */}
                    <div className="flex items-center gap-2 flex-1 min-w-0">
                      <span className="font-medium text-foreground whitespace-nowrap">
                        {t("tenantLabel")}：
                      </span>
                      {isSuperAdmin ? (
                        <select
                          className="flex-1 min-w-0 border rounded px-2 py-1.5"
                          value={selectedTenantId || ""}
                          onChange={(e) =>
                            setSelectedTenantId(e.target.value ? Number(e.target.value) : null)
                          }
                          disabled={updating}
                        >
                          <option value="">{t("tenantPlaceholder")}</option>
                          {tenants.map((tenant) => (
                            <option key={tenant.id} value={tenant.id}>
                              {tenant.name}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <div className="flex-1 min-w-0 px-2 py-1.5 bg-muted border rounded text-muted-foreground">
                          {editingDataset?.owner_tenant_name || user?.tenant_name || t("notSet")}
                        </div>
                      )}
                    </div>

                    {/* 部门 */}
                    <div className="flex items-center gap-2 flex-1 min-w-0">
                      {isSuperAdmin || isTenantAdmin ? (
                        <DeptSelect
                          depts={filteredDepts}
                          value={selectedDeptId}
                          onChange={setSelectedDeptId}
                          disabled={updating || (isSuperAdmin && !selectedTenantId)}
                          placeholder={t("deptPlaceholder")}
                          className="flex-1 min-w-0 border rounded px-2 py-1.5 text-sm"
                        />
                      ) : (
                        <div className="flex-1 min-w-0 px-2 py-1.5 bg-muted border rounded text-muted-foreground">
                          {editingDataset?.owner_dept_name || user?.dept_name || t("notSet")}
                        </div>
                      )}
                    </div>
                  </div>
                </div>

                <DatasetSettings
                  datasetName={datasetName}
                  setDatasetName={setDatasetName}
                  datasetDescription={datasetDescription}
                  setDatasetDescription={setDatasetDescription}
                  datasetVisibility={datasetVisibility}
                  setDatasetVisibility={setDatasetVisibility}
                  autoFocus
                  splitMode={splitMode}
                  setSplitMode={setSplitMode}
                  fixedLength={fixedLength}
                  setFixedLength={setFixedLength}
                  segmentModel={segmentModel}
                  setSegmentModel={setSegmentModel}
                  contentParsing={contentParsing}
                  setContentParsing={setContentParsing}
                  enhanced={enhanced}
                  setEnhanced={setEnhanced}
                  enableOcr={enableOcr}
                  setEnableOcr={setEnableOcr}
                  promptType={promptType}
                  setPromptType={setPromptType}
                  vectorWeight={vectorWeight}
                  setVectorWeight={setVectorWeight}
                  textWeight={textWeight}
                  setTextWeight={setTextWeight}
                  rerankService={rerankService}
                  setRerankService={setRerankService}
                  showAdvancedSettings={showAdvancedSettings}
                  setShowAdvancedSettings={setShowAdvancedSettings}
                  disabled={updating}
                  isEditMode={true}
                  editingDataset={editingDataset}
                />
              </div>
            </div>

            <div className="flex gap-2 justify-end mt-6 px-6 pb-6 border-t pt-4 flex-shrink-0">
              <Button
                variant="outline"
                onClick={() => {
                  setShowEditDialog(false);
                  resetEditDialogState();
                }}
                disabled={updating}
              >
                {tc("cancel")}
              </Button>
              <Button onClick={handleUpdate} disabled={updating || !datasetName.trim()}>
                {updating ? t("updating") : tc("update")}
              </Button>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>

      {/* 用户搜索对话框 */}
      <UserSearchDialog
        isOpen={showUserSearchDialog}
        onClose={() => setShowUserSearchDialog(false)}
        onSelect={handleUserSelect}
        currentUserId={editingDataset?.user_id}
      />
    </div>
  );
}
