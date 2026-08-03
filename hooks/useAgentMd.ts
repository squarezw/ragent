import useSWR from "swr";
import { useTranslations } from "next-intl";
import axios from "@/lib/axios";
import { toast } from "sonner";
import { parseAgentMdSaveResult } from "@/lib/agentMd";
import type { AgentMdResponse } from "@/types/skill";

/** PUT 422 的行级错误（后端 detail 含行号信息，形状宽松兼容） */
export interface AgentMdValidationError {
  line?: number;
  message: string;
}

export interface AgentMdSaveOutcome {
  ok: boolean;
  errors?: AgentMdValidationError[];
  /** 保存成功但有非阻断提示（如 frontmatter model 被剥离） */
  warnings?: string[];
  /** 入库后的归一化全文；null = 后端没回传，保留编辑器现有内容 */
  normalizedContent?: string | null;
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
  // 成功时响应的 content 是归一化后的全文（后端会剥掉 frontmatter 的 model），
  // 直接把它写进 SWR 缓存，编辑器回填的就是库里真正存的内容
  const save = async (content: string): Promise<AgentMdSaveOutcome> => {
    if (!appId) return { ok: false };
    try {
      const response = await axios.put(`/api/v1/apps/${appId}/agent-md`, { content }, {
        suppressErrorToast: true,
      } as any);
      const saved = parseAgentMdSaveResult(response.data);
      toast.success(t("agentMdSaved"));
      mutate(response.data as AgentMdResponse, { revalidate: false });
      return { ok: true, warnings: saved.warnings, normalizedContent: saved.normalizedContent };
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
    fetchExport,
    refresh: mutate,
  };
};
