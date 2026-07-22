"use client";

import { useEffect, useRef } from "react";
import { applyTheme, resetTheme } from "@/lib/theme";
import { useSystemSettings } from "@/hooks/useSystemSettings";

export default function ThemeProvider({ children }: { children: React.ReactNode }) {
  const { themePrimaryColor, themeSecondaryColor, loading } = useSystemSettings();
  const hasAppliedTheme = useRef(false);

  useEffect(() => {
    // 等待数据加载完成
    if (loading) return;

    // 如果没有自定义主题颜色，重置为默认主题
    if (!themePrimaryColor && !themeSecondaryColor) {
      resetTheme();
    } else {
      // 应用主题颜色
      applyTheme({
        primaryColor: themePrimaryColor || "#000000",
        secondaryColor: themeSecondaryColor || undefined,
        grayScale: "neutral",
      });
    }
    hasAppliedTheme.current = true;
  }, [loading, themePrimaryColor, themeSecondaryColor]);

  return <>{children}</>;
}
