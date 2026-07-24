import useSWR from "swr";
import { useTranslations } from "next-intl";
import axios from "@/lib/axios";
import { toast } from "sonner";
import type { Skill, SkillRequires, SkillVisibility } from "@/types/skill";
import type { SkillDiff } from "@/types/review";

export interface SkillPayload {
  name: string;
  display_name: string;
  description: string;
  content: string;
  requires: SkillRequires;
  visibility: SkillVisibility;
  is_active?: boolean;
}

/** 后端列表形状兼容：数组或 {items}/{skills} 包裹 */
function unwrapSkillList(data: unknown): Skill[] {
  if (Array.isArray(data)) return data as Skill[];
  const obj = data as { items?: Skill[]; skills?: Skill[] } | undefined;
  return obj?.items || obj?.skills || [];
}

const fetcher = async (url: string) => {
  const response = await axios.get(url);
  return response.data;
};

// Skill 全局 CRUD（形状照 useAppTools）
export const useSkills = (query?: string) => {
  const t = useTranslations("skills");
  const url = `/api/v1/skills${query ? `?q=${encodeURIComponent(query)}` : ""}`;

  const { data, error, isLoading, mutate } = useSWR(url, fetcher, {
    revalidateOnFocus: false,
    revalidateOnReconnect: true,
    dedupingInterval: 3000,
  });

  const createSkill = async (payload: SkillPayload): Promise<Skill | null> => {
    try {
      const res = await axios.post("/api/v1/skills", payload);
      toast.success(t("createSuccess"));
      mutate();
      return res.data;
    } catch (error: any) {
      console.error("Create skill error:", error);
      return null;
    }
  };

  const deleteSkill = async (
    skillId: number,
    force = false
  ): Promise<{ ok: boolean; referencedBy?: any[] }> => {
    try {
      await axios.delete(`/api/v1/skills/${skillId}${force ? "?force=true" : ""}`, {
        // 409（被应用引用）由调用方弹引用清单，不走全局错误 toast
        suppressErrorToast: true,
      } as any);
      toast.success(t("deleteSuccess"));
      mutate();
      return { ok: true };
    } catch (error: any) {
      if (error.response?.status === 409) {
        const detail = error.response.data?.detail;
        const referencedBy = Array.isArray(detail) ? detail : detail?.apps || detail?.referenced_by;
        return { ok: false, referencedBy: Array.isArray(referencedBy) ? referencedBy : [] };
      }
      console.error("Delete skill error:", error);
      toast.error(t("deleteFailed"));
      return { ok: false };
    }
  };

  return {
    skills: unwrapSkillList(data),
    loading: isLoading,
    error,
    createSkill,
    deleteSkill,
    refresh: mutate,
  };
};

// 单个 Skill 详情 + 草稿保存 / 发布
export const useSkill = (skillId: number | null) => {
  const t = useTranslations("skills");
  const url = skillId ? `/api/v1/skills/${skillId}` : null;

  const { data, error, isLoading, mutate } = useSWR<Skill>(url, fetcher, {
    revalidateOnFocus: false,
  });

  const saveDraft = async (payload: SkillPayload): Promise<Skill | null> => {
    if (!skillId) return null;
    try {
      const res = await axios.put(`/api/v1/skills/${skillId}`, payload);
      toast.success(t("draftSaved"));
      mutate();
      return res.data;
    } catch (error: any) {
      console.error("Save skill draft error:", error);
      return null;
    }
  };

  const publish = async (): Promise<boolean> => {
    if (!skillId) return false;
    try {
      await axios.post(`/api/v1/skills/${skillId}/publish`);
      toast.success(t("publishSuccess"));
      mutate();
      return true;
    } catch (error: any) {
      console.error("Publish skill error:", error);
      return false;
    }
  };

  // 普通用户：提交审核（draft/rejected → pending_review）
  const submitReview = async (): Promise<boolean> => {
    if (!skillId) return false;
    try {
      await axios.post(`/api/v1/skills/${skillId}/submit-review`);
      toast.success(t("submitReviewSuccess"));
      mutate();
      return true;
    } catch (error: any) {
      console.error("Submit skill review error:", error);
      return false;
    }
  };

  // 草稿 vs 已发布对照
  const fetchDiff = async (): Promise<SkillDiff | null> => {
    if (!skillId) return null;
    try {
      const res = await axios.get(`/api/v1/skills/${skillId}/diff`);
      const data = res.data as Partial<SkillDiff> | undefined;
      return { draft: data?.draft ?? "", published: data?.published ?? null };
    } catch (error: any) {
      console.error("Fetch skill diff error:", error);
      return null;
    }
  };

  const exportMarkdown = async (): Promise<string | null> => {
    if (!skillId) return null;
    try {
      const res = await axios.get(`/api/v1/skills/${skillId}/export`, {
        responseType: "text",
        transformResponse: [(data) => data],
      });
      return res.data as string;
    } catch (error: any) {
      console.error("Export skill error:", error);
      return null;
    }
  };

  return {
    skill: data,
    loading: isLoading,
    error,
    saveDraft,
    publish,
    submitReview,
    fetchDiff,
    exportMarkdown,
    refresh: mutate,
  };
};
