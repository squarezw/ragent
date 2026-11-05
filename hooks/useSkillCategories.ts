import useSWR from "swr";
import { useLocale } from "next-intl";
import axios from "@/lib/axios";

export interface SkillCategory {
  key: string;
  label: Record<string, string>;
}

interface Catalog {
  categories: SkillCategory[];
  fallback: string;
}

/** Categories come from the backend's packaged config/skill_categories.yaml. */
export function useSkillCategories() {
  const locale = useLocale();
  const { data, isLoading } = useSWR<Catalog>(
    "/api/v1/skills/categories",
    async (url: string) => (await axios.get(url)).data,
    { revalidateOnFocus: false }
  );
  const labelOf = (key: string) => {
    const label = data?.categories.find((c) => c.key === key)?.label;
    if (!label) return key;
    return label[locale] || label["zh-CN"] || Object.values(label)[0] || key;
  };
  return {
    categories: data?.categories ?? [],
    fallback: data?.fallback ?? "",
    labelOf,
    loading: isLoading,
  };
}
