"use client";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useSystemSettings } from "@/hooks/useSystemSettings";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { CheckCircle, Info, Shield, Lock, AlertCircle, Eye, EyeOff } from "lucide-react";
import { useState, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import axios from "axios";
import { validatePassword } from "@/lib/utils";
import { useTranslations } from "next-intl";

export default function ResetPasswordPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const token = searchParams.get("token");
  const t = useTranslations("password");
  const tLogin = useTranslations("login");

  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isVerifying, setIsVerifying] = useState(true);
  const [tokenValid, setTokenValid] = useState(false);
  const [tokenError, setTokenError] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);

  // 系统设置
  const {
    platformLogo,
    platformName,
    platformSubtitle,
    loginLeftPanelHtml,
    loading: systemSettingsLoading,
  } = useSystemSettings();

  // 判断是否应该显示自定义 HTML
  const shouldShowCustomHtml = !systemSettingsLoading && !!loginLeftPanelHtml?.trim();

  // 验证令牌
  useEffect(() => {
    const verifyToken = async () => {
      if (!token) {
        setTokenError(t("missingToken"));
        setIsVerifying(false);
        return;
      }

      try {
        const response = await axios.get(`/api/v1/password/verify-token?token=${token}`);

        if (response.data.valid) {
          setTokenValid(true);
        } else {
          setTokenError(response.data.message || t("invalidLink"));
        }
      } catch (err) {
        setTokenError(t("verifyFailed"));
      } finally {
        setIsVerifying(false);
      }
    };

    verifyToken();
  }, [token, t]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    // 验证新密码
    const passwordError = validatePassword(newPassword);
    if (passwordError) {
      setError(passwordError);
      return;
    }

    // 验证密码确认
    if (newPassword !== confirmPassword) {
      setError(t("passwordMismatch"));
      return;
    }

    setIsLoading(true);

    try {
      const response = await axios.post("/api/v1/password/reset", {
        token,
        newPassword,
      });

      if (response.data.success) {
        setSuccess(true);
        // 3秒后跳转到登录页
        setTimeout(() => {
          router.push("/");
        }, 3000);
      }
    } catch (err: unknown) {
      const error = err as { response?: { data?: { error?: string } } };
      setError(error.response?.data?.error || t("resetFailed"));
    } finally {
      setIsLoading(false);
    }
  };

  const renderLeftPanel = () => {
    if (shouldShowCustomHtml && loginLeftPanelHtml) {
      return (
        <div
          className="hidden md:flex md:w-1/2 h-full"
          // biome-ignore lint/security/noDangerouslySetInnerHtml: 需要渲染用户自定义的 HTML
          dangerouslySetInnerHTML={{ __html: loginLeftPanelHtml }}
        />
      );
    }

    return (
      <div className="hidden md:flex md:w-1/2 h-full items-center justify-center bg-gradient-to-br from-blue-50 to-indigo-100">
        <div className="w-[340px] space-y-6">
          <div className="space-y-4">
            <div className="flex items-center gap-3">
              {platformLogo && (
                <img
                  src={platformLogo}
                  alt="Platform Logo"
                  className="h-12 w-auto max-w-[80px] object-contain"
                  onError={(e) => {
                    e.currentTarget.style.display = "none";
                  }}
                />
              )}
              <div>
                <h1 className="text-2xl font-bold text-gray-900">
                  {platformName || tLogin("platformName")}
                </h1>
                <p className="text-gray-600">{platformSubtitle || tLogin("platformSubtitle")}</p>
              </div>
            </div>
          </div>

          <div className="space-y-4">
            <div className="flex items-center gap-3">
              <div className="flex h-8 w-8 items-center justify-center rounded-full bg-green-100">
                <CheckCircle className="h-5 w-5 text-green-600" />
              </div>
              <div>
                <p className="font-medium">{tLogin("feature1Title")}</p>
                <p className="text-sm text-gray-600">{tLogin("feature1Desc")}</p>
              </div>
            </div>

            <div className="flex items-center gap-3">
              <div className="flex h-8 w-8 items-center justify-center rounded-full bg-blue-100">
                <Shield className="h-5 w-5 text-blue-600" />
              </div>
              <div>
                <p className="font-medium">{tLogin("feature2Title")}</p>
                <p className="text-sm text-gray-600">{tLogin("feature2Desc")}</p>
              </div>
            </div>

            <div className="flex items-center gap-3">
              <div className="flex h-8 w-8 items-center justify-center rounded-full bg-purple-100">
                <Lock className="h-5 w-5 text-purple-600" />
              </div>
              <div>
                <p className="font-medium">{tLogin("feature3Title")}</p>
                <p className="text-sm text-gray-600">{tLogin("feature3Desc")}</p>
              </div>
            </div>
          </div>

          <Alert>
            <Shield className="h-4 w-4" />
            <AlertDescription>{tLogin("deploymentTip")}</AlertDescription>
          </Alert>
        </div>
      </div>
    );
  };

  // 令牌验证中
  if (isVerifying) {
    return (
      <div className="w-screen h-screen flex">
        {renderLeftPanel()}
        <div className="w-full md:w-1/2 h-full flex items-center justify-center p-8">
          <div className="w-full max-w-md">
            <Card className="shadow-lg">
              <CardContent className="pt-6">
                <div className="text-center py-8">
                  <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mx-auto mb-4" />
                  <p className="text-gray-600">{t("verifying")}</p>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    );
  }

  // 令牌无效
  if (!tokenValid) {
    return (
      <div className="w-screen h-screen flex">
        {renderLeftPanel()}
        <div className="w-full md:w-1/2 h-full flex items-center justify-center p-8">
          <div className="w-full max-w-md">
            <Card className="shadow-lg">
              <CardHeader>
                <div className="flex justify-center mb-4">
                  <div className="flex h-12 w-12 items-center justify-center rounded-full bg-red-100">
                    <AlertCircle className="h-6 w-6 text-red-600" />
                  </div>
                </div>
                <CardTitle className="text-center">{t("linkInvalid")}</CardTitle>
                <CardDescription className="text-center">{tokenError}</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <Alert variant="destructive">
                  <AlertCircle className="h-4 w-4" />
                  <AlertDescription>{t("linkInvalidDesc")}</AlertDescription>
                </Alert>

                <div className="space-y-2">
                  <Button className="w-full" onClick={() => router.push("/forgot-password")}>
                    {t("requestAgain")}
                  </Button>
                  <Button variant="outline" className="w-full" onClick={() => router.push("/")}>
                    {t("backToLogin")}
                  </Button>
                </div>
              </CardContent>
            </Card>

            <div className="mt-6 space-y-3">
              <p className="text-center text-xs text-gray-500">{tLogin("copyright")}</p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // 重置成功
  if (success) {
    return (
      <div className="w-screen h-screen flex">
        {renderLeftPanel()}
        <div className="w-full md:w-1/2 h-full flex items-center justify-center p-8">
          <div className="w-full max-w-md">
            <Card className="shadow-lg">
              <CardHeader>
                <div className="flex justify-center mb-4">
                  <div className="flex h-12 w-12 items-center justify-center rounded-full bg-green-100">
                    <CheckCircle className="h-6 w-6 text-green-600" />
                  </div>
                </div>
                <CardTitle className="text-center">{t("resetSuccess")}</CardTitle>
                <CardDescription className="text-center">{t("resetSuccessDesc")}</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <Alert>
                  <Info className="h-4 w-4" />
                  <AlertDescription>{t("redirecting")}</AlertDescription>
                </Alert>

                <Button className="w-full" onClick={() => router.push("/")}>
                  {t("loginNow")}
                </Button>
              </CardContent>
            </Card>

            <div className="mt-6 space-y-3">
              <p className="text-center text-xs text-gray-500">{tLogin("copyright")}</p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // 重置密码表单
  return (
    <div className="w-screen h-screen flex">
      {renderLeftPanel()}

      {/* 右侧表单 */}
      <div className="w-full md:w-1/2 h-full flex items-center justify-center p-8">
        <div className="w-full max-w-md">
          <div className="text-center mb-6 md:hidden">
            {!systemSettingsLoading && platformLogo && (
              <div className="flex justify-center mb-4">
                <img
                  src={platformLogo}
                  alt="Platform Logo"
                  className="h-16 w-auto max-w-[120px] object-contain"
                  onError={(e) => {
                    e.currentTarget.style.display = "none";
                  }}
                />
              </div>
            )}
            <h1 className="text-2xl font-bold text-gray-900">{platformName || t("resetTitle")}</h1>
          </div>

          <Card className="shadow-lg">
            <CardHeader>
              <CardTitle className="text-center">{t("setNewPassword")}</CardTitle>
              <CardDescription className="text-center">{t("setNewPasswordDesc")}</CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleSubmit} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="newPassword">{t("newPassword")}</Label>
                  <div className="relative">
                    <Input
                      id="newPassword"
                      type={showPassword ? "text" : "password"}
                      placeholder={t("newPasswordPlaceholder")}
                      value={newPassword}
                      onChange={(e) => setNewPassword(e.target.value)}
                      disabled={isLoading}
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="absolute right-0 top-0 h-full px-3 py-2 hover:bg-transparent"
                      onClick={() => setShowPassword(!showPassword)}
                    >
                      {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </Button>
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="confirmPassword">{t("confirmPassword")}</Label>
                  <div className="relative">
                    <Input
                      id="confirmPassword"
                      type={showConfirmPassword ? "text" : "password"}
                      placeholder={t("confirmPasswordPlaceholder")}
                      value={confirmPassword}
                      onChange={(e) => setConfirmPassword(e.target.value)}
                      disabled={isLoading}
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="absolute right-0 top-0 h-full px-3 py-2 hover:bg-transparent"
                      onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                    >
                      {showConfirmPassword ? (
                        <EyeOff className="h-4 w-4" />
                      ) : (
                        <Eye className="h-4 w-4" />
                      )}
                    </Button>
                  </div>
                </div>

                {error && (
                  <Alert variant="destructive">
                    <AlertCircle className="h-4 w-4" />
                    <AlertDescription>{error}</AlertDescription>
                  </Alert>
                )}

                <Alert>
                  <Info className="h-4 w-4" />
                  <AlertDescription>{t("passwordRequirements")}</AlertDescription>
                </Alert>

                <Button
                  type="submit"
                  className="w-full"
                  disabled={isLoading || !newPassword || !confirmPassword}
                >
                  {isLoading ? t("resetting") : t("resetPassword")}
                </Button>

                <div className="text-center">
                  <Button
                    type="button"
                    variant="link"
                    onClick={() => router.push("/")}
                    className="text-sm"
                  >
                    {t("backToLogin")}
                  </Button>
                </div>
              </form>
            </CardContent>
          </Card>

          <div className="mt-6 space-y-3">
            <p className="text-center text-xs text-gray-500">{tLogin("copyright")}</p>
          </div>
        </div>
      </div>
    </div>
  );
}
