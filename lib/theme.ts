import Color from "colorjs.io";

// ============================================================================
// 类型定义
// ============================================================================

export interface ThemeColors {
  "--background": string;
  "--foreground": string;
  "--card": string;
  "--card-foreground": string;
  "--popover": string;
  "--popover-foreground": string;
  "--primary": string;
  "--primary-foreground": string;
  "--secondary": string;
  "--secondary-foreground": string;
  "--muted": string;
  "--muted-foreground": string;
  "--accent": string;
  "--accent-foreground": string;
  "--destructive": string;
  "--destructive-foreground": string;
  "--border": string;
  "--input": string;
  "--ring": string;
  "--sidebar-background": string;
  "--sidebar-foreground": string;
  "--sidebar-primary": string;
  "--sidebar-primary-foreground": string;
  "--sidebar-accent": string;
  "--sidebar-accent-foreground": string;
  "--sidebar-border": string;
  "--sidebar-ring": string;
}

export interface SemanticColors {
  "--success": string;
  "--success-foreground": string;
  "--warning": string;
  "--warning-foreground": string;
  "--info": string;
  "--info-foreground": string;
}

export interface ColorScale {
  "--primary-50": string;
  "--primary-100": string;
  "--primary-200": string;
  "--primary-300": string;
  "--primary-400": string;
  "--primary-500": string;
  "--primary-600": string;
  "--primary-700": string;
  "--primary-800": string;
  "--primary-900": string;
  "--primary-950": string;
}

export interface ChartColors {
  "--chart-1": string;
  "--chart-2": string;
  "--chart-3": string;
  "--chart-4": string;
  "--chart-5": string;
}

export type ExtendedThemeColors = ThemeColors & SemanticColors & ColorScale & ChartColors;

export type GrayScale = "neutral" | "stone" | "zinc" | "gray" | "slate";

export type ThemeMode = "light" | "dark" | "system";

export interface ThemeConfig {
  primaryColor: string; // HEX 格式，如 "#2563eb"
  secondaryColor?: string; // HEX 格式，如 "#6b7280"，可选，默认基于 grayScale
  grayScale: GrayScale;
}

// ============================================================================
// 预设灰色基调（来自 shadcn/ui 官方）
// 格式: HSL (H S% L%) - 不含 hsl() 包裹，用于 CSS 变量
// ============================================================================

interface GrayScaleColors {
  light: Omit<
    ThemeColors,
    | "--primary"
    | "--primary-foreground"
    | "--ring"
    | "--sidebar-primary"
    | "--sidebar-primary-foreground"
    | "--sidebar-ring"
  >;
  dark: Omit<
    ThemeColors,
    | "--primary"
    | "--primary-foreground"
    | "--ring"
    | "--sidebar-primary"
    | "--sidebar-primary-foreground"
    | "--sidebar-ring"
  >;
}

