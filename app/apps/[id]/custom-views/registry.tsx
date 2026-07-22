"use client";

import type { ComponentType } from "react";
import { AlertTriangle } from "lucide-react";
import ObserveDashboard from "./observe/ObserveDashboard";

/**
 * 自定义视图注册表：Custom 应用的 settings.view_key 映射到一个前端组件。
 * v1 写死在这里，新增一种自定义视图 = 加一个组件 + 在此注册一行。
 */
const REGISTRY: Record<string, ComponentType> = {
  "observe-dashboard": ObserveDashboard,
};

export function CustomViewRenderer({ viewKey }: { viewKey?: string }) {
  // 未配置 view_key：明确提示，而不是让详情页整片空白（Custom 应用的基本信息/统计/工具列表都已隐藏）。
  if (!viewKey) {
    return (
      <div className="flex items-center gap-2 rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
        <AlertTriangle className="h-4 w-4 shrink-0" />
        <span>该自定义应用尚未配置视图（settings.view_key 为空）。</span>
      </div>
    );
  }

  const View = REGISTRY[viewKey];

  // 早暴露：未注册的 view_key 直接报错，不静默渲染空白。
  if (!View) {
    return (
      <div className="flex items-center gap-2 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
        <AlertTriangle className="h-4 w-4 shrink-0" />
        <span>
          未注册的自定义视图：<code className="font-mono">{viewKey}</code>
        </span>
      </div>
    );
  }

  return <View />;
}
