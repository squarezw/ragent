"use client";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useSystemSettings } from "@/hooks/useSystemSettings";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { CheckCircle, Info, Mail, Shield, Lock, User } from "lucide-react";
import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import axios from "axios";
import { useTranslations } from "next-intl";

const RATE_LIMIT_STORAGE_KEY = "forgot_password_retry_after";

export default function ForgotPasswordPage() {
  const router = useRouter();
  const t = useTranslations("password");
  const tLogin = useTranslations("login");
  const [username, setUsername] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);
  const [countdown, setCountdown] = useState(0);

  // 计算剩余秒数
  const calculateRemainingSeconds = useCallback(() => {
    if (typeof window === "undefined") return 0;
    const retryAfter = localStorage.getItem(RATE_LIMIT_STORAGE_KEY);
    if (!retryAfter) return 0;
    const retryTime = new Date(retryAfter).getTime();
    const now = Date.now();
    const remaining = Math.ceil((retryTime - now) / 1000);
    if (remaining <= 0) {
      localStorage.removeItem(RATE_LIMIT_STORAGE_KEY);
      return 0;
    }
    return remaining;
  }, []);

  // 页面加载时检查是否有限制
  useEffect(() => {
    const remaining = calculateRemainingSeconds();
    if (remaining > 0) {
      setCountdown(remaining);
      setError(t("rateLimitError"));
    }
  }, [calculateRemainingSeconds, t]);

  // 倒计时效果
  useEffect(() => {
    if (countdown <= 0) return;
    const timer = setInterval(() => {
      const remaining = calculateRemainingSeconds();
      if (remaining <= 0) {
        setCountdown(0);
        setError("");
        clearInterval(timer);
      } else {
        setCountdown(remaining);
      }
    }, 1000);
    return () => clearInterval(timer);
  }, [countdown, calculateRemainingSeconds]);

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

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    if (!username) {
      setError(t("usernameRequired"));
      return;
    }

    setIsLoading(true);

    try {
      // 获取当前页面的完整 URL（包括协议、主机和端口）
      const baseUrl = typeof window !== "undefined" ? window.location.origin : "";

      const response = await axios.post("/api/v1/password/forgot", {
        username,
        baseUrl,
      });

      if (response.data.success) {
        setSuccess(true);
      }
    } catch (err: unknown) {
      const axiosError = err as {
        response?: {
          status?: number;
          data?: { error?: string; retryAfter?: string };
        };
      };
      if (axiosError.response?.status === 429) {
        const retryAfter = axiosError.response.data?.retryAfter;
        if (retryAfter) {
          localStorage.setItem(RATE_LIMIT_STORAGE_KEY, retryAfter);
          const remaining = calculateRemainingSeconds();
          setCountdown(remaining);
        }
        setError(axiosError.response.data?.error || t("rateLimitError"));
      } else {
        setError(axiosError.response?.data?.error || t("sendFailed"));
      }
    } finally {
      setIsLoading(false);
    }
  };

  if (success) {
    return (
      <div className="w-screen h-screen flex">
        {/* 左侧系统介绍 */}
        {shouldShowCustomHtml && loginLeftPanelHtml ? (
          <div
            className="hidden md:flex md:w-1/2 h-full"
            // biome-ignore lint/security/noDangerouslySetInnerHtml: 需要渲染用户自定义的 HTML
            dangerouslySetInnerHTML={{ __html: loginLeftPanelHtml }}
          />
        ) : (
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
                    <p className="text-gray-600">
                      {platformSubtitle || tLogin("platformSubtitle")}
                    </p>
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
        )}

        {/* 右侧成功消息 */}
        <div className="w-full md:w-1/2 h-full flex items-center justify-center p-8">
          <div className="w-full max-w-md">
            <Card className="shadow-lg">
              <CardHeader>
                <div className="flex justify-center mb-4">
                  <div className="flex h-12 w-12 items-center justify-center rounded-full bg-green-100">
                    <CheckCircle className="h-6 w-6 text-green-600" />
                  </div>
                </div>
                <CardTitle className="text-center">{t("emailSent")}</CardTitle>
                <CardDescription className="text-center">{t("checkEmail")}</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <Alert>
                  <Mail className="h-4 w-4" />
                  <AlertDescription>{t("emailSentDesc")}</AlertDescription>
                </Alert>

                <Alert>
                  <Info className="h-4 w-4" />
                  <AlertDescription>{t("linkValidFor")}</AlertDescription>
                </Alert>

                <div className="space-y-2">
                  <Button className="w-full" onClick={() => router.push("/")}>
                    {t("backToLogin")}
                  </Button>
                  <Button variant="outline" className="w-full" onClick={() => setSuccess(false)}>
                    {t("resend")}
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

  return (
    <div className="w-screen h-screen flex">
      {/* 左侧系统介绍 */}
      {shouldShowCustomHtml && loginLeftPanelHtml ? (
        <div
          className="hidden md:flex md:w-1/2 h-full"
          // biome-ignore lint/security/noDangerouslySetInnerHtml: 需要渲染用户自定义的 HTML
          dangerouslySetInnerHTML={{ __html: loginLeftPanelHtml }}
        />
      ) : (
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
      )}

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
            <h1 className="text-2xl font-bold text-gray-900">{platformName || t("forgotTitle")}</h1>
          </div>

          <Card className="shadow-lg">
            <CardHeader>
              <CardTitle className="text-center">{t("forgotTitle")}</CardTitle>
              <CardDescription className="text-center">{t("forgotDesc")}</CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleSubmit} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="username">{t("username")}</Label>
                  <div className="relative">
                    <User className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input
                      id="username"
                      type="text"
                      placeholder={t("usernamePlaceholder")}
                      value={username}
                      onChange={(e) => setUsername(e.target.value)}
                      disabled={isLoading}
                      className="pl-10"
                    />
                  </div>
                </div>

                {error && (
                  <Alert variant="destructive">
                    <AlertDescription>
                      {error}
                      {countdown > 0 && (
                        <span className="ml-1">
                          （{Math.floor(countdown / 60)}:{String(countdown % 60).padStart(2, "0")}）
                        </span>
                      )}
                    </AlertDescription>
                  </Alert>
                )}

                <Alert>
                  <Info className="h-4 w-4" />
                  <AlertDescription>{t("linkWillExpire")}</AlertDescription>
                </Alert>

                <Button
                  type="submit"
                  className="w-full"
                  disabled={isLoading || !username || countdown > 0}
                >
                  {isLoading ? t("sending") : t("sendResetLink")}
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