const GRAY_SCALES: Record<GrayScale, GrayScaleColors> = {
  neutral: {
    light: {
      "--background": "0 0% 100%",
      "--foreground": "0 0% 3.9%",
      "--card": "0 0% 100%",
      "--card-foreground": "0 0% 3.9%",
      "--popover": "0 0% 100%",
      "--popover-foreground": "0 0% 3.9%",
      "--secondary": "0 0% 96.1%",
      "--secondary-foreground": "0 0% 9%",
      "--muted": "0 0% 96.1%",
      "--muted-foreground": "0 0% 45.1%",
      "--accent": "0 0% 96.1%",
      "--accent-foreground": "0 0% 9%",
      "--destructive": "0 84.2% 60.2%",
      "--destructive-foreground": "0 0% 98%",
      "--border": "0 0% 89.8%",
      "--input": "0 0% 89.8%",
      "--sidebar-background": "0 0% 98%",
      "--sidebar-foreground": "240 5.3% 26.1%",
      "--sidebar-accent": "240 4.8% 95.9%",
      "--sidebar-accent-foreground": "240 5.9% 10%",
      "--sidebar-border": "220 13% 91%",
    },
    dark: {
      "--background": "0 0% 3.9%",
      "--foreground": "0 0% 98%",
      "--card": "0 0% 3.9%",
      "--card-foreground": "0 0% 98%",
      "--popover": "0 0% 3.9%",
      "--popover-foreground": "0 0% 98%",
      "--secondary": "0 0% 14.9%",
      "--secondary-foreground": "0 0% 98%",
      "--muted": "0 0% 14.9%",
      "--muted-foreground": "0 0% 63.9%",
      "--accent": "0 0% 14.9%",
      "--accent-foreground": "0 0% 98%",
      "--destructive": "0 62.8% 30.6%",
      "--destructive-foreground": "0 0% 98%",
      "--border": "0 0% 14.9%",
      "--input": "0 0% 14.9%",
      "--sidebar-background": "240 5.9% 10%",
      "--sidebar-foreground": "240 4.8% 95.9%",
      "--sidebar-accent": "240 3.7% 15.9%",
      "--sidebar-accent-foreground": "240 4.8% 95.9%",
      "--sidebar-border": "240 3.7% 15.9%",
    },
  },
  stone: {
    light: {
      "--background": "0 0% 100%",
      "--foreground": "20 14.3% 4.1%",
      "--card": "0 0% 100%",
      "--card-foreground": "20 14.3% 4.1%",
      "--popover": "0 0% 100%",
      "--popover-foreground": "20 14.3% 4.1%",
      "--secondary": "60 4.8% 95.9%",
      "--secondary-foreground": "24 9.8% 10%",
      "--muted": "60 4.8% 95.9%",
      "--muted-foreground": "25 5.3% 44.7%",
      "--accent": "60 4.8% 95.9%",
      "--accent-foreground": "24 9.8% 10%",
      "--destructive": "0 84.2% 60.2%",
      "--destructive-foreground": "60 9.1% 97.8%",
      "--border": "20 5.9% 90%",
      "--input": "20 5.9% 90%",
      "--sidebar-background": "60 9.1% 97.8%",
      "--sidebar-foreground": "20 14.3% 4.1%",
      "--sidebar-accent": "60 4.8% 95.9%",
      "--sidebar-accent-foreground": "24 9.8% 10%",
      "--sidebar-border": "20 5.9% 90%",
    },
    dark: {
      "--background": "20 14.3% 4.1%",
      "--foreground": "60 9.1% 97.8%",
      "--card": "20 14.3% 4.1%",
      "--card-foreground": "60 9.1% 97.8%",
      "--popover": "20 14.3% 4.1%",
      "--popover-foreground": "60 9.1% 97.8%",
      "--secondary": "12 6.5% 15.1%",
      "--secondary-foreground": "60 9.1% 97.8%",
      "--muted": "12 6.5% 15.1%",
      "--muted-foreground": "24 5.4% 63.9%",
      "--accent": "12 6.5% 15.1%",
      "--accent-foreground": "60 9.1% 97.8%",
      "--destructive": "0 62.8% 30.6%",
      "--destructive-foreground": "60 9.1% 97.8%",
      "--border": "12 6.5% 15.1%",
      "--input": "12 6.5% 15.1%",
      "--sidebar-background": "20 14.3% 4.1%",
      "--sidebar-foreground": "60 9.1% 97.8%",
      "--sidebar-accent": "12 6.5% 15.1%",
      "--sidebar-accent-foreground": "60 9.1% 97.8%",
      "--sidebar-border": "12 6.5% 15.1%",
    },
  },
  zinc: {
    light: {
      "--background": "0 0% 100%",
      "--foreground": "240 10% 3.9%",
      "--card": "0 0% 100%",
      "--card-foreground": "240 10% 3.9%",
      "--popover": "0 0% 100%",
      "--popover-foreground": "240 10% 3.9%",
      "--secondary": "240 4.8% 95.9%",
      "--secondary-foreground": "240 5.9% 10%",
      "--muted": "240 4.8% 95.9%",
      "--muted-foreground": "240 3.8% 46.1%",
      "--accent": "240 4.8% 95.9%",
      "--accent-foreground": "240 5.9% 10%",
      "--destructive": "0 84.2% 60.2%",
      "--destructive-foreground": "0 0% 98%",
      "--border": "240 5.9% 90%",
      "--input": "240 5.9% 90%",
      "--sidebar-background": "0 0% 98%",
      "--sidebar-foreground": "240 5.3% 26.1%",
      "--sidebar-accent": "240 4.8% 95.9%",
      "--sidebar-accent-foreground": "240 5.9% 10%",
      "--sidebar-border": "240 5.9% 90%",
    },
    dark: {
      "--background": "240 10% 3.9%",
      "--foreground": "0 0% 98%",
      "--card": "240 10% 3.9%",
      "--card-foreground": "0 0% 98%",
      "--popover": "240 10% 3.9%",
      "--popover-foreground": "0 0% 98%",
      "--secondary": "240 3.7% 15.9%",
      "--secondary-foreground": "0 0% 98%",
      "--muted": "240 3.7% 15.9%",
      "--muted-foreground": "240 5% 64.9%",
      "--accent": "240 3.7% 15.9%",
      "--accent-foreground": "0 0% 98%",
      "--destructive": "0 62.8% 30.6%",
      "--destructive-foreground": "0 0% 98%",
      "--border": "240 3.7% 15.9%",
      "--input": "240 3.7% 15.9%",
      "--sidebar-background": "240 5.9% 10%",
      "--sidebar-foreground": "240 4.8% 95.9%",
      "--sidebar-accent": "240 3.7% 15.9%",
      "--sidebar-accent-foreground": "240 4.8% 95.9%",
      "--sidebar-border": "240 3.7% 15.9%",
    },
  },
  gray: {
    light: {
      "--background": "0 0% 100%",
      "--foreground": "224 71.4% 4.1%",
      "--card": "0 0% 100%",
      "--card-foreground": "224 71.4% 4.1%",
      "--popover": "0 0% 100%",
      "--popover-foreground": "224 71.4% 4.1%",
      "--secondary": "220 14.3% 95.9%",
      "--secondary-foreground": "220.9 39.3% 11%",
      "--muted": "220 14.3% 95.9%",
      "--muted-foreground": "220 8.9% 46.1%",
      "--accent": "220 14.3% 95.9%",
      "--accent-foreground": "220.9 39.3% 11%",
      "--destructive": "0 84.2% 60.2%",
      "--destructive-foreground": "210 20% 98%",
      "--border": "220 13% 91%",
      "--input": "220 13% 91%",
      "--sidebar-background": "210 20% 98%",
      "--sidebar-foreground": "224 71.4% 4.1%",
      "--sidebar-accent": "220 14.3% 95.9%",
      "--sidebar-accent-foreground": "220.9 39.3% 11%",
      "--sidebar-border": "220 13% 91%",
    },
    dark: {
      "--background": "224 71.4% 4.1%",
      "--foreground": "210 20% 98%",
      "--card": "224 71.4% 4.1%",
      "--card-foreground": "210 20% 98%",
      "--popover": "224 71.4% 4.1%",
      "--popover-foreground": "210 20% 98%",
      "--secondary": "215 27.9% 16.9%",
      "--secondary-foreground": "210 20% 98%",
      "--muted": "215 27.9% 16.9%",
      "--muted-foreground": "217.9 10.6% 64.9%",
      "--accent": "215 27.9% 16.9%",
      "--accent-foreground": "210 20% 98%",
      "--destructive": "0 62.8% 30.6%",
      "--destructive-foreground": "210 20% 98%",
      "--border": "215 27.9% 16.9%",
      "--input": "215 27.9% 16.9%",
      "--sidebar-background": "224 71.4% 4.1%",
      "--sidebar-foreground": "210 20% 98%",
      "--sidebar-accent": "215 27.9% 16.9%",
      "--sidebar-accent-foreground": "210 20% 98%",
      "--sidebar-border": "215 27.9% 16.9%",
    },
  },
  slate: {
    light: {
      "--background": "0 0% 100%",
      "--foreground": "222.2 84% 4.9%",
      "--card": "0 0% 100%",
      "--card-foreground": "222.2 84% 4.9%",
      "--popover": "0 0% 100%",
      "--popover-foreground": "222.2 84% 4.9%",
      "--secondary": "210 40% 96.1%",
      "--secondary-foreground": "222.2 47.4% 11.2%",
      "--muted": "210 40% 96.1%",
      "--muted-foreground": "215.4 16.3% 46.9%",
      "--accent": "210 40% 96.1%",
      "--accent-foreground": "222.2 47.4% 11.2%",
      "--destructive": "0 84.2% 60.2%",
      "--destructive-foreground": "210 40% 98%",
      "--border": "214.3 31.8% 91.4%",
      "--input": "214.3 31.8% 91.4%",
      "--sidebar-background": "210 40% 98%",
      "--sidebar-foreground": "222.2 84% 4.9%",
      "--sidebar-accent": "210 40% 96.1%",
      "--sidebar-accent-foreground": "222.2 47.4% 11.2%",
      "--sidebar-border": "214.3 31.8% 91.4%",
    },
    dark: {
      "--background": "222.2 84% 4.9%",
      "--foreground": "210 40% 98%",
      "--card": "222.2 84% 4.9%",
      "--card-foreground": "210 40% 98%",
      "--popover": "222.2 84% 4.9%",
      "--popover-foreground": "210 40% 98%",
      "--secondary": "217.2 32.6% 17.5%",
      "--secondary-foreground": "210 40% 98%",
      "--muted": "217.2 32.6% 17.5%",
      "--muted-foreground": "215 20.2% 65.1%",
      "--accent": "217.2 32.6% 17.5%",
      "--accent-foreground": "210 40% 98%",
      "--destructive": "0 62.8% 30.6%",
      "--destructive-foreground": "210 40% 98%",
      "--border": "217.2 32.6% 17.5%",
      "--input": "217.2 32.6% 17.5%",
      "--sidebar-background": "222.2 84% 4.9%",
      "--sidebar-foreground": "210 40% 98%",
      "--sidebar-accent": "217.2 32.6% 17.5%",
      "--sidebar-accent-foreground": "210 40% 98%",
      "--sidebar-border": "217.2 32.6% 17.5%",
    },
  },
};

