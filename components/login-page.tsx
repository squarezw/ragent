"use client";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useSystemSettings } from "@/hooks/useSystemSettings";
import axios from "@/lib/axios";
import { interactionPath, submitIdentityInteraction } from "@/lib/identityInteraction";
import { renderTemplate } from "@/lib/htmlSanitizer";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  CheckCircle,
  Eye,
  EyeOff,
  Info,
  Lock,
  Shield,
  Smartphone,
  User,
  UserPlus,
} from "lucide-react";
import { useEffect, useState } from "react";
import { loadCloudbaseAuth, type VerificationInfo } from "@/lib/cloudbaseClient";
import Link from "next/link";
import { useTranslations } from "next-intl";
import LocaleSwitcher from "@/components/LocaleSwitcher";
import type { SiteConfig } from "@/app/layout";

interface LoginPageProps {
  onLogin: () => void;
  siteConfig: SiteConfig;
  interactionUid?: string;
}

export function LoginPage({ onLogin, siteConfig, interactionUid }: LoginPageProps) {
  const [loginMethod, setLoginMethod] = useState<"password" | "register">("password");
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [step, setStep] = useState(1); // 1: 选择登录方式, 2: 二次验证
  const [formData, setFormData] = useState({
    username: "",
    password: "",
    confirmPassword: "",
    phone: "",
    smsCode: "",
    agreeTerms: true,
    rememberPassword: false,
  });
  const [loginError, setLoginError] = useState("");
  const [registerError, setRegisterError] = useState("");
  const [registerSuccess, setRegisterSuccess] = useState(false);
  const t = useTranslations("login");
  const [credentialMethod, setCredentialMethod] = useState<"password" | "sms">("password");
  const [cloudbaseEnv, setCloudbaseEnv] = useState<string>();
  const [verificationInfo, setVerificationInfo] = useState<VerificationInfo>();
  const [registrationToken, setRegistrationToken] = useState("");
  const [smsCooldown, setSmsCooldown] = useState(0);
  const [interactionCsrf, setInteractionCsrf] = useState("");

  useEffect(() => {
    if (interactionUid) {
      fetch(interactionPath(interactionUid) + "/context", {
        credentials: "same-origin",
        cache: "no-store",
      })
        .then(async (response) => {
          if (!response.ok) throw Error("Invalid interaction");
          return response.json();
        })
        .then((data) => {
          setCloudbaseEnv(data.cloudbaseEnvId || undefined);
          setInteractionCsrf(data.csrf || "");
        })
        .catch(() => setLoginError(t("identityUnavailable")));
      return;
    }
    axios
      .get("/api/user/phone-config")
      .then((response) => {
        setCloudbaseEnv(response.data.envId || undefined);
      })
      .catch(() => {});
  }, [interactionUid]);

  useEffect(() => {
    if (!smsCooldown) return;
    const timer = setTimeout(() => setSmsCooldown(smsCooldown - 1), 1000);
    return () => clearTimeout(timer);
  }, [smsCooldown]);

  const resetPhoneVerification = () => {
    setVerificationInfo(undefined);
    setRegistrationToken("");
    setLoginError("");
    setRegisterError("");
    setRegisterSuccess(false);
    setFormData((previous) => ({ ...previous, smsCode: "" }));
  };

  const finishLogin = (token: unknown) => {
    if (interactionUid) throw new Error("Central interaction cannot create a local login");
    if (typeof token !== "string" || !token) throw new Error("INVALID_CREDENTIALS");
    localStorage.setItem("ragent_token", token);
    onLogin();
  };

  // 系统设置
  const {
    platformLogo,
    platformName,
    platformSubtitle,
    loginLeftPanelHtml,
    loading: systemSettingsLoading,
  } = useSystemSettings();

  // 判断是否应该显示自定义 HTML（只有在加载完成且有非空值时才显示）
  const shouldShowCustomHtml = !systemSettingsLoading && !!loginLeftPanelHtml?.trim();

  const phoneErrorMessage = (
    error: unknown,
    fallback:
      | "phoneSendFailed"
      | "phoneVerificationFailed"
      | "phoneLoginFailed"
      | "phoneRegistrationFailed"
  ) => {
    const code = (error as { response?: { data?: { errorCode?: string } } } | null)?.response?.data
      ?.errorCode;
    const messages: Record<string, string> = {
      PHONE_NOT_REGISTERED: "phoneNotRegistered",
      PHONE_ALREADY_REGISTERED: "phoneAlreadyRegistered",
      PHONE_ACCOUNT_AMBIGUOUS: "phoneAccountAmbiguous",
      PHONE_IDENTITY_CONFLICT: "phoneIdentityConflict",
      ACCOUNT_DISABLED: "phoneAccountDisabled",
      AUTH_SCHEMA_NOT_READY: "phoneSchemaNotReady",
      AUTH_UNAVAILABLE: "phoneServiceUnavailable",
      INVALID_CREDENTIALS: "phoneCredentialExpired",
      PHONE_IDENTITY_REQUIRED: "phoneIdentityRequired",
      INVALID_USERNAME: "phoneInvalidUsername",
      PASSWORD_LENGTH: "phonePasswordLength",
      PASSWORD_TOO_LONG: "phonePasswordTooLong",
    };
    return t((code && messages[code]) || fallback);
  };

  const handleRegister = async () => {
    setRegisterError("");
    setRegisterSuccess(false);
    if (
      !registrationToken ||
      !formData.username ||
      !formData.password ||
      !formData.confirmPassword
    ) {
      setRegisterError(t("enterAllFields"));
      return;
    }
    if (!/^[A-Za-z0-9_]{3,32}$/.test(formData.username)) {
      setRegisterError(t("phoneInvalidUsername"));
      return;
    }
    if (formData.password.length < 6) {
      setRegisterError(t("phonePasswordLength"));
      return;
    }
    if (new TextEncoder().encode(formData.password).length > 72) {
      setRegisterError(t("phonePasswordTooLong"));
      return;
    }
    if (formData.password !== formData.confirmPassword) {
      setRegisterError(t("passwordMismatch"));
      return;
    }
    if (!formData.agreeTerms) {
      setRegisterError(t("agreeTermsRequired"));
      return;
    }
    setIsLoading(true);
    try {
      if (interactionUid) {
        const redirectTo = await submitIdentityInteraction(
          interactionUid,
          interactionCsrf,
          {
            username: formData.username,
            password: formData.password,
            access_token: registrationToken,
          },
          true
        );
        const client = await loadCloudbaseAuth(cloudbaseEnv);
        await client.signOut().catch(() => {});
        window.location.assign(redirectTo);
        return;
      }
      const response = await axios.post("/api/user/phone", {
        mode: "register",
        accessToken: registrationToken,
        username: formData.username,
        password: formData.password,
      });
      const client = await loadCloudbaseAuth(cloudbaseEnv);
      await client.signOut().catch(() => {});
      setRegisterSuccess(true);
      finishLogin(response.data.token);
    } catch (error) {
      setRegisterError(phoneErrorMessage(error, "phoneRegistrationFailed"));
    } finally {
      setIsLoading(false);
    }
  };

  const handlePasswordLogin = async () => {
    setLoginError("");
    if (!formData.username || !formData.password) {
      setLoginError(t("enterUsernameAndPassword"));
      return;
    }
    setIsLoading(true);
    try {
      if (interactionUid) {
        const redirectTo = await submitIdentityInteraction(interactionUid, interactionCsrf, {
          username: formData.username,
          password: formData.password,
        });
        window.location.assign(redirectTo);
        return;
      }
      const res = await axios.post("/api/user/login", {
        username: formData.username,
        password: formData.password,
      });
      finishLogin(res.data.token);
    } catch (e: unknown) {
      const error = e as { response?: { data?: { error?: string } } };
      setLoginError(error.response?.data?.error || t("loginFailed"));
    } finally {
      setIsLoading(false);
    }
  };

  const handleSMSVerification = async () => {
    const setError = loginMethod === "register" ? setRegisterError : setLoginError;
    setError("");
    if (!verificationInfo || !/^\d{6}$/.test(formData.smsCode)) {
      setError(t("phoneSendFirst"));
      return;
    }
    if (!formData.agreeTerms) {
      setError(t("agreeTermsRequired"));
      return;
    }
    setIsLoading(true);
    try {
      const client = await loadCloudbaseAuth(cloudbaseEnv);
      await client.signInWithSms({
        phoneNum: `+86 ${formData.phone}`,
        verificationCode: formData.smsCode,
        verificationInfo,
      });
      const { accessToken } = await client.getAccessToken();
      if (interactionUid) {
        if (loginMethod === "register") {
          setRegistrationToken(accessToken);
          setFormData((previous) => ({ ...previous, password: "", confirmPassword: "" }));
        } else {
          const redirectTo = await submitIdentityInteraction(interactionUid, interactionCsrf, {
            access_token: accessToken,
          });
          await client.signOut().catch(() => {});
          window.location.assign(redirectTo);
        }
        return;
      }
      const response = await axios.post("/api/user/phone", {
        mode: loginMethod === "register" ? "verify" : "login",
        accessToken,
      });
      if (loginMethod === "register") {
        setRegistrationToken(accessToken);
        setFormData((previous) => ({ ...previous, password: "", confirmPassword: "" }));
      } else {
        await client.signOut().catch(() => {});
        finishLogin(response.data.token);
      }
    } catch (error) {
      setError(
        phoneErrorMessage(
          error,
          loginMethod === "register" ? "phoneVerificationFailed" : "phoneLoginFailed"
        )
      );
    } finally {
      setIsLoading(false);
    }
  };

  const sendSMSCode = async () => {
    const setError = loginMethod === "register" ? setRegisterError : setLoginError;
    setError("");
    if (!/^1\d{10}$/.test(formData.phone)) {
      setError(t("phoneInvalidNumber"));
      return;
    }
    setIsLoading(true);
    try {
      const client = await loadCloudbaseAuth(cloudbaseEnv);
      const info = await client.getVerification({ phone_number: `+86 ${formData.phone}` });
      setVerificationInfo(info);
      setSmsCooldown(60);
    } catch (error) {
      setError(phoneErrorMessage(error, "phoneSendFailed"));
    } finally {
      setIsLoading(false);
    }
  };

  const renderPhoneFields = (prefix: string, hidePhoneLabel = false) => (
    <>
      <div className="space-y-2">
        {!hidePhoneLabel && <Label htmlFor={`${prefix}Phone`}>{t("phoneNumber")}</Label>}
        <Input
          id={`${prefix}Phone`}
          type="tel"
          inputMode="tel"
          autoComplete="tel-national"
          placeholder={t("phoneNumberPlaceholder")}
          value={formData.phone}
          disabled={isLoading}
          maxLength={11}
          onChange={(event) => {
            resetPhoneVerification();
            setFormData((previous) => ({ ...previous, phone: event.target.value, smsCode: "" }));
          }}
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor={`${prefix}SmsCode`}>{t("verificationCode")}</Label>
        <div className="flex gap-2">
          <Input
            id={`${prefix}SmsCode`}
            inputMode="numeric"
            autoComplete="one-time-code"
            placeholder={t("verificationCodePlaceholder")}
            value={formData.smsCode}
            disabled={isLoading}
            maxLength={6}
            onChange={(event) =>
              setFormData({ ...formData, smsCode: event.target.value.replace(/\D/g, "") })
            }
          />
          <Button
            type="button"
            variant="outline"
            onClick={sendSMSCode}
            disabled={
              isLoading || !cloudbaseEnv || smsCooldown > 0 || !/^1\d{10}$/.test(formData.phone)
            }
          >
            {smsCooldown ? t("phoneResendCountdown", { seconds: smsCooldown }) : t("phoneSend")}
          </Button>
        </div>
      </div>
      {!cloudbaseEnv && (
        <p role="status" className="text-sm text-muted-foreground">
          {t("phoneUnavailable")}
        </p>
      )}
    </>
  );

  if (step === 2) {
    return (
      <div className="h-screen w-screen flex bg-gradient-to-br from-primary-50 via-background to-primary-50 overflow-hidden">
        {/* Left Panel - Brand Information */}
        {systemSettingsLoading ? (
          // 加载中：隐藏左侧面板，与右侧背景一致
          <div className="hidden lg:block lg:w-1/2" />
        ) : shouldShowCustomHtml && loginLeftPanelHtml ? (
          // 加载完成且有自定义 HTML：显示自定义 HTML
          // biome-ignore lint/security/noDangerouslySetInnerHtml: 需要渲染用户自定义的 HTML，已通过 sanitizeHtml 清理
          <div
            className="hidden lg:flex lg:w-1/2"
            dangerouslySetInnerHTML={{
              __html: renderTemplate(loginLeftPanelHtml, {
                platformName: platformName || "",
                platformLogo: platformLogo || "",
                platformSubtitle: platformSubtitle || "",
              }),
            }}
          />
        ) : (
          // 加载完成但没有自定义 HTML：显示默认内容
          <div className="hidden lg:flex lg:w-1/2 p-12 items-center justify-center relative overflow-hidden bg-primary">
            {/* Decorative diagonal element */}
            <div className="absolute inset-0 opacity-10">
              <div className="absolute -right-48 top-0 bottom-0 w-96 rotate-12 bg-card"></div>
              <div className="absolute -right-24 top-0 bottom-0 w-96 rotate-12 bg-card"></div>
            </div>

            <div className="relative z-10 max-w-lg text-white">
              {platformLogo && (
                <div className="mb-6">
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
              <h1 className="text-4xl font-bold mb-4 text-balance">
                {platformName || t("platformName")}
              </h1>
              <p className="text-xl mb-12 opacity-90 text-balance">
                {platformSubtitle || t("platformSubtitle")}
              </p>
            </div>
          </div>
        )}

        {/* Right Panel - Verification Form */}
        <div className="w-full lg:w-1/2 flex items-center justify-center p-8">
          <div className="w-full max-w-md">
            <div className="bg-card rounded-2xl shadow-xl p-8 border border-border">
              <div className="text-center mb-8">
                <div className="flex justify-center mb-4">
                  <div className="flex h-12 w-12 items-center justify-center rounded-full bg-success/10">
                    <Smartphone className="h-6 w-6 text-success" />
                  </div>
                </div>
                <h2 className="text-3xl font-bold mb-2 text-primary">{t("smsVerification")}</h2>
                <p className="text-muted-foreground">
                  {t("smsSentTo", {
                    phone: formData.phone.replace(/(\d{3})\d{4}(\d{4})/, "$1****$2"),
                  })}
                </p>
              </div>

              <div className="space-y-5">
                <div>
                  <Label htmlFor="smsCode" className="text-sm font-medium text-primary">
                    {t("verificationCode")}
                  </Label>
                  <div className="flex gap-2 mt-1.5">
                    <Input
                      id="smsCode"
                      placeholder={t("verificationCodePlaceholder")}
                      value={formData.smsCode}
                      onChange={(e) => setFormData({ ...formData, smsCode: e.target.value })}
                      maxLength={6}
                      className="flex-1 h-11 border-input focus:border-primary focus:ring-primary"
                    />
                    <Button
                      variant="outline"
                      onClick={sendSMSCode}
                      className="h-11 border-primary text-primary"
                    >
                      {t("resend")}
                    </Button>
                  </div>
                </div>

                <Alert>
                  <Info className="h-4 w-4" />
                  <AlertDescription>{t("verificationTip")}</AlertDescription>
                </Alert>

                <Button
                  className="w-full h-12 text-base font-medium shadow-lg shadow-primary/20 hover:shadow-xl hover:shadow-primary/30 transition-all bg-primary"
                  onClick={handleSMSVerification}
                  disabled={isLoading || !formData.smsCode}
                >
                  {isLoading ? t("verifying") : t("verifyButton")}
                </Button>

                <div className="text-center">
                  <Button
                    variant="ghost"
                    onClick={() => setStep(1)}
                    className="text-sm text-primary"
                  >
                    {t("backToLogin")}
                  </Button>
                </div>
              </div>
            </div>

            {/* Footer */}
            <div className="mt-8 text-center text-sm text-muted-foreground">
              <p>{t("copyright")}</p>
              {siteConfig.icpNumber ? (
                <p>
                  <a href={siteConfig.icpBeianUrl} target="_blank" rel="noopener noreferrer">
                    {siteConfig.icpNumber}
                  </a>
                </p>
              ) : null}
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="w-screen h-screen flex overflow-hidden">
      {/* 左侧系统介绍 */}
      {shouldShowCustomHtml && loginLeftPanelHtml ? (
        // 加载完成且有自定义 HTML：显示自定义 HTML
        // biome-ignore lint/security/noDangerouslySetInnerHtml: 需要渲染用户自定义的 HTML，已通过 sanitizeHtml 清理
        <div
          className="hidden md:flex md:w-1/2 h-full"
          dangerouslySetInnerHTML={{
            __html: renderTemplate(loginLeftPanelHtml, {
              platformName: platformName || "",
              platformLogo: platformLogo || "",
              platformSubtitle: platformSubtitle || "",
            }),
          }}
        />
      ) : (
        // 加载完成但没有自定义 HTML 或加载中：显示默认内容
        <div className="hidden md:flex md:w-1/2 h-full items-center justify-center bg-gradient-to-br from-blue-50 to-indigo-100">
          <div className="w-[340px] space-y-6">
            <div className="space-y-4">
              <div className="flex items-center gap-3">
                {systemSettingsLoading ? (
                  <>
                    {platformLogo && (
                      <div className="h-12 w-12 rounded-full bg-gray-200 animate-pulse" />
                    )}
                    <div className="flex-1">
                      <div className="h-7 w-32 bg-gray-200 rounded animate-pulse mb-2" />
                      <div className="h-4 w-48 bg-gray-200 rounded animate-pulse" />
                    </div>
                  </>
                ) : (
                  <>
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
                        {platformName || t("platformName")}
                      </h1>
                      <p className="text-gray-600">{platformSubtitle || t("platformSubtitle")}</p>
                    </div>
                  </>
                )}
              </div>
            </div>

            <div className="space-y-4">
              <div className="flex items-center gap-3">
                <div className="flex h-8 w-8 items-center justify-center rounded-full bg-green-100">
                  <CheckCircle className="h-5 w-5 text-green-600" />
                </div>
                <div>
                  <p className="font-medium">{t("feature1Title")}</p>
                  <p className="text-sm text-gray-600">{t("feature1Desc")}</p>
                </div>
              </div>

              <div className="flex items-center gap-3">
                <div className="flex h-8 w-8 items-center justify-center rounded-full bg-blue-100">
                  <Shield className="h-5 w-5 text-blue-600" />
                </div>
                <div>
                  <p className="font-medium">{t("feature2Title")}</p>
                  <p className="text-sm text-gray-600">{t("feature2Desc")}</p>
                </div>
              </div>

              <div className="flex items-center gap-3">
                <div className="flex h-8 w-8 items-center justify-center rounded-full bg-purple-100">
                  <Lock className="h-5 w-5 text-purple-600" />
                </div>
                <div>
                  <p className="font-medium">{t("feature3Title")}</p>
                  <p className="text-sm text-gray-600">{t("feature3Desc")}</p>
                </div>
              </div>
            </div>

            <Alert>
              <Shield className="h-4 w-4" />
              <AlertDescription>{t("deploymentTip")}</AlertDescription>
            </Alert>
          </div>
        </div>
      )}

      {/* 右侧登录表单 */}
      <div className="w-full md:w-1/2 h-full flex flex-col items-center justify-center p-8 min-w-0">
        <div className="w-full max-w-md flex flex-col">
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
            {systemSettingsLoading && (
              <div className="flex justify-center mb-4">
                <div className="h-16 w-16 rounded-full bg-gray-200 animate-pulse" />
              </div>
            )}
            {systemSettingsLoading ? (
              <>
                <div className="h-7 w-32 bg-gray-200 rounded animate-pulse mx-auto mb-2" />
                <div className="h-4 w-48 bg-gray-200 rounded animate-pulse mx-auto" />
              </>
            ) : (
              <>
                <h1 className="text-2xl font-bold text-gray-900">
                  {platformName || t("platformName")}
                </h1>
                {platformSubtitle && (
                  <p className="text-sm text-gray-600 mt-1">{platformSubtitle}</p>
                )}
              </>
            )}
          </div>

          <Card className="shadow-lg w-full">
            <CardHeader className="relative">
              <div className="absolute right-4 top-4">
                <LocaleSwitcher />
              </div>
              <CardTitle className="text-center">{t("title")}</CardTitle>
              <CardDescription className="text-center">{t("subtitle")}</CardDescription>
            </CardHeader>
            <CardContent>
              <Tabs
                value={loginMethod}
                onValueChange={(value) => {
                  if (isLoading) return;
                  resetPhoneVerification();
                  setLoginMethod(value as "password" | "register");
                }}
                className="space-y-4"
              >
                <TabsList className="grid w-full grid-cols-2">
                  <TabsTrigger value="password" className="flex items-center gap-2">
                    <User className="h-4 w-4" />
                    {t("phoneSignIn")}
                  </TabsTrigger>
                  <TabsTrigger value="register" className="flex items-center gap-2">
                    <UserPlus className="h-4 w-4" />
                    {t("register")}
                  </TabsTrigger>
                </TabsList>

                <TabsContent value="password" className="space-y-4">
                  <div className="space-y-4">
                    <div className="flex items-center justify-between gap-2">
                      <Label htmlFor={credentialMethod === "password" ? "username" : "loginPhone"}>
                        {credentialMethod === "password" ? t("username") : t("phoneNumber")}
                      </Label>
                      <div
                        role="group"
                        aria-label={`${t("passwordLogin")} / ${t("phoneSmsTab")}`}
                        className="inline-flex gap-1 rounded-lg border border-border bg-muted p-1"
                      >
                        <Button
                          type="button"
                          variant="ghost"
                          className={`h-9 cursor-pointer rounded-md px-4 text-sm font-medium transition-colors focus-visible:ring-2 focus-visible:ring-ring ${credentialMethod === "password" ? "bg-primary/10 text-primary shadow-sm hover:bg-primary/15 hover:text-primary" : "text-muted-foreground hover:bg-background hover:text-foreground"}`}
                          disabled={isLoading}
                          aria-pressed={credentialMethod === "password"}
                          onClick={() => {
                            resetPhoneVerification();
                            setCredentialMethod("password");
                          }}
                        >
                          {t("passwordLogin")}
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          className={`h-9 cursor-pointer rounded-md px-4 text-sm font-medium transition-colors focus-visible:ring-2 focus-visible:ring-ring ${credentialMethod === "sms" ? "bg-primary/10 text-primary shadow-sm hover:bg-primary/15 hover:text-primary" : "text-muted-foreground hover:bg-background hover:text-foreground"}`}
                          disabled={isLoading}
                          aria-pressed={credentialMethod === "sms"}
                          onClick={() => {
                            resetPhoneVerification();
                            setCredentialMethod("sms");
                          }}
                        >
                          {t("phoneSmsTab")}
                        </Button>
                      </div>
                    </div>
                    {credentialMethod === "sms" ? (
                      renderPhoneFields("login", true)
                    ) : (
                      <>
                        <div className="space-y-2">
                          <Input
                            id="username"
                            placeholder={t("usernamePlaceholder")}
                            value={formData.username}
                            onChange={(e) => setFormData({ ...formData, username: e.target.value })}
                          />
                        </div>

                        <div className="space-y-2">
                          <Label htmlFor="password">{t("password")}</Label>
                          <div className="relative">
                            <Input
                              id="password"
                              type={showPassword ? "text" : "password"}
                              placeholder={t("passwordPlaceholder")}
                              value={formData.password}
                              onChange={(e) =>
                                setFormData({
                                  ...formData,
                                  password: e.target.value,
                                })
                              }
                            />
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              className="absolute right-0 top-0 h-full px-3 py-2 hover:bg-transparent"
                              onClick={() => setShowPassword(!showPassword)}
                            >
                              {showPassword ? (
                                <EyeOff className="h-4 w-4" />
                              ) : (
                                <Eye className="h-4 w-4" />
                              )}
                            </Button>
                          </div>
                        </div>

                        <div className="flex items-center justify-between">
                          <div className="flex items-center space-x-2">
                            <Checkbox
                              id="rememberPassword"
                              checked={formData.rememberPassword}
                              onCheckedChange={(checked) =>
                                setFormData({
                                  ...formData,
                                  rememberPassword: checked as boolean,
                                })
                              }
                            />
                            <Label htmlFor="rememberPassword" className="text-sm">
                              {t("rememberPassword")}
                            </Label>
                          </div>
                          <Link href="/forgot-password">
                            <Button variant="link" className="text-sm p-0 h-auto">
                              {t("forgotPassword")}
                            </Button>
                          </Link>
                        </div>
                      </>
                    )}

                    <div className="flex items-center space-x-2">
                      <Checkbox
                        id="agreeTermsPassword"
                        checked={formData.agreeTerms}
                        onCheckedChange={(checked) =>
                          setFormData({
                            ...formData,
                            agreeTerms: checked as boolean,
                          })
                        }
                      />
                      <Label htmlFor="agreeTermsPassword" className="text-sm">
                        {t("agreeTerms")}
                      </Label>
                    </div>

                    <Button
                      className="w-full"
                      onClick={
                        credentialMethod === "sms" ? handleSMSVerification : handlePasswordLogin
                      }
                      disabled={
                        isLoading ||
                        (!!interactionUid && !interactionCsrf) ||
                        (credentialMethod === "password"
                          ? !formData.username || !formData.password
                          : !verificationInfo || !/^\d{6}$/.test(formData.smsCode)) ||
                        !formData.agreeTerms
                      }
                    >
                      {isLoading ? t("loggingIn") : t("loginButton")}
                    </Button>
                    {loginError && <div className="text-red-600 text-sm mt-2">{loginError}</div>}
                  </div>
                </TabsContent>

                <TabsContent value="register" className="space-y-4">
                  {registerSuccess && (
                    <Alert className="bg-success/10 border-success">
                      <CheckCircle className="h-4 w-4 text-success" />
                      <AlertDescription className="text-success">
                        {t("registerSuccess")}
                      </AlertDescription>
                    </Alert>
                  )}

                  <div className="space-y-4">
                    {!registrationToken ? (
                      renderPhoneFields("register")
                    ) : (
                      <>
                        <Alert>
                          <CheckCircle className="h-4 w-4" />
                          <AlertDescription>{t("phoneSetCredentials")}</AlertDescription>
                        </Alert>
                        <div className="space-y-2">
                          <Label htmlFor="registerUsername">{t("username")}</Label>
                          <Input
                            id="registerUsername"
                            placeholder={t("usernamePlaceholder")}
                            value={formData.username}
                            onChange={(e) => setFormData({ ...formData, username: e.target.value })}
                          />
                        </div>

                        <div className="space-y-2">
                          <Label htmlFor="registerPassword">{t("password")}</Label>
                          <div className="relative">
                            <Input
                              id="registerPassword"
                              type={showPassword ? "text" : "password"}
                              placeholder={t("passwordPlaceholder")}
                              value={formData.password}
                              onChange={(e) =>
                                setFormData({
                                  ...formData,
                                  password: e.target.value,
                                })
                              }
                            />
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              className="absolute right-0 top-0 h-full px-3 py-2 hover:bg-transparent"
                              onClick={() => setShowPassword(!showPassword)}
                            >
                              {showPassword ? (
                                <EyeOff className="h-4 w-4" />
                              ) : (
                                <Eye className="h-4 w-4" />
                              )}
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
                              value={formData.confirmPassword}
                              onChange={(e) =>
                                setFormData({
                                  ...formData,
                                  confirmPassword: e.target.value,
                                })
                              }
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
                      </>
                    )}

                    <div className="flex items-center space-x-2">
                      <Checkbox
                        id="agreeTermsRegister"
                        checked={formData.agreeTerms}
                        onCheckedChange={(checked) =>
                          setFormData({
                            ...formData,
                            agreeTerms: checked as boolean,
                          })
                        }
                      />
                      <Label htmlFor="agreeTermsRegister" className="text-sm">
                        {t("agreeTerms")}
                      </Label>
                    </div>

                    {registerError && (
                      <div className="text-destructive text-sm">{registerError}</div>
                    )}

                    <Button
                      className="w-full"
                      onClick={registrationToken ? handleRegister : handleSMSVerification}
                      disabled={
                        isLoading ||
                        (!!interactionUid && !interactionCsrf) ||
                        (registrationToken
                          ? !formData.username || !formData.password || !formData.confirmPassword
                          : !verificationInfo || !/^\d{6}$/.test(formData.smsCode)) ||
                        !formData.agreeTerms
                      }
                    >
                      {isLoading
                        ? t("verifying")
                        : registrationToken
                          ? t("registerButton")
                          : t("phoneVerify")}
                    </Button>
                  </div>
                </TabsContent>
              </Tabs>
            </CardContent>
          </Card>

          {/* 安全提示 */}
          <div className="mt-6 space-y-3">
            <p className="text-center text-xs text-gray-500">{t("copyright")}</p>
            {siteConfig.icpNumber ? (
              <p className="text-center text-xs text-gray-500">
                <a href={siteConfig.icpBeianUrl} target="_blank" rel="noopener noreferrer">
                  {siteConfig.icpNumber}
                </a>
              </p>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}
