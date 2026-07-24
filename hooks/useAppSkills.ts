import useSWR from "swr";
import { useTranslations } from "next-intl";
import axios from "@/lib/axios";
import { toast } from "sonner";
import type { AppSkill, Skill } from "@/types/skill";

/** 兼容后端列表包裹形状：数组或 {items}/{skills} */
function unwrapAppSkillList(data: unknown): AppSkill[] {
  if (Array.isArray(data)) return data as AppSkill[];
  const obj = data as { items?: AppSkill[]; skills?: AppSkill[] } | undefined;
  return obj?.items || obj?.skills || [];
}

/** 绑定行展示字段归一化（后端可能平铺 skill_* 或嵌套 skill 摘要） */
export function normalizeAppSkill(row: AppSkill): {
  skillId: number;
  name: string;
  displayName: string;
  description: string;
  isPublished: boolean;
} {
  const skill = (row.skill || {}) as Partial<Skill>;
  const published =
    row.is_published ??
    (row.published_content !== undefined
      ? row.published_content !== null
      : skill.published_content !== undefined
        ? skill.published_content !== null
        : false);
  return {
    skillId: row.skill_id ?? (skill.id as number),
    name: row.skill_name || skill.name || "",
    displayName: row.display_name || row.skill_display_name || skill.display_name || row.skill_name || skill.name || "",
    description: row.description || skill.description || "",
    isPublished: published,
  };
}

const fetcher = async (url: string) => {
  const response = await axios.get(url);
  return response.data;
};

// 应用-Skill 绑定（形状照抄 useAppTools）
export const useAppSkills = (appId: number | null) => {
  const t = useTranslations("skills");
  const url = appId ? `/api/v1/apps/${appId}/skills` : null;

  const { data, error, isLoading, mutate } = useSWR(url, fetcher, {
    revalidateOnFocus: false,
    revalidateOnReconnect: true,
    dedupingInterval: 3000,
  });

  // 绑定 skill（POST 体 {skill_id, priority?}；响应可能带注入 token 估算）
  const bindSkill = async (skillId: number, priority?: number) => {
    if (!appId) return null;
    try {
      const res = await axios.post(`/api/v1/apps/${appId}/skills`, {
        skill_id: skillId,
        ...(priority !== undefined ? { priority } : {}),
      });
      toast.success(t("bindSuccess"));
      mutate();
      return res.data;
    } catch (error: any) {
      console.error("Bind skill error:", error);
      return null;
    }
  };

  // 调整绑定优先级
  const updatePriority = async (skillId: number, priority: number) => {
    if (!appId) return false;
    try {
      await axios.put(`/api/v1/apps/${appId}/skills/${skillId}`, { priority });
      toast.success(t("prioritySaved"));
      mutate();
      return true;
    } catch (error: any) {
      console.error("Update skill priority error:", error);
      return false;
    }
  };

  // 解绑
  const unbindSkill = async (skillId: number) => {
    if (!appId) return false;
    try {
      await axios.delete(`/api/v1/apps/${appId}/skills/${skillId}`);
      toast.success(t("unbindSuccess"));
      mutate();
      return true;
    } catch (error: any) {
      console.error("Unbind skill error:", error);
      return false;
    }
  };

  return {
    appSkills: unwrapAppSkillList(data),
    loading: isLoading,
    error,
    bindSkill,
    updatePriority,
    unbindSkill,
    refresh: mutate,
  };
};