// ============================================================================
// 预设主色调
// ============================================================================

export const PRESET_PRIMARY_COLORS = [
  { name: "蓝色", value: "#2563eb", description: "专业、信任" },
  { name: "绿色", value: "#10b981", description: "成长、自然" },
  { name: "紫色", value: "#8b5cf6", description: "创意、科技" },
  { name: "橙色", value: "#f97316", description: "活力、热情" },
  { name: "红色", value: "#ef4444", description: "醒目、重要" },
  { name: "青色", value: "#06b6d4", description: "清新、现代" },
  { name: "粉色", value: "#ec4899", description: "温暖、友好" },
  { name: "靛蓝", value: "#6366f1", description: "高端、神秘" },
] as const;

export const PRESET_SECONDARY_COLORS = [
  { name: "中性灰", value: "#6b7280", description: "平衡、专业" },
  { name: "暖灰", value: "#78716c", description: "温暖、自然" },
  { name: "冷灰", value: "#71717a", description: "冷静、现代" },
  { name: "蓝灰", value: "#64748b", description: "稳重、科技" },
  { name: "紫灰", value: "#7c7c8a", description: "优雅、神秘" },
  { name: "绿灰", value: "#6b7770", description: "自然、平和" },
] as const;

/**
 * 根据主色调生成推荐的次要颜色
 * 基于色彩理论生成与主色调协调的次要颜色选项
 * @param primaryColor - 主色调的 HEX 值
 * @returns 推荐的次要颜色数组
 */
