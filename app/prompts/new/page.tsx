"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import axios from "@/lib/axios";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { toast } from "sonner";
import { useTranslations } from "next-intl";

export default function NewPromptPage() {
  const router = useRouter();
  const { user, loading } = useCurrentUser();
  const t = useTranslations("prompts");
  const tc = useTranslations("common");

  const [saving, setSaving] = useState(false);
  const [formData, setFormData] = useState({
    role: "",
    content: "",
    visibility: "dept" as "private" | "dept" | "tenant" | "public",
    is_default: false,
    is_active: true,
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!formData.role.trim()) {
      alert(t("roleRequired"));
      return;
    }

    if (!formData.content.trim()) {
      alert(t("contentRequired"));
      return;
    }

    try {
      setSaving(true);
      await axios.post("/api/prompts", formData);
      toast.success(t("createSuccess"));
      router.push("/prompts");
    } catch (error: any) {
      console.error("创建失败:", error);
      if (error.response?.status === 403) {
        toast.error(t("noPermission"));
        router.push("/prompts");
      } else {
        toast.error(error.response?.data?.error || t("createFailed"));
      }
    } finally {
      setSaving(false);
    }
  };

  const handleCancel = () => {
    router.push("/prompts");
  };

  // 显示加载状态
  if (loading) {
    return (
      <div className="container mx-auto p-6">
        <div className="text-center">{tc("loading")}</div>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="container mx-auto p-6">
        <div className="text-center">{t("cannotLoadUser")}</div>
      </div>
    );
  }

  return (
    <div className="container mx-auto p-6 max-w-4xl">
      <div className="flex justify-end mb-6">
        <div className="flex gap-2">
          <Button variant="outline" onClick={handleCancel}>
            {tc("cancel")}
          </Button>
          <Button onClick={handleSubmit} disabled={saving}>
            {saving ? t("creating") : t("create")}
          </Button>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{t("promptInfo")}</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="space-y-2">
                <Label htmlFor="role">{t("roleName")} *</Label>
                <Input
                  id="role"
                  value={formData.role}
                  onChange={(e) => setFormData({ ...formData, role: e.target.value })}
                  placeholder={t("roleNamePlaceholder")}
                  required
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="visibility">{t("visibility")}</Label>
                <Select
                  value={formData.visibility}
                  onValueChange={(value: "private" | "dept" | "tenant" | "public") =>
                    setFormData({ ...formData, visibility: value })
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="private">{t("visibilityPrivate")}</SelectItem>
                    <SelectItem value="dept">{t("visibilityDept")}</SelectItem>
                    <SelectItem value="tenant">{t("visibilityTenant")}</SelectItem>
                    <SelectItem value="public">{t("visibilityPublic")}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="content">{t("promptContent")} *</Label>
              <Textarea
                id="content"
                value={formData.content}
                onChange={(e) => setFormData({ ...formData, content: e.target.value })}
                placeholder={t("promptContentPlaceholder")}
                rows={8}
                required
              />
              <div className="text-sm text-muted-foreground">{t("availableVariables")}</div>
            </div>

            <Separator />

            <div className="space-y-4">
              <div className="flex items-center space-x-2">
                <Checkbox
                  id="is_default"
                  checked={formData.is_default}
                  onCheckedChange={(checked) =>
                    setFormData({ ...formData, is_default: checked as boolean })
                  }
                />
                <Label htmlFor="is_default">{t("setAsDefault")}</Label>
                {formData.is_default && <Badge variant="secondary">{t("default")}</Badge>}
              </div>

              <div className="flex items-center space-x-2">
                <Checkbox
                  id="is_active"
                  checked={formData.is_active}
                  onCheckedChange={(checked) =>
                    setFormData({ ...formData, is_active: checked as boolean })
                  }
                />
                <Label htmlFor="is_active">{t("enablePrompt")}</Label>
                {!formData.is_active && <Badge variant="destructive">{t("disabled")}</Badge>}
              </div>
            </div>

            <div className="text-sm text-muted-foreground">
              <p>• {t("defaultPromptTip")}</p>
              <p>• {t("enableTip")}</p>
              <p>• {t("visibilityTip")}</p>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
