import useSWR, { useSWRConfig } from "swr";
import { useTranslations } from "next-intl";
import axios from "@/lib/axios";
import { toast } from "sonner";
import { useInvalidateAppSkillDiagnostics } from "@/hooks/useAppSkillDiagnostics";
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
  const invalidateDiagnostics = useInvalidateAppSkillDiagnostics();
  const { mutate: mutateKey } = useSWRConfig();
  const url = appId ? `/api/v1/apps/${appId}/skills` : null;

  const { data, error, isLoading, mutate } = useSWR(url, fetcher, {
    revalidateOnFocus: false,
    revalidateOnReconnect: true,
    dedupingInterval: 3000,
  });

  // 绑定 skill（POST 体 {skill_id}；响应可能带注入 token 估算）
  const bindSkill = async (skillId: number) => {
    if (!appId) return null;
    try {
      const res = await axios.post(`/api/v1/apps/${appId}/skills`, {
        skill_id: skillId,
      });

      // 后端会把 skill 声明的 requires.tools 自动补绑到这个应用上（否则整份 skill
      // 静默不注入）。这是平台替用户做的**授权动作**，必须说出来 —— 悄悄多给一个
      // 工具，比让用户自己去补更糟。
      const autoBound: string[] = res.data?.data?.auto_bound_tools ?? [];
      const warnings: string[] = res.data?.data?.warnings ?? [];

      if (autoBound.length > 0) {
        toast.success(t("bindSuccessWithTools", { tools: autoBound.join("、") }));
        // 工具区是另一个 hook（useAppTools，key 前缀不同），不失效它的话用户会看到
        // 一个"工具数没变"的界面，然后以为自动绑定没生效
        mutateKey((key) => typeof key === "string" && key.includes(`/apps/${appId}/tools`));
      } else {
        toast.success(t("bindSuccess"));
      }
      // 警告分开提示：它们说的是"这份 skill 现在不会生效"，和成功不是一回事
      warnings.forEach((w) => toast.warning(w));

      mutate();
      invalidateDiagnostics(appId);
      return res.data;
    } catch (error: any) {
      console.error("Bind skill error:", error);
      return null;
    }
  };

  // 解绑
  const unbindSkill = async (skillId: number) => {
    if (!appId) return false;
    try {
      await axios.delete(`/api/v1/apps/${appId}/skills/${skillId}`);
      toast.success(t("unbindSuccess"));
      mutate();
      invalidateDiagnostics(appId);
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
    unbindSkill,
    refresh: mutate,
  };
};