export function generateRecommendedSecondaryColors(
  primaryColor: string
): Array<{ name: string; value: string; description: string }> {
  if (!primaryColor || !isValidHexColor(primaryColor)) {
    return [];
  }

  try {
    const color = new Color(primaryColor);
    const hsl = color.to("hsl");
    const h = hsl.coords[0] || 0;
    const s = hsl.coords[1] || 50;
    const l = hsl.coords[2] || 50;

    const recommendations: Array<{
      name: string;
      value: string;
      description: string;
    }> = [];

    // 1. 同色系柔和灰 - 保持色相，大幅降低饱和度
    const mutedGray = new Color("hsl", [h, Math.min(s * 0.15, 10), 45]);
    recommendations.push({
      name: "同色系灰",
      value: mutedGray.to("srgb").toString({ format: "hex" }),
      description: "协调统一",
    });

    // 2. 主色淡化版 - 保持色相，降低饱和度，调整亮度
    const softTint = new Color("hsl", [h, Math.min(s * 0.25, 20), 50]);
    recommendations.push({
      name: "柔和色调",
      value: softTint.to("srgb").toString({ format: "hex" }),
      description: "温和协调",
    });

    // 3. 互补色灰调 - 色相偏移180度
    const complementaryHue = (h + 180) % 360;
    const complementaryGray = new Color("hsl", [complementaryHue, Math.min(s * 0.12, 8), 48]);
    recommendations.push({
      name: "互补灰调",
      value: complementaryGray.to("srgb").toString({ format: "hex" }),
      description: "对比平衡",
    });

    // 4. 类似色灰调 - 色相偏移30度
    const analogousHue = (h + 30) % 360;
    const analogousGray = new Color("hsl", [analogousHue, Math.min(s * 0.15, 10), 46]);
    recommendations.push({
      name: "类似灰调",
      value: analogousGray.to("srgb").toString({ format: "hex" }),
      description: "自然过渡",
    });

    // 5. 冷暖平衡灰 - 根据主色冷暖倾向选择相反的灰调
    const isWarm = (h >= 0 && h <= 60) || (h >= 300 && h <= 360);
    const balanceHue = isWarm ? 210 : 30; // 暖色配冷灰，冷色配暖灰
    const balanceGray = new Color("hsl", [balanceHue, 8, 47]);
    recommendations.push({
      name: isWarm ? "冷调平衡" : "暖调平衡",
      value: balanceGray.to("srgb").toString({ format: "hex" }),
      description: "冷暖调和",
    });

    return recommendations;
  } catch (e) {
    console.error("生成推荐次要颜色失败:", e);
    return [];
  }
}

export const GRAY_SCALE_OPTIONS = [
  { name: "中性灰", value: "neutral" as GrayScale, description: "纯净中性" },
  { name: "暖灰", value: "stone" as GrayScale, description: "温暖舒适" },
  { name: "冷灰", value: "zinc" as GrayScale, description: "冷静专业" },
  { name: "标准灰", value: "gray" as GrayScale, description: "经典平衡" },
  { name: "深冷灰", value: "slate" as GrayScale, description: "深邃稳重" },
] as const;

// ============================================================================
// 颜色转换工具函数
// ============================================================================

/**
 * 将 HEX 颜色转换为 HSL 格式字符串（用于 CSS 变量）
 * @param hex - HEX 颜色值，如 "#2563eb"
 * @returns HSL 格式字符串，如 "217 91% 60%"
 */
export function hexToHsl(hex: string): string {
  try {
    const color = new Color(hex);
    const hsl = color.to("hsl");
    const h = Math.round(hsl.coords[0] || 0);
    const s = Math.round((hsl.coords[1] || 0) * 100) / 100;
    const l = Math.round((hsl.coords[2] || 0) * 100) / 100;
    return `${h} ${s}% ${l}%`;
  } catch (e) {
    console.error("Invalid hex color:", hex, e);
    return "0 0% 50%"; // 默认灰色
  }
}

/**
 * 将 HSL 值转换为 HSL 格式字符串
 */
