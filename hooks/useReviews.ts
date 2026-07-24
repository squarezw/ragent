import useSWR from "swr";
import { useTranslations } from "next-intl";
import axios from "@/lib/axios";
import { toast } from "sonner";
import type { PendingReviews, ReviewPayload } from "@/types/review";

/** 后端响应容错解包（后端并行开发中，字段可能缺失） */
function unwrapPendingReviews(data: unknown): PendingReviews {
  const obj = (data ?? {}) as Partial<PendingReviews>;
  const skills = Array.isArray(obj.skills) ? obj.skills : [];
  const apps = Array.isArray(obj.apps) ? obj.apps : [];
  const total = typeof obj.total === "number" ? obj.total : skills.length + apps.length;
  return { skills, apps, total };
}

const fetcher = async (url: string) => {
  const response = await axios.get(url, { suppressErrorToast: true } as any);
  return response.data;
};

/**
 * 待审队列（GET /api/v1/reviews/pending，60s 轮询）。
 * enabled=false（无审核权）时不发请求。
 */
export const usePendingReviews = (enabled: boolean) => {
  const t = useTranslations("reviews");
  const { data, error, isLoading, mutate } = useSWR(
    enabled ? "/api/v1/reviews/pending" : null,
    fetcher,
    {
      refreshInterval: 60_000,
      revalidateOnFocus: false,
      revalidateOnReconnect: true,
      // 后端端点尚未就绪时不要无限重试刷 error toast
      shouldRetryOnError: false,
    }
  );

  // POST /api/v1/{skills|apps}/{id}/review
  const review = async (
    kind: "skills" | "apps",
    id: number,
    payload: ReviewPayload
  ): Promise<boolean> => {
    try {
      await axios.post(`/api/v1/${kind}/${id}/review`, payload);
      toast.success(payload.approve ? t("approveSuccess") : t("rejectSuccess"));
      mutate();
      return true;
    } catch (error: any) {
      console.error(`Review ${kind}/${id} error:`, error);
      return false;
    }
  };

  return {
    pending: unwrapPendingReviews(data),
    loading: isLoading,
    error,
    review,
    refresh: mutate,
  };
};

/** 仅取待审总数（导航徽标用，权限不足时传 enabled=false） */
export const usePendingReviewCount = (enabled: boolean): number => {
  const { data } = useSWR(enabled ? "/api/v1/reviews/pending" : null, fetcher, {
    refreshInterval: 60_000,
    revalidateOnFocus: false,
    shouldRetryOnError: false,
  });
  return unwrapPendingReviews(data).total;
};
