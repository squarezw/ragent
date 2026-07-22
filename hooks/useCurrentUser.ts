"use client";

import { clearChatSelectionCache } from "@/lib/authUtils";
import axios from "@/lib/axios";
import React, { createContext, useContext, useEffect, useState } from "react";

// 全局用户状态
let globalUser: any = null;
let globalLoading = true;
let globalUserPromise: Promise<any> | null = null;
let globalUserInitialized = false; // 标记是否已经初始化过

// 创建 Context
const UserContext = createContext<{
  user: any;
  loading: boolean;
  logout: () => void;
  refetch: () => Promise<void>;
} | null>(null);

// 获取用户的函数
const fetchUserData = async () => {
  const token = typeof window !== "undefined" ? localStorage.getItem("ragent_token") : null;
  if (!token) {
    globalUser = null;
    globalLoading = false;
    return null;
  }

  try {
    const res = await axios.get("/api/user/me");
    globalUser = res.data;
    return res.data;
  } catch (error) {
    globalUser = null;
    throw error;
  } finally {
    globalLoading = false;
  }
};

// 全局获取用户函数（带缓存）
const getCurrentUser = async () => {
  // 如果已经有用户数据且不在加载中，直接返回
  if (globalUser && !globalLoading) {
    return globalUser;
  }

  // 如果正在加载中，等待现有的请求
  if (globalUserPromise) {
    try {
      return await globalUserPromise;
    } catch (error) {
      // 如果请求失败，清除缓存并重新请求
      globalUserPromise = null;
      globalUser = null;
      globalLoading = true;
    }
  }

  // 创建新的请求
  globalUserPromise = fetchUserData();
  try {
    const user = await globalUserPromise;
    globalUserPromise = null;
    globalUserInitialized = true;
    return user;
  } catch (error) {
    globalUserPromise = null;
    throw error;
  }
};

// Provider 组件
export function UserProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<any>(globalUser);
  const [loading, setLoading] = useState(globalLoading);

  const fetchUser = async () => {
    try {
      setLoading(true);
      const userData = await getCurrentUser();
      setUser(userData);
    } catch (error) {
      setUser(null);
    } finally {
      setLoading(false);
    }
  };

  const logout = () => {
    localStorage.removeItem("ragent_token");
    localStorage.removeItem("ragent_logged_in");

    clearChatSelectionCache();
    globalUser = null;
    globalLoading = false;
    globalUserPromise = null;
    globalUserInitialized = false;
    setUser(null);
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
