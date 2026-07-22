"use client";

import { usePathname } from "next/navigation";
import type { SiteConfig } from "../layout";
import AuthGate from "./AuthGate";
import LayoutWrapper from "./LayoutWrapper";
import ThemeProvider from "./ThemeProvider";

// 不需要布局的公开路径（无侧边栏、无认证）
const PUBLIC_PATHS_NO_LAYOUT = [
  /^\/public\//, // 公开页面
  /^\/forgot-password$/, // 忘记密码页面
  /^\/reset-password$/, // 重置密码页面
  /^\/feedback\/[A-Za-z0-9_-]+$/, // 反馈页面
];

export default function ConditionalAuthWrapper({
  children,
  siteConfig,
}: {
  children: React.ReactNode;
  siteConfig: SiteConfig;
}) {
  const pathname = usePathname();
  if (!pathname) {
    return <>{children}</>;
  }

  // 如果是公开页面，不应用 AuthGate 和 LayoutWrapper
  const isPublicNoLayout = PUBLIC_PATHS_NO_LAYOUT.some((pattern) => pattern.test(pathname));

  if (isPublicNoLayout) {
    return (
      <ThemeProvider>
        <>{children}</>
      </ThemeProvider>
    );
  }

  // 其他页面需要认证和布局
  return (
    <ThemeProvider>
      <AuthGate siteConfig={siteConfig}>
        <LayoutWrapper>{children}</LayoutWrapper>
      </AuthGate>
    </ThemeProvider>
  );
}
