import axios from "axios";
import { toast } from "sonner";
import { getApiErrorMessage } from "./apiError";
import { clearChatSelectionCache } from "./authUtils";

const instance = axios.create();

instance.interceptors.request.use((config) => {
  if (typeof window !== "undefined") {
    const token = localStorage.getItem("ragent_token");
    if (token) {
      config.headers = config.headers || {};
      config.headers.Authorization = `Bearer ${token}`;
    }
  }
  return config;
});

// 统一错误 toast
instance.interceptors.response.use(
  (response) => {
    // 对于 blob 响应，直接返回，不进行任何处理
    if (response.config.responseType === "blob") {
      return response;
    }
    return response;
  },
  (error) => {
    // 对于 blob 响应类型的错误，保留原始错误以便前端处理
    if (error.config?.responseType === "blob" && error.response?.data) {
      // blob 错误响应需要特殊处理，让前端代码处理
      return Promise.reject(error);
    }

    if (typeof window !== "undefined") {
      // 处理 401 未授权错误
      if (error.response?.status === 401) {
        // 避免在验证 token 时触发无限循环
        const isTokenValidation = error.config?.url?.includes("/api/user/me");

        // 清除登录状态
        localStorage.removeItem("ragent_token");
        localStorage.removeItem("ragent_logged_in");
        // 清除聊天页面的选择缓存
        clearChatSelectionCache();

        // 只有在非 token 验证请求时才显示提示
        if (!isTokenValidation) {
          // 显示错误提示
          toast.error("登录已过期，请重新登录");

          // 触发自定义事件，让 AuthGate 组件响应
          window.dispatchEvent(new CustomEvent("auth:logout"));
        }

        return Promise.reject(error);
      }

      // 调用方可显式关掉全局错误 toast（自行做友好/本地化提示），避免把后端原始 message 直接弹给用户
      if (error.config?.suppressErrorToast) {
        return Promise.reject(error);
      }

      toast.error(getApiErrorMessage(error));
    }
    return Promise.reject(error);
  }
);

export default instance;
