"use client";

import { registerAuthenticatedSession, setLogoutPending } from "@/lib/browserAuthMode";

import { clearChatSelectionCache, clearSwrCache } from "@/lib/authUtils";
import axios from "@/lib/axios";
import { toast } from "sonner";
import { useTranslations } from "next-intl";
import React, { createContext, useContext, useEffect, useState } from "react";

// 全局用户状态
let globalUser: any = null;
let globalLoading = true;
let globalUserPromise: Promise<any> | null = null;
let sessionGeneration = 0;
let logoutInProgress = false;
let locallySignedOut = false;
let globalUserInitialized = false; // 标记是否已经初始化过

// 创建 Context
const UserContext = createContext<{
  user: any;
  loading: boolean;
  logout: () => Promise<void>;
  refetch: () => Promise<void>;
} | null>(null);

// 获取用户的函数
const getCurrentUser = async () => {
  if (logoutInProgress || locallySignedOut) throw new Error("Session changed");
  if (globalUser && !globalLoading) return globalUser;
  if (globalUserPromise) return globalUserPromise;
  const generation = sessionGeneration;
  const pending = axios.get("/api/user/me").then((res) => {
    if (generation !== sessionGeneration || logoutInProgress || locallySignedOut)
      throw new Error("Session changed");
    globalUser = res.data;
    registerAuthenticatedSession(res.data);
    globalUserInitialized = true;
    return res.data;
  });
  globalUserPromise = pending;
  try {
    return await pending;
  } catch (error) {
    if (generation === sessionGeneration) globalUser = null;
    throw error;
  } finally {
    if (generation === sessionGeneration) {
      globalLoading = false;
      if (globalUserPromise === pending) globalUserPromise = null;
    }
  }
};

// Provider 组件
export function UserProvider({ children }: { children: React.ReactNode }) {
  const t = useTranslations("login");
  const [user, setUser] = useState<any>(globalUser);
  const [loading, setLoading] = useState(globalLoading);

  const fetchUser = async () => {
    const generation = sessionGeneration;
    try {
      setLoading(true);
      const userData = await getCurrentUser();
      if (generation === sessionGeneration && !logoutInProgress && !locallySignedOut) setUser(userData);
    } catch (error) {
      if (generation === sessionGeneration) setUser(null);
    } finally {
      if (generation === sessionGeneration) setLoading(false);
    }
  };

  const logout = async () => {
    if (logoutInProgress) return;
    logoutInProgress = true;
    setLogoutPending(true);
    ++sessionGeneration;
    window.dispatchEvent(new CustomEvent("auth:logout-start"));
    globalUserPromise = null;
    try {
      const response = await fetch("/api/auth/logout", { method: "POST", credentials: "same-origin" });
      if (!response.ok) throw new Error("Logout failed");
      locallySignedOut = true;
      localStorage.removeItem("ragent_token");
      localStorage.removeItem("ragent_logged_in");
      clearChatSelectionCache();
      clearSwrCache();
      globalUser = null;
      globalLoading = false;
      globalUserInitialized = false;
      setUser(null);
      window.location.assign("/?signedOut=1");
    } catch {
      logoutInProgress = false;
      setLogoutPending(false);
      window.dispatchEvent(new CustomEvent("auth:logout-failed"));
      toast.error(t("identityUnavailable"));
    } finally {
      // Keep auto-SSO paused until successful hard navigation actually unloads this document.
      if (!locallySignedOut) {
        logoutInProgress = false;
        setLogoutPending(false);
      }
    }
  };

  const refetch = async () => {
    // 清除缓存，强制重新获取
    globalUser = null;
    globalLoading = true;
    globalUserPromise = null;
    globalUserInitialized = false;
    await fetchUser();
  };

  useEffect(() => {
    const restored = (event: Event) => {
      const next = (event as CustomEvent).detail?.user;
      if (!logoutInProgress && !locallySignedOut && next?.id === globalUser?.id) {
        globalUser = next;
        setUser(next);
      }
    };
    window.addEventListener("auth:session-restored", restored);
    return () => window.removeEventListener("auth:session-restored", restored);
  }, []);

  useEffect(() => {
    // 只有在没有初始化过且没有用户数据时才获取
    if (!globalUserInitialized && !globalUser && globalLoading) {
      fetchUser();
    } else {
      // 如果已经有数据，直接设置状态
      setUser(globalUser);
      setLoading(false);
    }
  }, []);

  return React.createElement(
    UserContext.Provider,
    { value: { user, loading, logout, refetch } },
    children
  );
}

// Hook 组件
export function useCurrentUser() {
  const context = useContext(UserContext);
  if (!context) {
    throw new Error("useCurrentUser must be used within a UserProvider");
  }
  return context;
}

// 导出全局获取用户函数（供 AuthGate 使用）
export { getCurrentUser };
