"use client";
import { useEffect, useState } from "react";
import axios from "@/lib/axios";
import { modelCatalogUrl } from "@/lib/tenantModels";
import type { LlmModelOption } from "@/lib/llmModels";

export function useTenantModelCatalog(tenantId?: number | null) {
  const scope = modelCatalogUrl(tenantId);
  const [result, setResult] = useState<{ scope: string; items: LlmModelOption[] }>({
    scope: "",
    items: [],
  });
  useEffect(() => {
    let active = true;
    let generation = 0;
    const load = async () => {
      const current = ++generation;
      try {
        const response = await axios.get(scope);
        if (active && current === generation)
          setResult({ scope, items: response.data?.items || [] });
      } catch {
        if (active && current === generation) setResult({ scope, items: [] });
      }
    };
    void load();
    window.addEventListener("ragent:models-updated", load);
    return () => {
      active = false;
      window.removeEventListener("ragent:models-updated", load);
    };
  }, [scope]);
  return result.scope === scope ? result.items : [];
}