function hslToString(h: number, s: number, l: number): string {
  return `${Math.round(h)} ${Math.round(s)}% ${Math.round(l)}%`;
}

/**
 * 从 HEX 获取 HSL 数值
 */
function hexToHslValues(hex: string): { h: number; s: number; l: number } {
  try {
    const color = new Color(hex);
    const hsl = color.to("hsl");
    return {
      h: hsl.coords[0] || 0,
      s: hsl.coords[1] || 0,
      l: hsl.coords[2] || 0,
    };
  } catch (e) {
    return { h: 0, s: 0, l: 50 };
  }
}

/**
 * 计算对比色（用于 foreground）
 * 根据背景亮度自动选择黑色或白色文字
 * @param hex - 背景色 HEX 值
 * @returns 适合的前景色 HSL 字符串
 */
export function getContrastForeground(hex: string): string {
  try {
    const color = new Color(hex);
    const luminance = color.luminance;
    // 亮度大于 0.5 使用深色文字，否则使用浅色文字
    return luminance > 0.5 ? "0 0% 9%" : "0 0% 98%";
  } catch (e) {
    return "0 0% 98%"; // 默认白色
  }
}

/**
 * 根据主色生成 ring 颜色（通常与主色相同或稍浅）
 */
export function generateRingColor(hex: string): string {
  return hexToHsl(hex);
}

// ============================================================================
// 色阶生成函数
// ============================================================================

/**
 * 根据基础色生成完整色阶（50-950）
 * @param hex - 基础色 HEX 值（通常是 500 档位）
 * @param mode - 亮色或暗色模式
 * @returns 色阶对象
 */
export function generateColorScale(hex: string, mode: "light" | "dark" = "light"): ColorScale {
  const { h, s, l } = hexToHslValues(hex);

  // 色阶的亮度值定义（从浅到深）
  // 这些值基于 Tailwind CSS 的色阶设计
  const lightModeLightness = {
    50: 97,
    100: 94,
    200: 86,
    300: 76,
    400: 64,
    500: l, // 保持原始亮度作为 500
    600: 47,
    700: 38,
    800: 30,
    900: 22,
    950: 12,
  };

  // 暗色模式下的色阶亮度需要反转并调整
  const darkModeLightness = {
    50: 5,
    100: 10,
    200: 18,
    300: 26,
    400: 38,
    500: Math.min(l + 10, 70), // 暗色模式下主色稍亮
    600: 55,
    700: 65,
    800: 78,
    900: 88,
    950: 95,
  };

  const lightnessMap = mode === "light" ? lightModeLightness : darkModeLightness;

  // 饱和度也需要根据亮度调整
  const getSaturation = (lightness: number): number => {
    if (mode === "light") {
      // 亮色模式：越浅饱和度越低，越深饱和度稍高
      if (lightness > 80) return Math.max(s * 0.3, 20);
      if (lightness > 60) return s * 0.8;
      if (lightness < 30) return Math.min(s * 1.2, 100);
      return s;
    } else {
      // 暗色模式：整体饱和度降低
      if (lightness < 20) return Math.max(s * 0.4, 15);
      if (lightness > 70) return s * 0.7;
      return s * 0.9;
    }
  };

  return {
    "--primary-50": hslToString(h, getSaturation(lightnessMap[50]), lightnessMap[50]),
    "--primary-100": hslToString(h, getSaturation(lightnessMap[100]), lightnessMap[100]),
    "--primary-200": hslToString(h, getSaturation(lightnessMap[200]), lightnessMap[200]),
    "--primary-300": hslToString(h, getSaturation(lightnessMap[300]), lightnessMap[300]),
    "--primary-400": hslToString(h, getSaturation(lightnessMap[400]), lightnessMap[400]),
    "--primary-500": hslToString(h, s, lightnessMap[500]),
    "--primary-600": hslToString(h, getSaturation(lightnessMap[600]), lightnessMap[600]),
    "--primary-700": hslToString(h, getSaturation(lightnessMap[700]), lightnessMap[700]),
    "--primary-800": hslToString(h, getSaturation(lightnessMap[800]), lightnessMap[800]),
    "--primary-900": hslToString(h, getSaturation(lightnessMap[900]), lightnessMap[900]),
    "--primary-950": hslToString(h, getSaturation(lightnessMap[950]), lightnessMap[950]),
  };
}

// ============================================================================
// 语义化颜色生成函数
// ============================================================================

/**
 * 生成语义化颜色
 * @param primaryHex - 主色 HEX 值
 * @param mode - 亮色或暗色模式
 * @returns 语义化颜色对象
 */
/**
 * 基于主色生成图表配色方案
 * 使用色相分散策略确保颜色可区分
 * @param primaryHex - 主色 HEX 值
 * @param mode - 亮色或暗色模式
 * @returns 图表颜色对象
 */
