"use client";
import { useEffect, useState } from "react";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Building2, Users, ShieldCheck, QrCode } from "lucide-react";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import axios from "@/lib/axios";
import { validatePassword } from "@/lib/utils";
import { useTranslations } from "next-intl";

interface UserInfo {
  id: number;
  username: string;
  nickname: string;
  email: string;
  tenant_id?: number;
  dept_id?: number;
  status: string;
  tenant_name?: string;
  dept_name?: string;
  wechat_id?: string;
  roles?: Array<{
    id: number;
    name: string;
    isSystem: boolean;
  }>;
}

export default function SettingsPage() {
  const { user, loading } = useCurrentUser();
  const [userInfo, setUserInfo] = useState<UserInfo | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [showWechatQR, setShowWechatQR] = useState(false);
  const [qrCodeUrl, setQrCodeUrl] = useState("");
  const [qrLoading, setQrLoading] = useState(false);
  const t = useTranslations("settings");
  const te = useTranslations("errors");
  const ts = useTranslations("success");
  const tc = useTranslations("common");

  const [form, setForm] = useState({
    nickname: "",
    email: "",
    currentPassword: "",
    newPassword: "",
    confirmPassword: "",
  });

  useEffect(() => {
    if (user) {
      setUserInfo(user);
      setForm({
        nickname: user.nickname || "",
        email: user.email || "",
        currentPassword: "",
        newPassword: "",
        confirmPassword: "",
      });
    }
  }, [user]);

  const handleSaveProfile = async () => {
    setError("");
    setSuccess("");

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!form.nickname || !form.email) {
      setError(te("requiredFields"));
      return;
    }
    if (!emailRegex.test(form.email)) {
      setError(te("invalidEmail"));
      return;
    }

    setSaving(true);
    try {
      await axios.put("/api/user/update", {
        id: user?.id,
        nickname: form.nickname,
        email: form.email,
      });

      // 更新本地用户信息
      if (userInfo) {
        setUserInfo({
          ...userInfo,
          nickname: form.nickname,
          email: form.email,
        });
      }

      setSuccess(ts("personalInfoUpdated"));
    } catch (error: any) {
      if (error.response?.status === 409) {
        setError(te("emailInUse"));
      } else {
        setError(te("updateFailed"));
      }
      console.error("更新个人信息失败:", error);
    } finally {
      setSaving(false);
    }
  };

  const handleChangePassword = async () => {
    setError("");
    setSuccess("");

    if (!form.currentPassword || !form.newPassword || !form.confirmPassword) {
      setError(te("passwordChangeRequired"));
      return;
    }

    if (form.newPassword !== form.confirmPassword) {
      setError(te("passwordMismatch"));
      return;
    }

    const passwordError = validatePassword(form.newPassword);
    if (passwordError) {
      setError(passwordError);
      return;
    }

    setSaving(true);
    try {
      await axios.put("/api/user/update", {
        id: user?.id,
        currentPassword: form.currentPassword,
        password: form.newPassword,
      });

      setSuccess(ts("passwordChanged"));
      setForm({
        ...form,
        currentPassword: "",
        newPassword: "",
        confirmPassword: "",
      });
    } catch (error: any) {
      if (error.response?.status === 400) {
        setError(te("wrongPassword"));
      } else {
        setError(te("passwordChangeFailed"));
      }
      console.error("修改密码失败:", error);
    } finally {
      setSaving(false);
    }
  };

  const handleWechatBind = async () => {
    setError("");
    setSuccess("");

    // 先打开弹窗并显示loading
    setShowWechatQR(true);
    setQrLoading(true);

    try {
      // 调用内部API转发企业微信OAuth授权接口
      const response = await axios.get("/api/wechat/oauth/authorize");

      if (response.data.success && response.data.data.oauth_url) {
        // 使用OAuth URL生成二维码
        const oauthUrl = response.data.data.oauth_url;
        const qrCodeUrl = `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(oauthUrl)}`;
        setQrCodeUrl(qrCodeUrl);
      } else {
        setError(te("wechatAuthFailed"));
        setShowWechatQR(false);
      }
    } catch (error: any) {
      setError(te("qrGenerationFailed"));
      console.error("生成企业微信二维码失败:", error);
      setShowWechatQR(false);
    } finally {
      setQrLoading(false);
    }
  };

  const handleWechatUnbind = async () => {
    setError("");
    setSuccess("");

    if (!confirm(t("confirmUnbind"))) {
      return;
    }

    setSaving(true);
    try {
      await axios.put("/api/user/update", {
        id: user?.id,
        wechat_id: null,
      });

      // 更新本地用户信息
      if (userInfo) {
        setUserInfo({
          ...userInfo,
          wechat_id: undefined,
        });
      }

      setSuccess(ts("wechatUnbound"));
    } catch (error: any) {
      setError(te("unbindFailed"));
      console.error("解绑企业微信失败:", error);
    } finally {
      setSaving(false);
    }
  };

  // 显示加载状态 - 包括数据加载和 userInfo 同步
  if (loading || !userInfo) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
        <span className="ml-2">{loading ? tc("loading") : t("syncingUserData")}</span>
      </div>
    );
  }

  // 如果没有用户信息，显示错误
  if (!user) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="text-center">
          <p className="text-muted-foreground">{t("cannotLoadUser")}</p>
          <Button variant="outline" className="mt-2" onClick={() => window.location.reload()}>
            {t("reload")}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* 账户信息和个人信息并排显示 */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* 账户信息卡片 */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <ShieldCheck className="h-5 w-5" />
              {t("accountInfo")}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 gap-4">
              <div>
                <label className="block text-sm font-medium mb-1">{t("username")}</label>
                <Input value={userInfo.username} disabled />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">{t("userId")}</label>
                <Input value={userInfo.id.toString()} disabled />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">{t("identity")}</label>
                <Badge
                  variant={
                    userInfo.roles?.[0]?.isSystem && userInfo.roles?.[0]?.name === "超级管理员"
                      ? "default"
                      : "outline"
                  }
                  className="w-fit"
                >
                  {userInfo.roles?.[0]?.name || t("normalUser")}
                </Badge>
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">{tc("status")}</label>
                <Badge variant={userInfo.status === "active" ? "default" : "secondary"}>
                  {userInfo.status === "active" ? tc("active") : tc("inactive")}
                </Badge>
              </div>
            </div>

            {userInfo.tenant_name && (
              <div className="flex items-center gap-2 p-3 bg-muted rounded-lg">
                <Building2 className="h-4 w-4 text-muted-foreground" />
                <span className="text-sm text-muted-foreground">{userInfo.tenant_name}</span>
              </div>
            )}

            {userInfo.dept_name && (
              <div className="flex items-center gap-2 p-3 bg-muted rounded-lg">
                <Users className="h-4 w-4 text-muted-foreground" />
                <span className="text-sm text-muted-foreground">{userInfo.dept_name}</span>
              </div>
            )}
          </CardContent>
        </Card>

        {/* 个人信息编辑 */}
        <Card>
          <CardHeader>
            <CardTitle>{t("personalInfo")}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 gap-4">
              <div>
                <label className="block text-sm font-medium mb-1">{t("nickname")} *</label>
                <Input
                  value={form.nickname}
                  onChange={(e) => setForm({ ...form, nickname: e.target.value })}
                  placeholder={t("nicknamePlaceholder")}
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">{t("email")} *</label>
                <Input
                  value={form.email}
                  onChange={(e) => setForm({ ...form, email: e.target.value })}
                  placeholder={t("emailPlaceholder")}
                />
              </div>
            </div>

            {error && <div className="text-destructive text-sm">{error}</div>}
            {success && <div className="text-green-600 text-sm">{success}</div>}

            <div className="flex gap-2">
              <Button onClick={handleSaveProfile} disabled={saving}>
                {saving ? t("saving") : t("savePersonalInfo")}
              </Button>
              {userInfo.wechat_id ? (
                <Button
                  variant="outline"
                  onClick={handleWechatUnbind}
                  disabled={saving}
                  className="flex items-center gap-2"
                >
                  <QrCode className="h-4 w-4" />
                  {t("wechatUnbind")}
                </Button>
              ) : (
                <Button
                  variant="outline"
                  onClick={handleWechatBind}
                  disabled={saving}
                  className="flex items-center gap-2"
                >
                  <QrCode className="h-4 w-4" />
                  {t("wechatBind")}
                </Button>
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* 修改密码 */}
      <Card>
        <CardHeader>
          <CardTitle>{t("changePassword")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 gap-4">
            <div>
              <label className="block text-sm font-medium mb-1">{t("currentPassword")} *</label>
              <Input
                type="password"
                value={form.currentPassword}
                onChange={(e) => setForm({ ...form, currentPassword: e.target.value })}
                placeholder={t("currentPasswordPlaceholder")}
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">{t("newPassword")} *</label>
              <Input
                type="password"
                value={form.newPassword}
                onChange={(e) => setForm({ ...form, newPassword: e.target.value })}
                placeholder={t("newPasswordPlaceholder")}
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">{t("confirmPassword")} *</label>
              <Input
                type="password"
                value={form.confirmPassword}
                onChange={(e) => setForm({ ...form, confirmPassword: e.target.value })}
                placeholder={t("confirmPasswordPlaceholder")}
              />
            </div>
          </div>

          <Button onClick={handleChangePassword} disabled={saving}>
            {saving ? t("changingPassword") : t("changePassword")}
          </Button>
        </CardContent>
      </Card>

      {/* 企业微信二维码弹窗 */}
      {showWechatQR && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-background rounded-lg p-6 max-w-sm w-full mx-4 border">
            <div className="text-center">
              <h3 className="text-lg font-semibold mb-4">{t("wechatBindTitle")}</h3>
              <div className="mb-4 min-h-[200px] flex items-center justify-center">
                {qrLoading ? (
                  <div className="flex flex-col items-center justify-center">
                    <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mb-4"></div>
                    <p className="text-sm text-muted-foreground">{t("generatingQR")}</p>
                  </div>
                ) : (
                  <div>
                    <img src={qrCodeUrl} alt="WeChat QR Code" className="mx-auto border rounded" />
                    <p className="text-sm text-muted-foreground mt-4">{t("wechatScanTip")}</p>
                  </div>
                )}
              </div>
              <Button
                onClick={() => {
                  setShowWechatQR(false);
                  setQrLoading(false);
                  setQrCodeUrl("");
                }}
                variant="outline"
                className="w-full"
              >
                {tc("close")}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
