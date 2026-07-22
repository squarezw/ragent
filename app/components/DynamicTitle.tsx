"use client";
import { usePathname } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Shield } from "lucide-react";
import { useTranslations } from "next-intl";

// 路由标题映射 - 使用翻译键
const routeTitleKeys: { [key: string]: string } = {
  "/": "home",
  "/chat": "chat",
  "/knowledge": "datasets",
  "/search": "search",
  "/graph": "knowledgeGraph",
  "/process-management": "processManagement",
  "/sop": "sopManagement",
  "/prompts": "promptManagement",
  "/organization": "organization",
  "/user": "userManagement",
  "/settings": "settings",
  "/monitoring": "systemMonitoring",
  "/about": "about",
};

// 子路由标题映射
const subRouteTitleKeys: { [key: string]: string } = {
  "/prompts/new": "newPrompt",
  "/prompts/": "promptDetail",
  "/monitoring/prompts": "promptMonitoring",
};

// 动态路由模式匹配
const dynamicRoutePatterns: { pattern: RegExp; titleKey: string }[] = [
  { pattern: /^\/prompts\/[^/]+$/, titleKey: "promptDetail" },
];

export default function DynamicTitle() {
  const pathname = usePathname();
  const t = useTranslations("navigation");

  // 获取当前路由对应的标题键
  let titleKey = "home";

  if (pathname) {
    // 首先检查精确匹配
    if (routeTitleKeys[pathname]) {
      titleKey = routeTitleKeys[pathname];
    } else {
      // 检查动态路由模式匹配
      const matchedDynamicRoute = dynamicRoutePatterns.find(({ pattern }) =>
        pattern.test(pathname)
      );
      if (matchedDynamicRoute) {
        titleKey = matchedDynamicRoute.titleKey;
      } else {
        // 检查子路由匹配
        const matchedSubRoute = Object.keys(subRouteTitleKeys).find((route) =>
          pathname.startsWith(route)
        );
        if (matchedSubRoute) {
          titleKey = subRouteTitleKeys[matchedSubRoute];
        } else {
          // 检查主路由匹配（去掉末尾的斜杠）
          const mainRoute = pathname.replace(/\/$/, "");
          if (routeTitleKeys[mainRoute]) {
            titleKey = routeTitleKeys[mainRoute];
          }
        }
      }
    }
  }

  return (
    <div className="flex items-center gap-2">
      <h1 className="text-xl font-semibold">{t(titleKey)}</h1>
      <Badge variant="outline" className="text-xs hidden sm:inline-flex">
        <Shield className="mr-1 h-3 w-3" />
        <a href="/about" className="text-primary hover:underline">
          v0.4.5
        </a>
      </Badge>
    </div>
  );
}
