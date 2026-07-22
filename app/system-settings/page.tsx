"use client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Settings, Mail, Building2, Upload, Eye, Palette, Check } from "lucide-react";
import { useState, useEffect } from "react";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { checkSuperAdmin } from "@/lib/clientPermissions";
import axios from "@/lib/axios";
import { uploadFile } from "@/lib/ossUpload";
import { useSWRConfig } from "swr";
import {
  getMaxHtmlLength,
  validateHtmlLength,
  validateHtml,
  renderTemplate,
  type HtmlValidationResult,
} from "@/lib/htmlSanitizer";
import {
  applyTheme,
  resetTheme,
  isValidHexColor,
  PRESET_PRIMARY_COLORS,
  generateRecommendedSecondaryColors,
} from "@/lib/theme";
import { Badge } from "@/components/ui/badge";
import { useTranslations } from "next-intl";

// 清空图谱按钮组件
function ClearGraphButton({
  t,
}: {
  t: (key: string, params?: Record<string, string | number>) => string;
}) {
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);

  const handleClear = async () => {
    setError("");
    setMsg("");
    setSuccess(false);
    if (!window.confirm(t("clearGraphConfirm"))) return;
    setLoading(true);
    try {
      const response = await axios.delete(`/api/knowledge/graph?all=1`);
      const data = response.data;

      // 显示成功信息，包含详细统计
      if (data.details) {
        setMsg(
          data.message ||
            (data.details.failed > 0
              ? t("clearedWithErrors", {
                  success: data.details.success,
                  failed: data.details.failed,
                })
              : t("clearedCount", { success: data.details.success }))
        );
      } else {
        setMsg(t("graphsCleared"));
      }
      setSuccess(true);
    } catch (e: any) {
      console.error("清空图谱失败:", e);
      setError(e?.response?.data?.error || e?.response?.data?.message || t("clearFailed"));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex flex-col gap-1">
      <button
        className="px-2.5 py-1 rounded bg-red-600 text-white text-xs font-medium hover:bg-red-700 disabled:opacity-60 h-8"
        onClick={handleClear}
        disabled={loading}
      >
        {loading ? t("clearing") : t("clearAllGraphs")}
      </button>
      {msg && <div className="text-green-600 text-xs">{msg}</div>}
      {error && <div className="text-red-600 text-xs">{error}</div>}
    </div>
  );
}

interface SmtpSettings {
  SMTP_HOST: string;
  SMTP_PORT: number;
  SMTP_USERNAME: string;
  SMTP_PASSWORD: string;
  SMTP_FROM_NAME: string;
  SMTP_FROM_EMAIL: string;
  SMTP_USE_TLS: boolean;
  SMTP_USE_SSL: boolean;
}

interface SystemSettings {
  llm_model?: string;
  platform_name?: string;
  platform_logo?: string;
  platform_subtitle?: string;
  login_left_panel_html?: string;
  // 主题设置
  theme_primary_color?: string;
  theme_secondary_color?: string;
}