export function generateChartColors(
  primaryHex: string,
  mode: "light" | "dark" = "light"
): ChartColors {
  const { h, s } = hexToHslValues(primaryHex);

  // 色相偏移角度，确保5种颜色在色轮上均匀分布
  const hueOffsets = [0, 60, 120, 180, 240];

  // 根据模式调整亮度和饱和度
  const baseLightness = mode === "light" ? 55 : 60;
  const baseSaturation = mode === "light" ? Math.max(s, 65) : Math.max(s, 55);

  const chartColors: ChartColors = {
    "--chart-1": "",
    "--chart-2": "",
    "--chart-3": "",
    "--chart-4": "",
    "--chart-5": "",
  };

  hueOffsets.forEach((offset, index) => {
    const newHue = (h + offset) % 360;
    // 稍微调整每个颜色的饱和度和亮度，增加视觉层次
    const adjustedSaturation = Math.min(100, baseSaturation + (index % 2 === 0 ? 5 : -5));
    const adjustedLightness = baseLightness + (index % 2 === 0 ? 0 : 5);
    const key = `--chart-${index + 1}` as keyof ChartColors;
    chartColors[key] = hslToString(newHue, adjustedSaturation, adjustedLightness);
  });

  return chartColors;
}

export function generateSemanticColors(
  primaryHex: string,
  mode: "light" | "dark" = "light"
): SemanticColors {
  const { h } = hexToHslValues(primaryHex);

  if (mode === "light") {
    return {
      // 成功色：绿色系，色相偏移 +120° 或固定绿色
      "--success": "142 76% 36%",
      "--success-foreground": "0 0% 100%",
      // 警告色：橙色/黄色系
      "--warning": "38 92% 50%",
      "--warning-foreground": "0 0% 0%",
      // 信息色：可以使用主色或固定蓝色
      "--info": `${h} 70% 55%`,
      "--info-foreground": "0 0% 100%",
    };
  } else {
    return {
      // 暗色模式下颜色稍亮
      "--success": "142 69% 58%",
      "--success-foreground": "0 0% 0%",
      "--warning": "38 92% 50%",
      "--warning-foreground": "0 0% 0%",
      "--info": `${h} 65% 65%`,
      "--info-foreground": "0 0% 0%",
    };
  }
}

// ============================================================================
// 主题生成函数
// ============================================================================

/**
 * 根据主题配置生成完整的 CSS 变量对象
 * @param config - 主题配置
 * @param mode - 亮色或暗色模式
 * @returns 完整的 CSS 变量对象
 */
