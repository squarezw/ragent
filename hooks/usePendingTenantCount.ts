import useSWR from "swr";
import axios from "@/lib/axios";

export const PENDING_TENANT_COUNT_KEY = "/api/user/pending-tenant-count";

export function usePendingTenantCount(enabled: boolean) {
  const { data, error } = useSWR<{ count: number }>(
    enabled ? PENDING_TENANT_COUNT_KEY : null,
    async (url: string) => {
      const response = await axios.get(url, { suppressErrorToast: true } as any);
      return response.data;
    },
    {
      refreshInterval: 60_000,
      revalidateOnFocus: true,
      revalidateOnReconnect: true,
      shouldRetryOnError: false,
    }
  );
  return { count: enabled ? (data?.count ?? 0) : 0, error };
}
