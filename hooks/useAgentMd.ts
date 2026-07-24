import useSWR from "swr";
import { useTranslations } from "next-intl";
import axios from "@/lib/axios";
import { toast } from "sonner";
import type { AgentMdResponse } from "@/types/skill";

/** PUT 422 的行级错误（后端 detail 含行号信息，形状宽松兼容） */
export interface AgentMdValidationError {
  line?: number;
  message: string;
}

function parseValidationErrors(detail: unknown): AgentMdValidationError[] {
  if (typeof detail === "string") return [{ message: detail }];
  if (Array.isArray(detail)) {
    return detail.map((item: any) => {
      if (typeof item === "string") return { message: item };
      const line =
        typeof item.line === "number"
          ? item.line
          : Array.isArray(item.loc)
            ? item.loc.find((x: unknown) => typeof x === "number")
            : undefined;
      return { line, message: item.message || item.msg || JSON.stringify(item) };
    });
  }
  if (detail && typeof detail === "object") {
    const obj = detail as any;
    if (Array.isArray(obj.errors)) return parseValidationErrors(obj.errors);
    return [{ line: obj.line, message: obj.message || obj.msg || JSON.stringify(obj) }];
  }
  return [{ message: String(detail) }];
}

const fetcher = async (url: string) => {
  const response = await axios.get(url, { suppressErrorToast: true } as any);
  return response.data;
};

// 应用 Agent.md：读取 / 保存（422 行级错误）/ 生成升级 / 回退
export const useAgentMd = (appId: number | null) => {
  const t = useTranslations("skills");
  const url = appId ? `/api/v1/apps/${appId}/agent-md` : null;

  const { data, error, isLoading, mutate } = useSWR<AgentMdResponse>(url, fetcher, {
    revalidateOnFocus: false,
  });

  // 保存全文；校验失败返回行级错误列表（不弹全局 toast）
  const save = async (
    content: string
  ): Promise<{ ok: boolean; errors?: AgentMdValidationError[] }> => {
    if (!appId) return { ok: false };
    try {
      await axios.put(`/api/v1/apps/${appId}/agent-md`, { content }, {
        suppressErrorToast: true,
      } as any);
      toast.success(t("agentMdSaved"));
      mutate();
      return { ok: true };
    } catch (error: any) {
      if (error.response?.status === 422) {
        return { ok: false, errors: parseValidationErrors(error.response.data?.detail) };
      }
      console.error("Save agent.md error:", error);
      toast.error(error.response?.data?.detail || t("agentMdSaveFailed"));
      return { ok: false };
    }
  };

  // 从 prompt 生成（升级）；已有 agent_md 时后端 409，可 overwrite
  const generate = async (overwrite = false): Promise<boolean> => {
    if (!appId) return false;
    try {
      await axios.post(
        `/api/v1/apps/${appId}/agent-md/generate${overwrite ? "?overwrite=true" : ""}`,
        {},
        { suppressErrorToast: true } as any
      );
      toast.success(t("upgradeSuccess"));
      mutate();
      return true;
    } catch (error: any) {
      if (error.response?.status === 409) {
        // 已有 agent_md：刷新即可拿到现状
        toast.info(t("agentMdAlreadyExists"));
        mutate();
        return true;
      }
      console.error("Generate agent.md error:", error);
      toast.error(error.response?.data?.detail || t("upgradeFailed"));
      return false;
    }
  };

  // 回退到提示词模式（DELETE 置 NULL）
  const remove = async (): Promise<boolean> => {
    if (!appId) return false;
    try {
      await axios.delete(`/api/v1/apps/${appId}/agent-md`);
      toast.success(t("revertSuccess"));
      mutate();
      return true;
    } catch (error: any) {
      console.error("Delete agent.md error:", error);
      return false;
    }
  };

  // 导出视图（?export=true 合成只读版）
  const fetchExport = async (): Promise<AgentMdResponse | null> => {
    if (!appId) return null;
    try {
      const res = await axios.get(`/api/v1/apps/${appId}/agent-md?export=true`);
      return res.data;
    } catch (error: any) {
      console.error("Export agent.md error:", error);
      return null;
    }
  };

  return {
    agentMd: data,
    loading: isLoading,
    error,
    save,
    generate,
    remove,
    fetchExport,
    refresh: mutate,
  };
};