export function generateThemeColors(
  config: ThemeConfig,
  mode: "light" | "dark" = "light"
): ExtendedThemeColors {
  const grayColors = GRAY_SCALES[config.grayScale]?.[mode] || GRAY_SCALES.neutral[mode];
  const primaryHsl = hexToHsl(config.primaryColor);
  const primaryForeground = getContrastForeground(config.primaryColor);
  const ringHsl = generateRingColor(config.primaryColor);

  // 获取 primary 的 HSL 值
  const { h: pH, s: pS, l: pL } = hexToHslValues(config.primaryColor);

  // 处理 secondary 颜色
  // 如果用户指定了 secondaryColor，使用它；否则从 grayScale 获取默认值
  const secondaryColor = config.secondaryColor || getDefaultSecondaryColor(config.grayScale);
  const { h: sH, s: sS, l: sL } = hexToHslValues(secondaryColor);

  // 暗色模式下主色需要调整
  let adjustedPrimaryHsl = primaryHsl;
  let adjustedPrimaryForeground = primaryForeground;

  if (mode === "dark") {
    // 暗色模式下主色稍微调亮
    adjustedPrimaryHsl = hslToString(pH, pS, Math.min(pL + 10, 70));
    // 暗色模式下前景色需要重新计算
    adjustedPrimaryForeground = pL > 40 ? "0 0% 9%" : "0 0% 98%";
  }

  // 生成 secondary 相关颜色
  let secondaryHsl: string;
  let secondaryForegroundHsl: string;

  if (mode === "light") {
    // 亮色模式：secondary 使用浅色背景
    secondaryHsl = hslToString(sH, Math.max(sS * 0.3, 5), 96);
    secondaryForegroundHsl = hslToString(sH, Math.max(sS * 0.5, 10), 15);
  } else {
    // 暗色模式：secondary 使用深色背景
    secondaryHsl = hslToString(sH, Math.max(sS * 0.3, 5), 15);
    secondaryForegroundHsl = hslToString(sH, Math.max(sS * 0.3, 10), 98);
  }

  // 生成 accent 颜色（基于 primary 的浅色/深色变体）
  let accentHsl: string;
  let accentForegroundHsl: string;

  if (mode === "light") {
    // 亮色模式：accent 是 primary 的非常浅的变体
    accentHsl = hslToString(pH, Math.max(pS * 0.4, 20), 96);
    accentForegroundHsl = hslToString(pH, Math.min(pS, 80), 15);
  } else {
    // 暗色模式：accent 是 primary 的深色变体
    accentHsl = hslToString(pH, Math.max(pS * 0.3, 15), 15);
    accentForegroundHsl = hslToString(pH, Math.max(pS * 0.5, 30), 98);
  }

  // 生成 muted 颜色（基于 secondary 的更柔和变体）
  let mutedHsl: string;
  let mutedForegroundHsl: string;

  if (mode === "light") {
    mutedHsl = hslToString(sH, Math.max(sS * 0.2, 3), 96);
    mutedForegroundHsl = hslToString(sH, Math.max(sS * 0.3, 5), 45);
  } else {
    mutedHsl = hslToString(sH, Math.max(sS * 0.2, 3), 15);
    mutedForegroundHsl = hslToString(sH, Math.max(sS * 0.2, 5), 64);
  }

  // 生成 sidebar 相关颜色
  // - accent（选中状态）基于 primary
  // - background/foreground/border 基于 secondary
  let sidebarAccentHsl: string;
  let sidebarAccentForegroundHsl: string;
  let sidebarForegroundHsl: string;
  let sidebarBorderHsl: string;
  let sidebarBackgroundHsl: string;

  if (mode === "light") {
    // 亮色模式
    // accent: 选中/悬浮背景 - primary 的浅色变体
    sidebarAccentHsl = hslToString(pH, Math.max(pS * 0.6, 35), 92);
    // accent-foreground: 选中/悬浮文字 - primary 的深色
    sidebarAccentForegroundHsl = hslToString(pH, Math.min(pS * 0.9, 85), 30);
    // background: 侧边栏背景 - secondary 的非常浅的变体
    sidebarBackgroundHsl = hslToString(sH, Math.max(sS * 0.3, 8), 97);
    // foreground: 默认文字颜色 - secondary 的深色
    sidebarForegroundHsl = hslToString(sH, Math.max(sS * 0.4, 12), 35);
    // border: 边框颜色 - secondary 的浅色
    sidebarBorderHsl = hslToString(sH, Math.max(sS * 0.3, 10), 88);
  } else {
    // 暗色模式
    sidebarAccentHsl = hslToString(pH, Math.max(pS * 0.5, 25), 20);
    sidebarAccentForegroundHsl = hslToString(pH, Math.max(pS * 0.6, 40), 92);
    sidebarBackgroundHsl = hslToString(sH, Math.max(sS * 0.2, 5), 8);
    sidebarForegroundHsl = hslToString(sH, Math.max(sS * 0.3, 10), 80);
    sidebarBorderHsl = hslToString(sH, Math.max(sS * 0.2, 8), 18);
  }

  // 生成 border 和 input 颜色（基于 secondary）
  let borderHsl: string;
  let inputHsl: string;

  if (mode === "light") {
    borderHsl = hslToString(sH, Math.max(sS * 0.15, 5), 90);
    inputHsl = hslToString(sH, Math.max(sS * 0.15, 5), 90);
  } else {
    borderHsl = hslToString(sH, Math.max(sS * 0.15, 5), 15);
    inputHsl = hslToString(sH, Math.max(sS * 0.15, 5), 15);
  }

  const colorScale = generateColorScale(config.primaryColor, mode);
  const semanticColors = generateSemanticColors(config.primaryColor, mode);
  const chartColors = generateChartColors(config.primaryColor, mode);

  return {
    ...grayColors,
    "--primary": adjustedPrimaryHsl,
    "--primary-foreground": adjustedPrimaryForeground,
    "--secondary": secondaryHsl,
    "--secondary-foreground": secondaryForegroundHsl,
    "--accent": accentHsl,
    "--accent-foreground": accentForegroundHsl,
    "--muted": mutedHsl,
    "--muted-foreground": mutedForegroundHsl,
    "--border": borderHsl,
    "--input": inputHsl,
    "--ring": ringHsl,
    "--sidebar-background": sidebarBackgroundHsl,
    "--sidebar-foreground": sidebarForegroundHsl,
    "--sidebar-primary": adjustedPrimaryHsl,
    "--sidebar-primary-foreground": adjustedPrimaryForeground,
    "--sidebar-accent": sidebarAccentHsl,
    "--sidebar-accent-foreground": sidebarAccentForegroundHsl,
    "--sidebar-border": sidebarBorderHsl,
    "--sidebar-ring": ringHsl,
    ...colorScale,
    ...semanticColors,
    ...chartColors,
  };
}

/**
 * 根据 grayScale 获取默认的 secondary 颜色
 */
function getDefaultSecondaryColor(grayScale: GrayScale): string {
  const defaults: Record<GrayScale, string> = {
    neutral: "#6b7280",
    stone: "#78716c",
    zinc: "#71717a",
    gray: "#6b7280",
    slate: "#64748b",
  };
  return defaults[grayScale] || "#6b7280";
}

// ============================================================================
// 主题应用函数
// ============================================================================

/**
 * 将颜色应用到指定元素
 */
function applyColorsToElement(colors: Partial<ExtendedThemeColors>, element: HTMLElement): void {
  Object.entries(colors).forEach(([key, value]) => {
    if (value) {
      element.style.setProperty(key, value);
    }
  });
}

