import { useEffect, useState } from "react";
import axios from "@/lib/axios";

/** 内置工具（原生名册 + 网关）的一条只读记录。 */
export interface BuiltinTool {
  name: string;
  /** roster = 一个实例一条判据；gateway = 子能力每请求重烫，门在 resolver 里 */
  kind: "roster" | "gateway";
  /** 授权判据的人话说法，如"仅超级管理员" */
  authorization: string;
  /** 这条判据的依据 */
  why: string;
  /** 被 NATIVE_TOOLS_DISABLED 关掉了 */
  disabled_by_env: boolean;
}

interface BuiltinToolsResponse {
  items: BuiltinTool[];
  total: number;
  env_switch: string;
  note: string;
}

/**
 * 内置工具清单。**只读**——这些工具随代码发布，不在 `tools` 表里，授权判据写在代码中。
 *
 * `enabled` 为 false 时不发请求：这是个仅超级管理员可读的端点，普通用户进页面时不该产生
 * 一串 403。权限判定在服务端，这里只是别去敲一扇明知敲不开的门。
 */
export function useBuiltinTools(enabled: boolean) {
  const [builtins, setBuiltins] = useState<BuiltinTool[]>([]);
  const [meta, setMeta] = useState<{ env_switch: string; note: string } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    axios
      .get<BuiltinToolsResponse>("/api/tools/builtin")
      .then((res) => {
        if (cancelled) return;
        setBuiltins(res.data.items || []);
        setMeta({ env_switch: res.data.env_switch, note: res.data.note });
      })
      .catch((err) => {
        const e = err as { response?: { data?: { error?: string } }; message?: string };
        if (cancelled) return;
        // 清空而不是保留上一次的结果：403 之后还留着清单，等于把上一个身份看到的东西
        // 继续显示（SWR 缓存熬过登出那类问题的同一形状）。
        setBuiltins([]);
        setMeta(null);
        setError(e?.response?.data?.error || e?.message || "加载失败");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [enabled]);

  return { builtins, meta, loading, error };
}
