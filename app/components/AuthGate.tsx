"use client";
import { isLogoutPending, setCookieAuthMode } from "@/lib/browserAuthMode";
import { LoginPage } from "@/components/login-page";
import { getCurrentUser } from "@/hooks/useCurrentUser";
import { AxiosError } from "axios";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { MOBILE_LANDING_PATH, shouldLandOnChat } from "@/lib/postLoginLanding";
import type { SiteConfig } from "../layout";

const LOGIN_KEY = "ragent_logged_in";
const TOKEN_KEY = "ragent_token";

// 不需要认证的公开路径
const PUBLIC_PATHS = [
  /^\/feedback\/[A-Za-z0-9_-]+$/, // 反馈页面(加密): /feedback/{token}
  /^\/forgot-password$/, // 忘记密码页面
  /^\/reset-password$/, // 重置密码页面
];

export default function AuthGate({
  children,
  siteConfig,
}: {
  children: React.ReactNode;
  siteConfig: SiteConfig;
}) {
  const pathname = usePathname();
  const t = useTranslations("login");
  const [loggedIn, setLoggedIn] = useState<boolean | undefined>(undefined);
  const [isValidating, setIsValidating] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [oidcEnabled, setOidcEnabled] = useState(false);
  const [signedOut, setSignedOut] = useState(false);
  const [logoutPending, setLogoutPending] = useState(false);
  const validationGeneration = useRef(0);
  const [authUnavailable, setAuthUnavailable] = useState(false);

  // 检查是否是公开路径
  const isPublicPath = useMemo(
    () => PUBLIC_PATHS.some((pattern) => pattern.test(pathname ?? "")),
    [pathname]
  );

  // 验证 token 有效性
  const validateToken = useCallback(async () => {
    if (typeof window === "undefined") return;

    const generation = ++validationGeneration.current;
    setIsValidating(true);
    setAuthUnavailable(false);
    let cookieMode = false;
    try {
      const methods = await fetch("/api/auth/methods", {
        cache: "no-store",
        credentials: "same-origin",
      });
      if (!methods.ok) throw Error("Authentication configuration unavailable");
      const config = await methods.json();
      if (generation !== validationGeneration.current) return;
      cookieMode = config.oidcEnabled === true;
      setCookieAuthMode(cookieMode);
      setOidcEnabled(cookieMode);
      const explicitlySignedOut = cookieMode && (config.signedOut === true || new URLSearchParams(window.location.search).get("signedOut") === "1");
      setSignedOut(explicitlySignedOut);
      if (explicitlySignedOut) {
        setLoggedIn(false);
        return;
      }
      if (
        !cookieMode &&
        (!localStorage.getItem(TOKEN_KEY) || localStorage.getItem(LOGIN_KEY) !== "true")
      ) {
        setLoggedIn(false);
        return;
      }
      // 使用全局用户状态检查 token 有效性
      // 这里会触发一次 API 调用，UserProvider 会复用这个结果
      await getCurrentUser();
      if (generation === validationGeneration.current && !isLogoutPending()) setLoggedIn(true);
    } catch (error) {
      if (generation !== validationGeneration.current) return;
      // 如果验证失败，清除登录状态
      if (error instanceof AxiosError && [401, 403].includes(error.response?.status || 0)) {
        localStorage.removeItem(TOKEN_KEY);
        localStorage.removeItem(LOGIN_KEY);
        setLoggedIn(false);
      } else {
        setAuthUnavailable(true);
        setLoggedIn(false);
      }
    } finally {
      if (generation === validationGeneration.current) setIsValidating(false);
    }
  }, []);

  useEffect(() => {
    if (
      loggedIn === false &&
      oidcEnabled &&
      !authUnavailable &&
      !signedOut &&
      !logoutPending &&
      !isLogoutPending()
    ) {
      const returnTo = window.location.pathname + window.location.search;
      window.location.assign("/api/auth/oidc/start?returnTo=" + encodeURIComponent(returnTo));
    }
  }, [loggedIn, oidcEnabled, authUnavailable, signedOut, logoutPending]);

  // 处理登出事件
  const handleLogout = useCallback(() => {
    setLoggedIn(false);
  }, []);

  useEffect(() => {
    // 公开路径不需要验证
    if (isPublicPath) {
      setMounted(true);
      return;
    }

    setMounted(true);
    validateToken();

    // 监听登出事件
    const handleAuthLogout = () => {
      handleLogout();
    };

    const handleLogoutStart = () => {
      ++validationGeneration.current;
      setLogoutPending(true);
      setIsValidating(false);
    };
    const handleLogoutFailed = () => {
      setLogoutPending(false);
      void validateToken();
    };
    if (typeof window !== "undefined") {
      window.addEventListener("auth:logout-start", handleLogoutStart);
      window.addEventListener("auth:logout-failed", handleLogoutFailed);
      window.addEventListener("auth:logout", handleAuthLogout);
    }

    return () => {
      if (typeof window !== "undefined") {
        window.removeEventListener("auth:logout-start", handleLogoutStart);
        window.removeEventListener("auth:logout-failed", handleLogoutFailed);
        window.removeEventListener("auth:logout", handleAuthLogout);
      }
    };
  }, [isPublicPath, validateToken, handleLogout]);

  const handleLogin = useCallback(() => {
    setLoggedIn(true);
    if (typeof window !== "undefined") {
      localStorage.setItem(LOGIN_KEY, "true");
      // 手机上登录完落到对话页：首页是桌面版仪表盘，窄屏上读不了。
      // 判断只在这里做（登录成功那一下），不做成每次打开都判 ——
      // 那样侧边栏的「首页」在手机上就永远点不进去了。
      if (
        shouldLandOnChat({
          pathname: window.location.pathname,
          search: window.location.search,
          viewportWidth: window.innerWidth,
        })
      ) {
        window.location.href = MOBILE_LANDING_PATH;
      }
    }
  }, []);

  // 登录态确定后，若 URL 带 ?redirect=(由 /api/uploads 未登录时 302 注入)，跳回原始下载链接
  useEffect(() => {
    if (loggedIn !== true || typeof window === "undefined") return;
    const redirect = new URLSearchParams(window.location.search).get("redirect");
    // 只允许站内相对路径，防开放重定向
    if (redirect && redirect.startsWith("/") && !redirect.startsWith("//")) {
      window.location.href = redirect;
    }
  }, [loggedIn]);

  // 如果是公开路径，直接返回内容，不需要认证
  if (isPublicPath) {
    return <>{children}</>;
  }

  // 在客户端挂载前，显示加载状态以确保服务端和客户端初始渲染一致
  if (!mounted || loggedIn === undefined || isValidating) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30">
        <div className="bg-card rounded-lg p-6 flex items-center gap-3">
          <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary" />
          <span>{t("verifyingLogin")}</span>
        </div>
      </div>
    );
  }

  if (
    !loggedIn &&
    oidcEnabled &&
    mounted &&
    signedOut
  )
    return (
      <div className="flex min-h-screen items-center justify-center">
        <a
          className="rounded-md bg-primary px-6 py-3 text-primary-foreground"
          href="/api/auth/oidc/start"
        >
          {t("loginButton")}
        </a>
      </div>
    );

  if (authUnavailable || (!loggedIn && oidcEnabled))
    return (
      <div role="status" className="p-6">
        {t(authUnavailable ? "identityUnavailable" : "verifyingLogin")}
      </div>
    );

  if (!loggedIn) {
    return (
      <div className="fixed inset-0 z-50">
        <LoginPage onLogin={handleLogin} siteConfig={siteConfig} />
      </div>
    );
  }

  return <>{children}</>;
}