/**
 * 将亮色主题应用到 :root
 */
function applyColorsToRoot(colors: ExtendedThemeColors): void {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  applyColorsToElement(colors, root);
}

/**
 * 将暗色主题应用到 .dark 样式
 * 通过创建或更新 style 标签实现
 */
function applyColorsToDarkClass(colors: ExtendedThemeColors): void {
  if (typeof document === "undefined") return;

  const styleId = "theme-dark-colors";
  let styleElement = document.getElementById(styleId) as HTMLStyleElement | null;

  if (!styleElement) {
    styleElement = document.createElement("style");
    styleElement.id = styleId;
    document.head.appendChild(styleElement);
  }

  const cssVariables = Object.entries(colors)
    .map(([key, value]) => `  ${key}: ${value};`)
    .join("\n");

  styleElement.textContent = `.dark {\n${cssVariables}\n}`;
}

/**
 * 将主题颜色应用到 document（旧版兼容）
 * @param colors - CSS 变量对象
 */
export function applyThemeColors(colors: ThemeColors): void {
  if (typeof document === "undefined") return;

  const root = document.documentElement;
  Object.entries(colors).forEach(([key, value]) => {
    root.style.setProperty(key, value);
  });
}

/**
 * 应用主题配置（同时应用亮色和暗色模式）
 * @param config - 主题配置
 */
export function applyTheme(config: ThemeConfig): void {
  const lightColors = generateThemeColors(config, "light");
  const darkColors = generateThemeColors(config, "dark");

  // 应用亮色到 :root
  applyColorsToRoot(lightColors);

  // 应用暗色到 .dark 类
  applyColorsToDarkClass(darkColors);
}

/**
 * 重置主题为默认值
 */
export function resetTheme(): void {
  if (typeof document === "undefined") return;

  const root = document.documentElement;
  const defaultColors = generateThemeColors(
    {
      primaryColor: "#000000",
      grayScale: "neutral",
    },
    "light"
  );

  // 移除所有自定义样式，让 CSS 文件中的默认值生效
  Object.keys(defaultColors).forEach((key) => {
    root.style.removeProperty(key);
  });

  // 移除暗色模式样式标签
  const darkStyleElement = document.getElementById("theme-dark-colors");
  if (darkStyleElement) {
    darkStyleElement.remove();
  }
}

/**
 * 验证 HEX 颜色格式
 * @param hex - 待验证的颜色值
 * @returns 是否为有效的 HEX 颜色
 */
export function isValidHexColor(hex: string): boolean {
  return /^#([A-Fa-f0-9]{6}|[A-Fa-f0-9]{3})$/.test(hex);
}

/**
 * 获取默认主题配置
 */
export function getDefaultThemeConfig(): ThemeConfig {
  return {
    primaryColor: "#000000",
    grayScale: "neutral",
  };
}

/**
 * 主题模式选项
 */
export const THEME_MODE_OPTIONS: {
  name: string;
  value: ThemeMode;
  description: string;
}[] = [
  { name: "亮色", value: "light", description: "始终使用亮色模式" },
  { name: "暗色", value: "dark", description: "始终使用暗色模式" },
  { name: "跟随系统", value: "system", description: "根据系统设置自动切换" },
];

/**
 * 获取当前系统的主题模式偏好
 */
export function getSystemThemeMode(): "light" | "dark" {
  if (typeof window === "undefined") return "light";
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

/**
 * 设置主题模式
 * @param mode - 主题模式
 */
export function setThemeMode(mode: ThemeMode): void {
  if (typeof document === "undefined") return;

  const root = document.documentElement;
  const effectiveMode = mode === "system" ? getSystemThemeMode() : mode;

  if (effectiveMode === "dark") {
    root.classList.add("dark");
  } else {
    root.classList.remove("dark");
  }

  // 存储用户选择到 localStorage
  localStorage.setItem("theme-mode", mode);
}

/**
 * 获取当前主题模式
 */
export function getThemeMode(): ThemeMode {
  if (typeof localStorage === "undefined") return "light";
  return (localStorage.getItem("theme-mode") as ThemeMode) || "light";
}

/**
 * 初始化主题模式（在页面加载时调用）
 * @param savedMode - 从服务器获取的保存的模式，如果有的话
 */
export function initThemeMode(savedMode?: ThemeMode): void {
  if (typeof document === "undefined") return;

  // 优先使用服务器保存的设置，其次使用 localStorage
  const mode = savedMode || getThemeMode();
  setThemeMode(mode);

  // 如果是跟随系统模式，监听系统主题变化
  if (mode === "system") {
    const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
    const handleChange = (e: MediaQueryListEvent) => {
      if (getThemeMode() === "system") {
        if (e.matches) {
          document.documentElement.classList.add("dark");
        } else {
          document.documentElement.classList.remove("dark");
        }
      }
    };
    mediaQuery.addEventListener("change", handleChange);
  }
}
