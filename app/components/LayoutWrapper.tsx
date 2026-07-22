"use client";

import { usePathname } from "next/navigation";
import AppSidebar from "./AppSidebar";
import { SidebarProvider, SidebarInset, SidebarTrigger } from "@/components/ui/sidebar";
import HeaderActions from "./HeaderActions";
import DynamicTitle from "./DynamicTitle";
import { UserProvider } from "@/hooks/useCurrentUser";

// 不需要侧边栏和导航的公开路径
const PUBLIC_PATHS = [
  /^\/feedback\/[A-Za-z0-9_-]+$/, // 反馈页面(加密): /feedback/{token}
];

// 默认收起侧边栏的路径
const COLLAPSED_SIDEBAR_PATHS = [
  "/demo",
  "/demo/business-trip-form",
  "/demo/sales-order",
  "/process-management",
];

export default function LayoutWrapper({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  // 检查是否是公开路径
  const isPublicPath = pathname ? PUBLIC_PATHS.some((pattern) => pattern.test(pathname)) : false;
  // 特定页面默认收起侧边栏
  const shouldCollapseSidebar = pathname ? COLLAPSED_SIDEBAR_PATHS.includes(pathname) : false;

  // 如果是公开路径，直接返回内容，不包含侧边栏和导航
  if (isPublicPath) {
    return <>{children}</>;
  }

  // 正常的后台管理界面布局
  return (
    <UserProvider>
      <SidebarProvider defaultOpen={!shouldCollapseSidebar}>
        <div className="flex h-screen w-full overflow-hidden">
          <AppSidebar />
          <SidebarInset className="flex-1 h-screen">
            <header className="flex h-16 shrink-0 items-center justify-between border-b px-2 sm:px-6">
              <div className="flex items-center gap-4">
                <SidebarTrigger />
                <DynamicTitle />
              </div>
              <HeaderActions />
            </header>
            <main className="flex-1 overflow-y-auto p-2 sm:p-6 min-w-0">{children}</main>
          </SidebarInset>
        </div>
      </SidebarProvider>
    </UserProvider>
  );
}
