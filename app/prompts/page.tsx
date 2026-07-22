"use client";

import React, { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { checkSuperAdmin } from "@/lib/clientPermissions";
import axios from "@/lib/axios";
import { toast } from "sonner";
import { useTranslations } from "next-intl";

interface Prompt {
  id: number;
  role: string;
  content: string;
  is_default: boolean;
  is_active: boolean;
  user_id: number;
  visibility: "private" | "dept" | "tenant" | "public";
  owner_dept_id?: number;
  owner_tenant_id?: number;
  created_at: string;
  updated_at: string;
  creator_name?: string;
  creator_dept?: string;
}

interface AssociatedApp {
  id: number;
  name: string;
  description: string | null;
  app_type: string;
  platform: string;
  created_at: string;
}

const PromptManagement = () => {
  const t = useTranslations("prompts");
  const tc = useTranslations("common");
  const router = useRouter();
  const { user, loading: userLoading } = useCurrentUser();
  const [prompts, setPrompts] = useState<Prompt[]>([]);
  const [loading, setLoading] = useState(true);
  const [hasPermission, setHasPermission] = useState(false);
  const [isSuperAdmin, setIsSuperAdmin] = useState(false);
  const [showAssociatedAppsModal, setShowAssociatedAppsModal] = useState(false);
  const [associatedApps, setAssociatedApps] = useState<AssociatedApp[]>([]);
  const [selectedPromptName, setSelectedPromptName] = useState("");

  const fetchPrompts = async () => {
    try {
      const response = await axios.get("/api/prompts");
      setPrompts(response.data);
      setHasPermission(true);
    } catch (error: any) {
      if (error.response?.status === 403) {
        toast.error(t("noPermission"));
        router.push("/");
      } else {
        toast.error(tc("loadFailed"));
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchPrompts();
  }, []);

  // 在用户信息加载完成后检查权限
  useEffect(() => {
    if (user) {
      setIsSuperAdmin(checkSuperAdmin(user));
    }
  }, [user]);

  const handleDelete = async (id: number) => {
    if (!confirm(t("deleteConfirm"))) return;
    try {
      await axios.delete(`/api/prompts/${id}`);
      toast.success(tc("deleted"));
      fetchPrompts();
    } catch (error) {
      toast.error(tc("deleteFailed"));
    }
  };

  const handleToggleDefault = async (prompt: Prompt) => {
    try {
      await axios.put(`/api/prompts/${prompt.id}`, {
        ...prompt,
        is_default: !prompt.is_default,
      });
      toast.success(prompt.is_default ? t("cancelledDefault") : t("setDefault"));
      fetchPrompts();
    } catch (error) {
      toast.error(tc("operationFailed"));
    }
  };

  const handleToggleActive = async (prompt: Prompt) => {
    // 如果是要停用提示词，先检查是否有关联的应用
    if (prompt.is_active) {
      try {
        const response = await axios.get(`/api/prompts/${prompt.id}/associated-apps`);
        const { count, apps } = response.data;

        if (count > 0) {
          // 有关联应用，显示弹窗
          setAssociatedApps(apps);
          setSelectedPromptName(prompt.role);
          setShowAssociatedAppsModal(true);
          return;
        }
      } catch (error) {
        console.error("检查关联应用失败:", error);
        toast.error(tc("operationFailed"));
        return;
      }
    }

    // 没有关联应用或是启用操作，直接执行
    try {
      await axios.put(`/api/prompts/${prompt.id}`, {
        ...prompt,
        is_active: !prompt.is_active,
      });
      toast.success(prompt.is_active ? t("promptDisabled") : t("promptEnabled"));
      fetchPrompts();
    } catch (error) {
      toast.error(tc("operationFailed"));
    }
  };

  const handleEdit = (prompt: Prompt) => {
    router.push(`/prompts/${prompt.id}`);
  };

  const getVisibilityLabel = (visibility: string) => {
    const labelKeys: Record<string, string> = {
      private: "private",
      dept: "dept",
      tenant: "tenant",
      public: "public",
    };
    return t(labelKeys[visibility] || visibility);
  };

  const getVisibilityColor = (visibility: string) => {
    const colors = {
      private: "bg-muted text-foreground",
      dept: "bg-blue-100 text-blue-800",
      tenant: "bg-green-100 text-green-800",
      public: "bg-purple-100 text-purple-800",
    };
    return colors[visibility as keyof typeof colors] || "bg-muted text-foreground";
  };

  if (!user) {
    return <div className="flex items-center justify-center h-64">{t("pleaseLogin")}</div>;
  }

  if (loading) {
    return <div className="flex items-center justify-center h-64">{tc("loading")}</div>;
  }

  if (!hasPermission) {
    return <div className="flex items-center justify-center h-64">{t("noPermission")}</div>;
  }

  return (
    <div className="container mx-auto p-6">
      <div className="flex justify-between items-center mb-6">
        <div>
          <p className="text-muted-foreground mt-2">{t("description")}</p>
          {isSuperAdmin && <p className="text-orange-600 text-sm mt-1">🔧 {t("superAdminMode")}</p>}
          {!prompts.some((p) => p.is_default && p.is_active) && (
            <p className="text-primary text-sm mt-1">💡 {t("noDefaultPrompt")}</p>
          )}
        </div>
        <Button onClick={() => router.push("/prompts/new")}>{t("createPrompt")}</Button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {prompts.map((prompt) => (
          <Card key={prompt.id} className="h-full flex flex-col hover:shadow-lg transition-shadow">
            <CardHeader className="pb-3">
              <div className="flex items-start justify-between">
                <div className="flex-1 min-w-0">
                  <CardTitle className="text-lg truncate mb-2">{prompt.role}</CardTitle>
                  <div className="flex flex-wrap gap-1 mb-2">
                    {prompt.is_default && (
                      <Badge variant="secondary" className="text-xs">
                        {t("isDefault")}
                      </Badge>
                    )}
                    {!prompt.is_active && (
                      <Badge variant="destructive" className="text-xs">
                        {t("disabled")}
                      </Badge>
                    )}
                    <Badge className={`text-xs ${getVisibilityColor(prompt.visibility)}`}>
                      {getVisibilityLabel(prompt.visibility)}
                    </Badge>
                  </div>
                  <CardDescription className="text-xs text-muted-foreground">
                    {t("creator")}: {prompt.creator_name || t("unknown")}
                    {prompt.creator_dept && ` | ${prompt.creator_dept}`}
                  </CardDescription>
                </div>
              </div>
            </CardHeader>

            <CardContent className="flex-1 flex flex-col">
              <div className="flex-1">
                <div className="text-sm text-foreground whitespace-pre-wrap line-clamp-4 mb-3">
                  {prompt.content}
                </div>
                <div className="text-xs text-muted-foreground">
                  {t("updatedAt")}: {new Date(prompt.updated_at).toLocaleString()}
                </div>
              </div>

              <Separator className="my-3" />

              <div className="flex flex-wrap gap-2">
                {isSuperAdmin && (
                  <Button
                    size="sm"
                    variant={prompt.is_default ? "secondary" : "outline"}
                    onClick={() => handleToggleDefault(prompt)}
                    disabled={prompt.is_default}
                    className="text-xs"
                  >
                    {prompt.is_default ? t("isDefault") : t("setAsDefault")}
                  </Button>
                )}

                {/* 超级管理员可以停用和开启任何提示词 */}
                {isSuperAdmin && (
                  <Button
                    size="sm"
                    variant={prompt.is_active ? "outline" : "secondary"}
                    onClick={() => handleToggleActive(prompt)}
                    className="text-xs"
                  >
                    {prompt.is_active ? t("disable") : t("enable")}
                  </Button>
                )}

                {/* 超级管理员可以编辑所有提示词 */}
                {isSuperAdmin && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => handleEdit(prompt)}
                    className="text-xs"
                  >
                    {tc("edit")}
                  </Button>
                )}

                {/* 普通用户只能操作自己的提示词 */}
                {!isSuperAdmin && user && prompt.user_id === user.id && (
                  <Button
                    size="sm"
                    variant={prompt.is_active ? "outline" : "secondary"}
                    onClick={() => handleToggleActive(prompt)}
                    className="text-xs"
                  >
                    {prompt.is_active ? t("disable") : t("enable")}
                  </Button>
                )}

                {/* 只有普通用户且是自己的提示词才能编辑 */}
                {!isSuperAdmin && user && prompt.user_id === user.id && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => handleEdit(prompt)}
                    className="text-xs"
                  >
                    {tc("edit")}
                  </Button>
                )}

                {/* 超级管理员只能删除已停用的提示词 */}
                {isSuperAdmin && !prompt.is_active && (
                  <Button
                    size="sm"
                    variant="destructive"
                    onClick={() => handleDelete(prompt.id)}
                    className="text-xs"
                  >
                    {tc("delete")}
                  </Button>
                )}

                {/* 只有普通用户且是自己的提示词且已停用且不是默认提示词才能删除 */}
                {!isSuperAdmin &&
                  user &&
                  prompt.user_id === user.id &&
                  !prompt.is_active &&
                  !prompt.is_default && (
                    <Button
                      size="sm"
                      variant="destructive"
                      onClick={() => handleDelete(prompt.id)}
                      className="text-xs"
                    >
                      {tc("delete")}
                    </Button>
                  )}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {prompts.length === 0 && (
        <div className="col-span-full">
          <Card>
            <CardContent className="text-center py-12">
              <div className="text-gray-400 mb-4">
                <svg
                  className="mx-auto h-12 w-12"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={1}
                    d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
                  />
                </svg>
              </div>
              <h3 className="text-lg font-medium text-foreground mb-2">{t("noPrompts")}</h3>
              <p className="text-muted-foreground mb-4">{t("noPromptsDesc")}</p>
              <Button onClick={() => router.push("/prompts/new")}>{t("createFirst")}</Button>
            </CardContent>
          </Card>
        </div>
      )}

      {/* 关联应用提示弹窗 */}
      <Dialog open={showAssociatedAppsModal} onOpenChange={setShowAssociatedAppsModal}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="text-destructive">{t("cannotDisable")}</DialogTitle>
            <DialogDescription>
              {t("promptInUse", { name: selectedPromptName, count: associatedApps.length })}
            </DialogDescription>
          </DialogHeader>
          <div className="max-h-60 overflow-y-auto">
            <div className="space-y-2">
              {associatedApps.map((app) => (
                <div key={app.id} className="p-3 bg-muted rounded-lg border">
                  <div className="font-medium text-sm truncate">{app.name}</div>
                  <div className="text-xs text-muted-foreground flex items-center gap-2 mt-1">
                    <Badge variant="outline" className="text-xs">
                      {app.platform}
                    </Badge>
                    <span>{app.app_type}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowAssociatedAppsModal(false)}>
              {t("iKnow")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default PromptManagement;
