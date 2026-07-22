"use client";

import axios from "@/lib/axios";
import { useEffect, useState } from "react";
import useSWR from "swr";
import { applyTheme } from "@/lib/theme";

export interface SystemSettings {
  platform_logo?: string;
  platform_name?: string;
  platform_subtitle?: string;
  login_left_panel_html?: string;
  // 主题设置
  theme_primary_color?: string;
  theme_secondary_color?: string;
}

// 数据获取函数
const fetcher = async (url: string) => {
  const response = await axios.get(url);
  return response.data;
};

export const useSystemSettings = () => {
  // 使用 isClient state 确保在客户端挂载完成前，loading 始终为 true
  // 这样可以避免 SSR/CSR 切换时的闪烁问题
  const [isClient, setIsClient] = useState(false);

  const { data, error, isLoading } = useSWR<SystemSettings>("/api/system", fetcher, {
    revalidateOnFocus: false, // 系统设置不需要频繁更新，关闭窗口聚焦时的重新验证
    revalidateOnReconnect: true, // 网络重连时重新验证
    refreshInterval: 0, // 不自动刷新
    dedupingInterval: 60000, // 60秒内重复请求会被去重
  });

  // 组件挂载后设置 isClient 为 true
  useEffect(() => {
    setIsClient(true);
  }, []);

  // 当主题数据加载完成后，应用主题
  useEffect(() => {
    if (data?.theme_primary_color || data?.theme_secondary_color) {
      applyTheme({
        primaryColor: data.theme_primary_color || "#000000",
        secondaryColor: data.theme_secondary_color || undefined,
        grayScale: "neutral",
      });
    }
  }, [data?.theme_primary_color, data?.theme_secondary_color]);

  // 判断是否正在加载：
  // 1. 客户端尚未挂载（避免 SSR/hydration 不一致）
  // 2. SWR 正在加载（首次请求）
  // 3. 数据尚未获取到
  const loading = !isClient || isLoading || data === undefined;

  // 调试日志（仅在开发模式下）
  if (typeof window !== "undefined" && process.env.NODE_ENV === "development") {
    console.log("[useSystemSettings] Debug:", {
      isClient,
      isLoading,
      hasData: data !== undefined,
      loading,
      hasLoginLeftPanelHtml: !!data?.login_left_panel_html,
      themePrimaryColor: data?.theme_primary_color,
      themeSecondaryColor: data?.theme_secondary_color,
    });
  }

  return {
    platformLogo: data?.platform_logo || null,
    platformName: data?.platform_name || null,
    platformSubtitle: data?.platform_subtitle || null,
    loginLeftPanelHtml: data?.login_left_panel_html || null,
    // 主题设置
    themePrimaryColor: data?.theme_primary_color || null,
    themeSecondaryColor: data?.theme_secondary_color || null,
    loading,
    error,
  };
};
