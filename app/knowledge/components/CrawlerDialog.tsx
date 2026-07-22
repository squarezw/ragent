"use client";

import { ChangeEvent, useEffect, useMemo, useState } from "react";
import { useTheme } from "next-themes";
import { useTranslations } from "next-intl";
import * as Dialog from "@radix-ui/react-dialog";
import { toast } from "sonner";
import axios from "@/lib/axios";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Loader2, X, ChevronRight, RefreshCw } from "lucide-react";
import JsonView from "@uiw/react-json-view";

const DEFAULT_INPUT_SCHEMA = JSON.stringify(
  {
    type: "object",
    properties: {
      text: { type: "string" },
      created_at: { type: "datetime" },
      screen_name: { type: "string", source: "user.screen_name" },
      description: { type: "string", source: "user.description" },
    },
  },
  null,
  2
);

interface CrawlerDialogProps {
  datasetId?: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

interface CrawlerFormState {
  prompt: string;
  taskName: string;
  type: string;
  method: string;
  curl: string;
  inputSchema: string;
  targetDom: string;
  autoFetchNextPage: boolean;
  maxPages: number;
}

const parseJson = (value: string) => {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
};

export const CrawlerDialog = ({ datasetId, open, onOpenChange }: CrawlerDialogProps) => {
  const { theme } = useTheme();
  const t = useTranslations("knowledge");
  const tc = useTranslations("common");
  const [submitting, setSubmitting] = useState(false);
  const [showResponsePanel, setShowResponsePanel] = useState(false);
  const [responseData, setResponseData] = useState<any>(null);
  const [testingCurl, setTestingCurl] = useState(false);
  const [formState, setFormState] = useState<CrawlerFormState>({
    prompt: "",
    taskName: "",
    type: "api",
    method: "GET",
    curl: "",
    inputSchema: DEFAULT_INPUT_SCHEMA,
    targetDom: "",
    autoFetchNextPage: false,
    maxPages: 10,
  });

  const storageKey = useMemo(() => `crawler_settings_${datasetId || "global"}`, [datasetId]);

  // 加载本地缓存
  useEffect(() => {
    if (!open) return;
    try {
      const cached = localStorage.getItem(storageKey);
      if (cached) {
        const parsed = JSON.parse(cached);
        setFormState((prev) => ({
          ...prev,
          ...parsed,
        }));
      }
    } catch {
      // ignore broken cache
    }
  }, [open, storageKey]);

  // 持久化到本地
  useEffect(() => {
    if (!open) return;
    localStorage.setItem(storageKey, JSON.stringify(formState));
  }, [formState, open, storageKey]);

  const inputSchemaPreview = useMemo(() => {
    const parsed = parseJson(formState.inputSchema);
    if (!parsed?.properties) return [];
    return Object.entries(parsed.properties).map(([key, value]: any) => ({
      key,
      source: value?.source,
      type: value?.type,
    }));
  }, [formState.inputSchema]);

  const handleSubmit = async () => {
    if (!datasetId) {
      toast.error(t("selectDatasetFirst"));
      return;
    }

    if (!formState.taskName.trim()) {
      toast.error(t("enterTaskName"));
      return;
    }

    if (!formState.curl.trim()) {
      toast.error(t("enterCurlCommand"));
      return;
    }

    const inputSchema = parseJson(formState.inputSchema);
    if (!inputSchema) {
      toast.error(t("invalidInputSchema"));
      return;
    }

    const payload: any = {
      dataset_id: datasetId,
      prompt: formState.prompt.trim(),
      task_name: formState.taskName.trim(),
      type: formState.type,
      method: formState.method,
      curl: formState.curl.trim(),
      input_schema: inputSchema,
      auto_fetch_next_page: formState.autoFetchNextPage,
      max_pages: formState.maxPages,
    };

    // 只针对 type 为 web 的情况添加 target_dom
    if (formState.type === "web" && formState.targetDom.trim()) {
      payload.target_dom = formState.targetDom.trim();
    }

    setSubmitting(true);
    try {
      await axios.post("/api/v1/crawler/fetch", payload);
      toast.success(t("crawlerTaskCreated"));
      onOpenChange(false);
    } catch (error: any) {
      const message =
        error?.response?.data?.detail ||
        error?.response?.data?.error ||
        error?.message ||
        t("createTaskFailed");
      toast.error(message);
    } finally {
      setSubmitting(false);
    }
  };

  const updateField =
    (field: keyof CrawlerFormState) =>
    (value: string | ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      const nextValue = typeof value === "string" ? value : value.target.value;
      setFormState((prev) => {
        const newState = {
          ...prev,
          [field]: nextValue,
        };

        // 如果更新的是 method，自动同步更新 curl 命令中的 -X 选项
        if (field === "method" && prev.curl.trim()) {
          const method = nextValue.toUpperCase();
          let updatedCurl = prev.curl;

          // 如果 curl 中包含 -X 选项，替换它
          if (updatedCurl.match(/-X\s+\w+/i)) {
            updatedCurl = updatedCurl.replace(/-X\s+\w+/i, `-X ${method}`);
          } else {
            // 如果 curl 中没有 -X 选项，在 curl 后面添加（如果方法不是 GET）
            if (method !== "GET") {
              updatedCurl = updatedCurl.replace(/^curl\s+/i, `curl -X ${method} `);
            }
          }

          newState.curl = updatedCurl;
        }

        // 如果更新的是 curl，自动提取 HTTP 方法并更新表单
        if (field === "curl" && nextValue.trim()) {
          const methodMatch = nextValue.match(/-X\s+(\w+)/i);
          if (methodMatch) {
            const extractedMethod = methodMatch[1].toUpperCase();
            if (extractedMethod === "GET" || extractedMethod === "POST") {
              newState.method = extractedMethod;
            }
          }
        }

        return newState;
      });
    };

  const testCurl = async () => {
    if (!formState.curl.trim()) {
      toast.error(t("enterCurlFirst"));
      return;
    }

    setTestingCurl(true);
    try {
      // 确保 curl 命令使用表单中选择的 HTTP 方法
      let curlToTest = formState.curl.trim();
      const method = formState.method.toUpperCase();

      // 替换或添加 -X 选项以确保使用正确的 HTTP 方法
      if (curlToTest.match(/-X\s+\w+/i)) {
        curlToTest = curlToTest.replace(/-X\s+\w+/i, `-X ${method}`);
      } else if (method !== "GET") {
        // 如果不是 GET 且没有 -X，添加 -X 选项
        curlToTest = curlToTest.replace(/^curl\s+/i, `curl -X ${method} `);
      }

      const response = await axios.post("/api/v1/crawler/test", {
        curl: curlToTest,
      });
      setResponseData(response.data);
      if (!showResponsePanel) {
        setShowResponsePanel(true);
      }
    } catch (error: any) {
      const errorData = error?.response?.data || {
        error: error?.message || t("testFailed"),
        message: error?.message || t("testCurlFailed"),
      };
      setResponseData(errorData);
      if (!showResponsePanel) {
        setShowResponsePanel(true);
      }
      toast.error(errorData.message || t("testCurlFailed"));
    } finally {
      setTestingCurl(false);
    }
  };

  const parseResponseData = (data: any) => {
    if (!data) return null;

    try {
      // 如果是错误响应
      if (data.error) {
        return data;
      }

      // 提取 warning，不包含在格式化输出中（单独显示）
      const { warning, isWAFBlocked, ...responseToFormat } = data;

      // 如果有 data 字段（正常响应）
      if (responseToFormat.data !== undefined) {
        // 尝试解析 data 字段，可能是 JSON 字符串
        let parsedData = responseToFormat.data;
        if (typeof parsedData === "string") {
          try {
            parsedData = JSON.parse(parsedData);
          } catch {
            // 如果不是有效的 JSON，保持原样
          }
        }

        return {
          status: responseToFormat.status,
          statusText: responseToFormat.statusText,
          data: parsedData,
          ...(isWAFBlocked && { _waf_detected: true }),
        };
      }

      // 尝试解析整个响应
      if (typeof responseToFormat === "string") {
        try {
          return JSON.parse(responseToFormat);
        } catch {
          return responseToFormat;
        }
      }

      return responseToFormat;
    } catch {
      return data;
    }
  };

  const isJson = (data: any): boolean => {
    if (!data) return false;
    if (typeof data === "object" && !Array.isArray(data)) return true;
    if (Array.isArray(data)) return true;
    if (typeof data === "string") {
      try {
        JSON.parse(data);
        return true;
      } catch {
        return false;
      }
    }
    return false;
  };

  return (
    <Dialog.Root open={open} onOpenChange={(v) => !submitting && onOpenChange(v)}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/30 z-50" />
        <Dialog.Content
          className={`fixed left-1/2 top-1/2 z-50 -translate-x-1/2 -translate-y-1/2 rounded-lg bg-card shadow-lg max-h-[90vh] overflow-hidden flex ${
            showResponsePanel ? "w-[90vw] max-w-6xl" : "w-full max-w-3xl"
          }`}
        >
          <div className={`flex-1 overflow-y-auto p-6 ${showResponsePanel ? "" : ""}`}>
            <div className="flex items-center justify-between mb-4">
              <Dialog.Title className="text-lg font-bold">{t("crawlerConfig")}</Dialog.Title>
              <Dialog.Close asChild>
                <Button variant="ghost" size="icon" disabled={submitting}>
                  <X className="h-4 w-4" />
                </Button>
              </Dialog.Close>
            </div>

            <div className="space-y-4">
              {/* 第一区域：任务基本信息 */}
              <div className="rounded-lg bg-muted/30 p-4">
                <div className="grid gap-4" style={{ gridTemplateColumns: "4fr 1fr" }}>
                  <div className="space-y-2">
                    <Label>{t("taskName")}</Label>
                    <Input
                      value={formState.taskName}
                      onChange={updateField("taskName")}
                      placeholder={t("taskNamePlaceholder")}
                      disabled={submitting}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>{t("taskType")}</Label>
                    <Select
                      value={formState.type}
                      onValueChange={(v) => updateField("type")(v)}
                      disabled={submitting}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder={t("selectTaskType")} />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="api">API</SelectItem>
                        <SelectItem value="web">Web</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              </div>

              {/* 第二区域：抓取配置 */}
              <div className="rounded-lg bg-muted/30 p-4 space-y-4">
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <Label>{t("curlCommand")}</Label>
                    <div className="flex items-center gap-2">
                      <Label className="text-sm font-normal">{t("httpMethod")}</Label>
                      <Select
                        value={formState.method}
                        onValueChange={(v) => updateField("method")(v)}
                        disabled={submitting}
                      >
                        <SelectTrigger className="w-32 h-8">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="GET">GET</SelectItem>
                          <SelectItem value="POST">POST</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <Textarea
                      value={formState.curl}
                      onChange={updateField("curl")}
                      rows={4}
                      placeholder={
                        'curl -X POST "https://api.example.com/data" -H "Content-Type: application/json" -d \'{"key":"value"}\''
                      }
                      disabled={submitting || testingCurl}
                      className="font-mono text-sm flex-1"
                    />
                    <div className="flex flex-col gap-2">
                      <Button
                        type="button"
                        variant="outline"
                        size="icon"
                        onClick={() => setShowResponsePanel(!showResponsePanel)}
                        disabled={submitting || testingCurl}
                        title={
                          showResponsePanel ? t("collapseResponsePanel") : t("expandResponsePanel")
                        }
                      >
                        <ChevronRight
                          className={`h-4 w-4 transition-transform ${showResponsePanel ? "rotate-180" : ""}`}
                        />
                      </Button>
                      {showResponsePanel && (
                        <Button
                          type="button"
                          variant="outline"
                          size="icon"
                          onClick={testCurl}
                          disabled={submitting || testingCurl || !formState.curl.trim()}
                          title={t("testCurlRequest")}
                        >
                          {testingCurl ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            <RefreshCw className="h-4 w-4" />
                          )}
                        </Button>
                      )}
                    </div>
                  </div>
                  <p className="text-xs text-muted-foreground">{t("curlHelp")}</p>
                </div>

                {formState.type === "web" && (
                  <div className="space-y-2">
                    <Label>{t("targetDomSelector")}</Label>
                    <Input
                      value={formState.targetDom}
                      onChange={updateField("targetDom")}
                      placeholder={t("targetDomPlaceholder")}
                      disabled={submitting}
                    />
                    <p className="text-xs text-muted-foreground">{t("targetDomHelp")}</p>
                  </div>
                )}

                <div className="space-y-2">
                  <Label>{t("crawlerPrompt")}</Label>
                  <Textarea
                    value={formState.prompt}
                    onChange={updateField("prompt")}
                    rows={2}
                    placeholder={t("crawlerPromptPlaceholder")}
                    disabled={submitting}
                  />
                </div>

                <div className="flex items-center justify-between gap-4">
                  <div className="flex items-center space-x-2">
                    <Checkbox
                      id="auto-fetch"
                      checked={formState.autoFetchNextPage}
                      onCheckedChange={(checked) =>
                        setFormState((prev) => ({
                          ...prev,
                          autoFetchNextPage: Boolean(checked),
                        }))
                      }
                      disabled={submitting}
                    />
                    <Label htmlFor="auto-fetch">{t("autoFetchNextPage")}</Label>
                  </div>
                  {formState.autoFetchNextPage && (
                    <div className="flex items-center gap-2">
                      <Label className="whitespace-nowrap">{t("maxPages")}</Label>
                      <Input
                        type="number"
                        min={1}
                        value={formState.maxPages}
                        onChange={(e) =>
                          setFormState((prev) => ({
                            ...prev,
                            maxPages: Math.max(1, Number(e.target.value) || 1),
                          }))
                        }
                        disabled={submitting}
                        className="w-24"
                      />
                    </div>
                  )}
                </div>

                <div className="space-y-2">
                  <Label>{t("fieldMapping")}</Label>
                  <Textarea
                    value={formState.inputSchema}
                    onChange={updateField("inputSchema")}
                    rows={8}
                    className="font-mono text-sm"
                    disabled={submitting}
                  />
                  <p className="text-xs text-muted-foreground">{t("fieldMappingHelp")}</p>
                </div>
              </div>

              {/* 第三区域：操作按钮 */}
              <div className="rounded-lg bg-muted/30 p-4">
                <div className="flex items-center justify-end">
                  <div className="flex gap-2">
                    <Dialog.Close asChild>
                      <Button variant="outline" disabled={submitting}>
                        {tc("cancel")}
                      </Button>
                    </Dialog.Close>
                    <Button onClick={handleSubmit} disabled={submitting}>
                      {submitting && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                      {t("createCrawlerTask")}
                    </Button>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {showResponsePanel && (
            <div className="w-1/2 border-l p-6 flex flex-col">
              <div className="flex items-center justify-between mb-2">
                <Label className="text-sm font-semibold">{t("responseResult")}</Label>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={testCurl}
                  disabled={submitting || testingCurl || !formState.curl.trim()}
                  className="gap-2 h-8"
                >
                  <RefreshCw className={`h-3 w-3 ${testingCurl ? "animate-spin" : ""}`} />
                  {tc("refresh")}
                </Button>
              </div>
              <div className="flex-1 overflow-y-auto border rounded-md p-4 bg-muted/30 min-h-0 flex flex-col">
                {testingCurl ? (
                  <div className="flex items-center justify-center h-full">
                    <Loader2 className="h-6 w-6 animate-spin text-primary" />
                    <span className="ml-2 text-sm text-muted-foreground">{t("requesting")}</span>
                  </div>
                ) : responseData ? (
                  <>
                    {responseData.warning && (
                      <div className="mb-3 p-3 rounded-md bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800">
                        <p className="text-xs text-yellow-800 dark:text-yellow-200">
                          {responseData.warning}
                        </p>
                      </div>
                    )}
                    <div className="flex-1 overflow-auto min-h-0">
                      {(() => {
                        const parsed = parseResponseData(responseData);
                        if (isJson(parsed)) {
                          const isDark = theme === "dark";
                          return (
                            <div className="text-sm">
                              <JsonView
                                value={parsed}
                                style={
                                  {
                                    "--w-rjv-font-family":
                                      "ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Consolas, 'Liberation Mono', monospace",
                                    "--w-rjv-font-size": "13px",
                                    "--w-rjv-line-height": "1.5",
                                    "--w-rjv-background-color": isDark ? "#1f2937" : "#ffffff",
                                    "--w-rjv-curlybraces-color": isDark ? "#9ca3af" : "#6b7280",
                                    "--w-rjv-colon-color": isDark ? "#9ca3af" : "#6b7280",
                                    "--w-rjv-brackets-color": isDark ? "#9ca3af" : "#6b7280",
                                    "--w-rjv-arrow-color": isDark ? "#d1d5db" : "#9ca3af",
                                    "--w-rjv-edit-color": "#3b82f6",
                                    "--w-rjv-info-color": isDark ? "#9ca3af" : "#6b7280",
                                    "--w-rjv-type-string-color": isDark ? "#10b981" : "#059669",
                                    "--w-rjv-type-int-color": isDark ? "#60a5fa" : "#2563eb",
                                    "--w-rjv-type-float-color": isDark ? "#60a5fa" : "#2563eb",
                                    "--w-rjv-type-bigint-color": isDark ? "#60a5fa" : "#2563eb",
                                    "--w-rjv-type-boolean-color": isDark ? "#a78bfa" : "#7c3aed",
                                    "--w-rjv-type-date-color": isDark ? "#f87171" : "#dc2626",
                                    "--w-rjv-type-null-color": isDark ? "#fb923c" : "#ea580c",
                                    "--w-rjv-type-nan-color": isDark ? "#fb923c" : "#ea580c",
                                    "--w-rjv-type-undefined-color": isDark ? "#9ca3af" : "#6b7280",
                                    "--w-rjv-key-string": isDark ? "#c084fc" : "#9333ea",
                                    "--w-rjv-border-color": isDark ? "#374151" : "#e5e7eb",
                                  } as React.CSSProperties
                                }
                                collapsed={1}
                                displayObjectSize={true}
                                displayDataTypes={false}
                                enableClipboard={true}
                              />
                            </div>
                          );
                        }
                        // 如果不是 JSON，显示原始文本
                        return (
                          <pre className="text-xs font-mono whitespace-pre-wrap break-words">
                            {typeof parsed === "string" ? parsed : JSON.stringify(parsed, null, 2)}
                          </pre>
                        );
                      })()}
                    </div>
                  </>
                ) : (
                  <div className="flex items-center justify-center h-full text-sm text-muted-foreground">
                    {t("clickRefreshToTest")}
                  </div>
                )}
              </div>
            </div>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
};