export default function SystemSettingsPage() {
  const { user, loading: userLoading } = useCurrentUser();
  const { mutate } = useSWRConfig();
  const t = useTranslations("systemSettings");
  const tc = useTranslations("common");

  // SMTP 配置状态
  const [smtpSettings, setSmtpSettings] = useState<SmtpSettings>({
    SMTP_HOST: "",
    SMTP_PORT: 0,
    SMTP_USERNAME: "",
    SMTP_PASSWORD: "",
    SMTP_FROM_NAME: "",
    SMTP_FROM_EMAIL: "",
    SMTP_USE_TLS: false,
    SMTP_USE_SSL: true,
  });
  const [smtpLoading, setSmtpLoading] = useState(false);
  const [smtpError, setSmtpError] = useState<string | null>(null);
  const [smtpSuccess, setSmtpSuccess] = useState(false);

  // 系统设置状态（平台名称、Logo等）
  const [systemSettings, setSystemSettings] = useState<SystemSettings>({
    llm_model: "",
    platform_name: "",
    platform_logo: "",
    platform_subtitle: "",
    login_left_panel_html: "",
    theme_primary_color: "",
    theme_secondary_color: "",
  });
  const [systemLoading, setSystemLoading] = useState(false);
  const [systemError, setSystemError] = useState<string | null>(null);
  const [systemSuccess, setSystemSuccess] = useState(false);
  const [logoUploading, setLogoUploading] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);

  // 主题设置独立状态
  const [themeLoading, setThemeLoading] = useState(false);
  const [themeError, setThemeError] = useState<string | null>(null);
  const [themeSuccess, setThemeSuccess] = useState(false);
  const [htmlValidation, setHtmlValidation] = useState<HtmlValidationResult>({
    valid: true,
    errors: [],
    warnings: [],
  });

  // 加载系统设置（平台名称、Logo等）
  // biome-ignore lint/correctness/useExhaustiveDependencies: 只在组件挂载时加载
  useEffect(() => {
    const loadSystemSettings = async () => {
      try {
        const response = await axios.get("/api/system", {
          params: { full_data: true },
        });
        if (response.data) {
          setSystemSettings({
            llm_model: response.data.llm_model || "",
            platform_name: response.data.platform_name || "",
            platform_logo: response.data.platform_logo || "",
            platform_subtitle: response.data.platform_subtitle || "",
            login_left_panel_html: response.data.login_left_panel_html || "",
            theme_primary_color: response.data.theme_primary_color || "",
            theme_secondary_color: response.data.theme_secondary_color || "",
          });

          // 加载 SMTP 配置
          if (response.data.smtp_config) {
            setSmtpSettings({
              SMTP_HOST: response.data.smtp_config.SMTP_HOST || "",
              SMTP_PORT: response.data.smtp_config.SMTP_PORT || 0,
              SMTP_USERNAME: response.data.smtp_config.SMTP_USERNAME || "",
              SMTP_PASSWORD: response.data.smtp_config.SMTP_PASSWORD || "",
              SMTP_FROM_NAME: response.data.smtp_config.SMTP_FROM_NAME || "",
              SMTP_FROM_EMAIL: response.data.smtp_config.SMTP_FROM_EMAIL || "",
              SMTP_USE_TLS: response.data.smtp_config.SMTP_USE_TLS ?? false,
              SMTP_USE_SSL: response.data.smtp_config.SMTP_USE_SSL ?? true,
            });
          }
        }
      } catch (error: any) {
        // 忽略 404 错误，可能是首次设置
        if (error.response?.status !== 404) {
          console.error("加载系统设置失败:", error);
          setSystemError(error.response?.data?.error || t("loadFailed"));
        }
      }
    };
    loadSystemSettings();
  }, []);

  // 保存 SMTP 配置
  const handleSaveSmtp = async () => {
    setSmtpLoading(true);
    setSmtpError(null);
    setSmtpSuccess(false);

    try {
      await axios.put("/api/system", {
        smtp_config: smtpSettings,
      });
      setSmtpSuccess(true);
      setTimeout(() => setSmtpSuccess(false), 3000);
    } catch (error: any) {
      setSmtpError(error.response?.data?.error || t("saveSmtpFailed"));
    } finally {
      setSmtpLoading(false);
    }
  };

  // 处理 Logo 上传
  const handleLogoUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    // 验证文件类型
    if (!file.type.startsWith("image/")) {
      setSystemError(t("selectImageFile"));
      return;
    }

    // 验证文件大小（限制为 5MB）
    if (file.size > 5 * 1024 * 1024) {
      setSystemError(t("imageSizeLimit"));
      return;
    }

    setLogoUploading(true);
    setSystemError(null);

    try {
      const objectKey = await uploadFile({ file, category: "system" });
      const response = await axios.post("/api/system/upload-logo-confirm", { objectKey });

      if (response.data?.url) {
        setSystemSettings({
          ...systemSettings,
          platform_logo: response.data.url,
        });
      }
    } catch (error: any) {
      setSystemError(error.response?.data?.error || t("uploadFailed"));
    } finally {
      setLogoUploading(false);
      // 清空 input 值，允许重复选择同一文件
      event.target.value = "";
    }
  };

  // 保存系统设置（平台设置）
  const handleSaveSystemSettings = async () => {
    setSystemLoading(true);
    setSystemError(null);
    setSystemSuccess(false);

    try {
      await axios.put("/api/system", {
        llm_model: systemSettings.llm_model,
        platform_name: systemSettings.platform_name,
        platform_logo: systemSettings.platform_logo,
        platform_subtitle: systemSettings.platform_subtitle,
        login_left_panel_html: systemSettings.login_left_panel_html,
        theme_primary_color: systemSettings.theme_primary_color,
      });
      setSystemSuccess(true);
      setTimeout(() => setSystemSuccess(false), 3000);
    } catch (error: any) {
      setSystemError(error.response?.data?.error || t("saveSystemFailed"));
    } finally {
      setSystemLoading(false);
    }
  };

  // 保存主题设置
  const handleSaveThemeSettings = async () => {
    // 验证主色调格式
    if (
      systemSettings.theme_primary_color &&
      !isValidHexColor(systemSettings.theme_primary_color)
    ) {
      setThemeError(t("invalidPrimaryColor"));
      return;
    }

    if (
      systemSettings.theme_secondary_color &&
      !isValidHexColor(systemSettings.theme_secondary_color)
    ) {
      setThemeError(t("invalidSecondaryColor"));
      return;
    }

    // 验证 HTML 长度
    if (
      systemSettings.login_left_panel_html &&
      !validateHtmlLength(systemSettings.login_left_panel_html)
    ) {
      setThemeError(t("htmlLengthExceeded"));
      return;
    }

    // 验证 HTML 有效性
    if (systemSettings.login_left_panel_html) {
      const validation = validateHtml(systemSettings.login_left_panel_html);
      if (!validation.valid) {
        setThemeError(`${t("htmlSyntaxErrorPrefix")}${validation.errors.join("；")}`);
        return;
      }
    }

    setThemeLoading(true);
    setThemeError(null);
    setThemeSuccess(false);

    try {
      await axios.put("/api/system", {
        theme_primary_color: systemSettings.theme_primary_color || null,
        theme_secondary_color: systemSettings.theme_secondary_color || null,
        login_left_panel_html: systemSettings.login_left_panel_html,
      });
      // 更新 SWR 缓存以触发全局主题更新
      mutate("/api/system");
      setThemeSuccess(true);
      setTimeout(() => setThemeSuccess(false), 3000);
    } catch (error: any) {
      setThemeError(error.response?.data?.error || t("saveThemeFailed"));
    } finally {
      setThemeLoading(false);
    }
  };

  // 处理主色调选择
  const handlePrimaryColorChange = (color: string) => {
    setSystemSettings({
      ...systemSettings,
      theme_primary_color: color,
    });
    // 实时预览
    applyTheme({
      primaryColor: color || "#000000",
      secondaryColor: systemSettings.theme_secondary_color || undefined,
      grayScale: "neutral",
    });
  };

  // 处理次要色调选择
  const handleSecondaryColorChange = (color: string) => {
    setSystemSettings({
      ...systemSettings,
      theme_secondary_color: color,
    });
    // 实时预览
    applyTheme({
      primaryColor: systemSettings.theme_primary_color || "#000000",
      secondaryColor: color || undefined,
      grayScale: "neutral",
    });
  };

  // 显示加载状态
  if (userLoading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
        <span className="ml-2">{tc("loading")}</span>
      </div>
    );
  }

  if (!user) return null;
  if (!checkSuperAdmin(user)) {
    return <div className="text-center text-red-500 text-xl mt-20">{t("noPermission")}</div>;
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 mb-4">
        <Settings className="h-5 w-5 text-blue-600" />
        <h1 className="text-xl font-semibold">{t("title")}</h1>
      </div>

      <div className="columns-1 md:columns-2 gap-4 space-y-4">
        {/* 平台设置 */}
        <Card className="break-inside-avoid">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <Building2 className="h-4 w-4" />
              {t("platformSettings")}
            </CardTitle>
            <CardDescription className="text-xs text-muted-foreground">
              {t("platformSettingsDesc")}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="space-y-2">
              <Label htmlFor="platform_name" className="text-xs">
                {t("platformName")}
              </Label>
              <Input
                id="platform_name"
                value={systemSettings.platform_name}
                onChange={(e) =>
                  setSystemSettings({
                    ...systemSettings,
                    platform_name: e.target.value,
                  })
                }
                placeholder={t("platformNamePlaceholder")}
                className="h-8 text-sm"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="platform_logo" className="text-xs">
                {t("platformLogoUrl")}
              </Label>
              <div className="flex gap-2">
                <Input
                  id="platform_logo"
                  value={systemSettings.platform_logo}
                  onChange={(e) =>
                    setSystemSettings({
                      ...systemSettings,
                      platform_logo: e.target.value,
                    })
                  }
                  placeholder={t("platformLogoPlaceholder")}
                  className="h-8 text-sm flex-1"
                />
                <label htmlFor="logo-upload" className="cursor-pointer">
                  <input
                    id="logo-upload"
                    type="file"
                    accept="image/*"
                    onChange={handleLogoUpload}
                    className="hidden"
                    disabled={logoUploading}
                  />
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-8 text-xs px-3"
                    disabled={logoUploading}
                    onClick={() => document.getElementById("logo-upload")?.click()}
                  >
                    <Upload className="h-3 w-3 inline mr-1" />
                    {logoUploading ? t("uploading") : t("upload")}
                  </Button>
                </label>
              </div>
            </div>

            {systemSettings.platform_logo && (
              <div className="flex items-center gap-2 p-2 bg-muted rounded">
                <span className="text-xs text-muted-foreground">{t("logoPreview")}</span>
                <img
                  src={systemSettings.platform_logo}
                  alt="Platform Logo"
                  className="h-8 w-auto object-contain"
                  onError={(e) => {
                    e.currentTarget.style.display = "none";
                  }}
                />
              </div>
            )}

            <div className="space-y-2">
              <Label htmlFor="platform_subtitle" className="text-xs">
                {t("platformSubtitle")}
              </Label>
              <Input
                id="platform_subtitle"
                value={systemSettings.platform_subtitle}
                onChange={(e) =>
                  setSystemSettings({
                    ...systemSettings,
                    platform_subtitle: e.target.value,
                  })
                }
                placeholder={t("platformSubtitlePlaceholder")}
                className="h-8 text-sm"
              />
              <p className="text-xs text-muted-foreground">{t("subtitleTip")}</p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="llm_model" className="text-xs">
                {t("chatModel")}
              </Label>
              <Select
                value={systemSettings.llm_model || "deepseek"}
                onValueChange={(value) =>
                  setSystemSettings({ ...systemSettings, llm_model: value })
                }
              >
                <SelectTrigger className="h-8 text-sm">
                  <SelectValue placeholder={t("selectChatModel")} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="deepseek">{t("deepseekRemote")}</SelectItem>
                  <SelectItem value="local">{t("localModel")}</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                {systemSettings.llm_model === "local" ? t("localModelTip") : t("remoteModelTip")}
              </p>
            </div>

            {systemError && (
              <div className="text-red-600 text-xs bg-red-50 p-2 rounded">{systemError}</div>
            )}

            {systemSuccess && (
              <div className="text-green-600 text-xs bg-green-50 p-2 rounded">
                {t("configSaved")}
              </div>
            )}

            <Button
              onClick={handleSaveSystemSettings}
              disabled={systemLoading}
              className="h-8 text-sm"
            >
              {systemLoading ? t("saving") : t("saveConfig")}
            </Button>
          </CardContent>
        </Card>

        {/* SMTP 邮箱配置 */}
        <Card className="break-inside-avoid">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <Mail className="h-4 w-4" />
              {t("smtpSettings")}
            </CardTitle>
            <CardDescription className="text-xs text-muted-foreground">
              {t("smtpSettingsDesc")}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="space-y-2">
              <Label htmlFor="smtp_host" className="text-xs">
                {t("smtpHost")}
              </Label>
              <Input
                id="smtp_host"
                value={smtpSettings.SMTP_HOST}
                onChange={(e) =>
                  setSmtpSettings({
                    ...smtpSettings,
                    SMTP_HOST: e.target.value,
                  })
                }
                placeholder="smtp.feishu.cn"
                className="h-8 text-sm"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="smtp_port" className="text-xs">
                {t("smtpPort")}
              </Label>
              <Input
                id="smtp_port"
                type="number"
                value={smtpSettings.SMTP_PORT === 0 ? "" : smtpSettings.SMTP_PORT}
                onChange={(e) =>
                  setSmtpSettings({
                    ...smtpSettings,
                    SMTP_PORT: parseInt(e.target.value) || 0,
                  })
                }
                placeholder="465"
                className="h-8 text-sm"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="smtp_username" className="text-xs">
                {t("smtpUsername")}
              </Label>
              <Input
                id="smtp_username"
                value={smtpSettings.SMTP_USERNAME}
                onChange={(e) =>
                  setSmtpSettings({
                    ...smtpSettings,
                    SMTP_USERNAME: e.target.value,
                  })
                }
                placeholder="your_email@example.com"
                className="h-8 text-sm"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="smtp_password" className="text-xs">
                {t("smtpPassword")}
              </Label>
              <Input
                id="smtp_password"
                type="password"
                value={smtpSettings.SMTP_PASSWORD}
                onChange={(e) =>
                  setSmtpSettings({
                    ...smtpSettings,
                    SMTP_PASSWORD: e.target.value,
                  })
                }
                placeholder="your_password"
                className="h-8 text-sm"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="smtp_from_name" className="text-xs">
                {t("senderName")}
              </Label>
              <Input
                id="smtp_from_name"
                value={smtpSettings.SMTP_FROM_NAME}
                onChange={(e) =>
                  setSmtpSettings({
                    ...smtpSettings,
                    SMTP_FROM_NAME: e.target.value,
                  })
                }
                placeholder={t("senderNamePlaceholder")}
                className="h-8 text-sm"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="smtp_from_email" className="text-xs">
                {t("senderEmail")}
              </Label>
              <Input
                id="smtp_from_email"
                type="email"
                value={smtpSettings.SMTP_FROM_EMAIL}
                onChange={(e) =>
                  setSmtpSettings({
                    ...smtpSettings,
                    SMTP_FROM_EMAIL: e.target.value,
                  })
                }
                placeholder="sender@example.com"
                className="h-8 text-sm"
              />
            </div>

            <div className="flex items-center gap-4">
              <div className="flex items-center gap-2">
                <Checkbox
                  id="smtp_use_tls"
                  checked={smtpSettings.SMTP_USE_TLS}
                  onCheckedChange={(checked) =>
                    setSmtpSettings({
                      ...smtpSettings,
                      SMTP_USE_TLS: !!checked,
                    })
                  }
                />
                <Label htmlFor="smtp_use_tls" className="text-xs cursor-pointer">
                  {t("useTls")}
                </Label>
              </div>

              <div className="flex items-center gap-2">
                <Checkbox
                  id="smtp_use_ssl"
                  checked={smtpSettings.SMTP_USE_SSL}
                  onCheckedChange={(checked) =>
                    setSmtpSettings({
                      ...smtpSettings,
                      SMTP_USE_SSL: !!checked,
                    })
                  }
                />
                <Label htmlFor="smtp_use_ssl" className="text-xs cursor-pointer">
                  {t("useSsl")}
                </Label>
              </div>
            </div>

            {smtpError && (
              <div className="text-red-600 text-xs bg-red-50 p-2 rounded">{smtpError}</div>
            )}

            {smtpSuccess && (
              <div className="text-green-600 text-xs bg-green-50 p-2 rounded">
                {t("configSaved")}
              </div>
            )}

            <Button onClick={handleSaveSmtp} disabled={smtpLoading} className="h-8 text-sm">
              {smtpLoading ? t("saving") : t("saveConfig")}
            </Button>
          </CardContent>
        </Card>

        {/* 主题设置 */}
        <Card className="break-inside-avoid">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <Palette className="h-4 w-4" />
              {t("themeSettings")}
            </CardTitle>
            <CardDescription className="text-xs text-muted-foreground">
              {t("themeSettingsDesc")}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {/* 主色调选择 */}
            <div className="space-y-3 p-3 bg-muted rounded-lg">
              <Label className="text-xs font-medium">{t("primaryColor")}</Label>
              <p className="text-xs text-muted-foreground">{t("primaryColorDesc")}</p>
              <div className="flex flex-wrap gap-2">
                {PRESET_PRIMARY_COLORS.map((color) => (
                  <button
                    key={color.value}
                    type="button"
                    title={color.description}
                    onClick={() => handlePrimaryColorChange(color.value)}
                    className={`relative w-10 h-10 rounded-lg border-2 transition-all ${
                      systemSettings.theme_primary_color === color.value
                        ? "border-foreground scale-110"
                        : "border-transparent hover:scale-105"
                    }`}
                    style={{ backgroundColor: color.value }}
                  >
                    {systemSettings.theme_primary_color === color.value && (
                      <Check className="absolute inset-0 m-auto h-5 w-5 text-white drop-shadow-md" />
                    )}
                  </button>
                ))}
                {/* 自定义颜色 */}
                <div className="relative">
                  <input
                    type="color"
                    value={systemSettings.theme_primary_color || "#000000"}
                    onChange={(e) => handlePrimaryColorChange(e.target.value)}
                    className="w-10 h-10 rounded-lg border-2 border-dashed border cursor-pointer"
                    title={t("customColor")}
                  />
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Label className="text-xs text-muted-foreground">{t("currentColor")}</Label>
                <Input
                  value={systemSettings.theme_primary_color || ""}
                  onChange={(e) => {
                    const value = e.target.value;
                    setSystemSettings({
                      ...systemSettings,
                      theme_primary_color: value,
                    });
                    if (isValidHexColor(value)) {
                      applyTheme({
                        primaryColor: value,
                        grayScale: "neutral",
                      });
                    }
                  }}
                  placeholder={t("defaultPrimary")}
                  className="h-7 text-xs font-mono w-32"
                />
              </div>
            </div>

            {/* 次要色调选择 */}
            <div className="space-y-3 p-3 bg-muted rounded-lg">
              <Label className="text-xs font-medium">{t("secondaryColor")}</Label>
              <p className="text-xs text-muted-foreground">{t("secondaryColorDesc")}</p>

              <div className="flex flex-wrap gap-2">
                {/* 根据主色推荐的次要颜色 */}
                {systemSettings.theme_primary_color &&
                  isValidHexColor(systemSettings.theme_primary_color) &&
                  generateRecommendedSecondaryColors(systemSettings.theme_primary_color).map(
                    (color) => (
                      <button
                        key={color.value}
                        type="button"
                        title={`${color.name}: ${color.description}`}
                        onClick={() => handleSecondaryColorChange(color.value)}
                        className={`relative w-10 h-10 rounded-lg border-2 transition-all ${
                          systemSettings.theme_secondary_color === color.value
                            ? "border-foreground scale-110"
                            : "border-transparent hover:scale-105"
                        }`}
                        style={{ backgroundColor: color.value }}
                      >
                        {systemSettings.theme_secondary_color === color.value && (
                          <Check className="absolute inset-0 m-auto h-5 w-5 text-white drop-shadow-md" />
                        )}
                      </button>
                    )
                  )}
                {/* 自定义颜色 */}
                <div className="relative">
                  <input
                    type="color"
                    value={systemSettings.theme_secondary_color || "#6b7280"}
                    onChange={(e) => handleSecondaryColorChange(e.target.value)}
                    className="w-10 h-10 rounded-lg border-2 border-dashed border cursor-pointer"
                    title={t("customColor")}
                  />
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Label className="text-xs text-muted-foreground">{t("currentColor")}</Label>
                <Input
                  value={systemSettings.theme_secondary_color || ""}
                  onChange={(e) => {
                    const value = e.target.value;
                    setSystemSettings({
                      ...systemSettings,
                      theme_secondary_color: value,
                    });
                    if (isValidHexColor(value)) {
                      applyTheme({
                        primaryColor: systemSettings.theme_primary_color || "#000000",
                        secondaryColor: value,
                        grayScale: "neutral",
                      });
                    }
                  }}
                  placeholder={t("defaultSecondary")}
                  className="h-7 text-xs font-mono w-32"
                />
              </div>
            </div>

            {/* 重置按钮 */}
            {(systemSettings.theme_primary_color || systemSettings.theme_secondary_color) && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-7 text-xs"
                onClick={async () => {
                  setSystemSettings({
                    ...systemSettings,
                    theme_primary_color: "",
                    theme_secondary_color: "",
                  });
                  resetTheme();
                  // 保存到数据库，确保刷新后也能保持重置状态
                  try {
                    await axios.put("/api/system", {
                      theme_primary_color: null,
                      theme_secondary_color: null,
                    });
                    mutate("/api/system");
                  } catch (error) {
                    console.error(t("saveResetThemeFailed"), error);
                  }
                }}
              >
                {t("resetToDefault")}
              </Button>
            )}

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label htmlFor="login_left_panel_html" className="text-xs">
                  {t("loginLeftPanelHtml")}
                </Label>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-7 text-xs"
                  onClick={() => setPreviewOpen(true)}
                  disabled={!systemSettings.login_left_panel_html?.trim()}
                >
                  <Eye className="h-3 w-3 mr-1" />
                  {t("preview")}
                </Button>
              </div>
              <Textarea
                id="login_left_panel_html"
                value={systemSettings.login_left_panel_html || ""}
                onChange={(e) => {
                  const newValue = e.target.value;
                  setSystemSettings({
                    ...systemSettings,
                    login_left_panel_html: newValue,
                  });
                  setHtmlValidation(validateHtml(newValue));
                }}
                placeholder={t("customHtmlPlaceholder")}
                className={`min-h-[500px] text-sm font-mono ${
                  !htmlValidation.valid ? "border-red-300 focus:border-red-500" : ""
                }`}
                maxLength={getMaxHtmlLength()}
              />
              <div className="flex items-center justify-between">
                <p className="text-xs text-muted-foreground">
                  {t("htmlVariables")}
                  <code className="bg-muted px-1 rounded">{"{{platformName}}"}</code>、
                  <code className="bg-muted px-1 rounded">{"{{platformLogo}}"}</code>、
                  <code className="bg-muted px-1 rounded">{"{{platformSubtitle}}"}</code>
                </p>
                <p className="text-xs text-muted-foreground">
                  {systemSettings.login_left_panel_html?.length || 0} / {getMaxHtmlLength()}{" "}
                  {t("characters")}
                </p>
              </div>

              {/* HTML 校验错误 */}
              {htmlValidation.errors.length > 0 && (
                <div className="bg-red-50 border border-red-200 rounded p-2">
                  <p className="text-xs text-red-800 font-medium mb-1">{t("htmlSyntaxError")}</p>
                  <ul className="text-xs text-red-700 list-disc list-inside space-y-0.5">
                    {htmlValidation.errors.map((error: string, index: number) => (
                      <li key={index}>{error}</li>
                    ))}
                  </ul>
                </div>
              )}

              {/* HTML 校验警告 */}
              {htmlValidation.warnings.length > 0 && (
                <div className="bg-orange-50 border border-orange-200 rounded p-2">
                  <p className="text-xs text-orange-800 font-medium mb-1">{t("warning")}</p>
                  <ul className="text-xs text-orange-700 list-disc list-inside space-y-0.5">
                    {htmlValidation.warnings.map((warning: string, index: number) => (
                      <li key={index}>{warning}</li>
                    ))}
                  </ul>
                </div>
              )}

              <div className="bg-yellow-50 border border-yellow-200 rounded p-2">
                <p className="text-xs text-yellow-800">
                  <strong>{t("securityTip")}</strong>
                  {t("securityTipDesc")}
                </p>
              </div>

              {/* 预览对话框 */}
              <Dialog open={previewOpen} onOpenChange={setPreviewOpen}>
                <DialogContent className="max-w-6xl h-[85vh] p-0 overflow-hidden flex flex-col">
                  <DialogHeader className="px-4 py-2 border-b bg-card shrink-0">
                    <DialogTitle className="text-sm">{t("loginPagePreview")}</DialogTitle>
                  </DialogHeader>
                  <div className="flex flex-1 overflow-hidden bg-gradient-to-br from-muted via-card to-muted">
                    {/* 左侧面板 - 自定义 HTML */}
                    <div className="w-1/2 h-full overflow-auto">
                      {/* biome-ignore lint/security/noDangerouslySetInnerHtml: 预览用户自定义 HTML */}
                      <div
                        className="h-full"
                        dangerouslySetInnerHTML={{
                          __html: renderTemplate(systemSettings.login_left_panel_html || "", {
                            platformName: systemSettings.platform_name || t("defaultPlatformName"),
                            platformLogo: systemSettings.platform_logo || "",
                            platformSubtitle:
                              systemSettings.platform_subtitle || t("defaultPlatformSubtitle"),
                          }),
                        }}
                      />
                    </div>
                    {/* 右侧面板 - 虚化的登录表单骨架 */}
                    <div className="w-1/2 h-full flex items-center justify-center p-8">
                      <div className="w-full max-w-md opacity-50 blur-[1px]">
                        <div className="bg-card/80 rounded-2xl shadow-lg p-8 border border-border">
                          <div className="text-center mb-8">
                            <div className="h-7 w-24 bg-muted rounded mx-auto mb-2 animate-pulse" />
                            <div className="h-4 w-32 bg-muted rounded mx-auto animate-pulse" />
                          </div>
                          <div className="space-y-4">
                            <div>
                              <div className="h-4 w-12 bg-muted rounded mb-1.5 animate-pulse" />
                              <div className="h-11 bg-muted rounded-md border border-border animate-pulse" />
                            </div>
                            <div>
                              <div className="h-4 w-8 bg-muted rounded mb-1.5 animate-pulse" />
                              <div className="h-11 bg-muted rounded-md border border-border animate-pulse" />
                            </div>
                            <div className="h-11 bg-muted rounded-md animate-pulse" />
                          </div>
                        </div>
                        <div className="mt-6 flex justify-center">
                          <div className="h-3 w-40 bg-muted rounded animate-pulse" />
                        </div>
                      </div>
                    </div>
                  </div>
                </DialogContent>
              </Dialog>
            </div>

            {themeError && (
              <div className="text-red-600 text-xs bg-red-50 p-2 rounded">{themeError}</div>
            )}

            {themeSuccess && (
              <div className="text-green-600 text-xs bg-green-50 p-2 rounded">
                {t("configSaved")}
              </div>
            )}

            <Button
              onClick={handleSaveThemeSettings}
              disabled={themeLoading}
              className="h-8 text-sm"
            >
              {themeLoading ? t("saving") : t("saveConfig")}
            </Button>
          </CardContent>
        </Card>
      </div>

      {/* Dangerous 区域，仅超级管理员可见 */}
      <Card className="border-red-200">
        <CardHeader className="pb-3">
          <CardTitle className="text-red-600 flex items-center gap-2 text-base">
            {t("dangerousOperations")}
          </CardTitle>
          <CardDescription className="text-red-600 text-xs">
            {t("dangerousOperationsDesc")}
          </CardDescription>
        </CardHeader>
        <CardContent className="pt-0">
          <div className="bg-red-50 border border-red-200 rounded p-2.5 flex flex-col gap-1.5">
            <ClearGraphButton t={t} />
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
