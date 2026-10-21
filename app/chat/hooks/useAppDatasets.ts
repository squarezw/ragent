import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import axios from "@/lib/axios";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { appSelectionKey, chooseTenantApp } from "@/lib/tenantDefaultApp";

interface App {
  id: number;
  name: string;
  description: string;
  dataset_ids: string[];
  is_default?: boolean;
  owner_tenant_id?: number | null;
  status?: string;
  visibility?: string;
  app_type?: string;
  platform?: string;
}

interface Dataset {
  id: string;
  name: string;
}

const emptyApps: App[] = [];
const emptyDatasets: Dataset[] = [];

export function useAppDatasets() {
  const { user } = useCurrentUser();
  const key = user?.id ? appSelectionKey(user.id, user.tenant_id) : "";
  const optionalKey = key ? `${key}:optional_datasets` : "";
  const [appState, setAppState] = useState<{ key: string; items: App[] }>({ key: "", items: [] });
  const apps = appState.key === key ? appState.items : emptyApps;
  const [appsLoading, setAppsLoading] = useState(false);
  const [datasetState, setDatasetState] = useState<{ key: string; items: Dataset[] }>({
    key: "",
    items: [],
  });
  const allDatasets = datasetState.key === key ? datasetState.items : emptyDatasets;
  const [selection, setSelection] = useState({ key: "", id: "" });
  const selectedAppId = selection.key === key ? selection.id : "";
  const [selectedDatasetIds, setSelectedDatasetIds] = useState<string[]>([]);
  const [appDatasetIds, setAppDatasetIds] = useState<string[]>([]);
  const [optionalState, setOptionalState] = useState<{ key: string; ids: Set<string> }>({
    key: "",
    ids: new Set(),
  });
  const optionalDatasetSelections = useMemo(
    () => (optionalState.key === key ? optionalState.ids : new Set<string>()),
    [optionalState, key]
  );
  const previousAppIdRef = useRef("");

  useEffect(() => {
    let active = true;
    setAppState({ key: "", items: [] });
    setSelection({ key: "", id: "" });
    previousAppIdRef.current = "";
    if (!key) {
      setAppsLoading(false);
      return;
    }
    setAppsLoading(true);
    const load = async () => {
      try {
        const response = await axios.get("/api/apps/simple");
        if (!active) return;
        const items: App[] = response.data.items || [];
        const id = chooseTenantApp(items, localStorage.getItem(key), user?.tenant_id);
        setAppState({ key, items });
        setSelection({ key, id });
        previousAppIdRef.current = id;
        if (id) localStorage.setItem(key, id);
        else localStorage.removeItem(key);
      } catch (error) {
        if (!active) return;
        console.error("Load apps failed:", error);
        setAppState({ key, items: [] });
        setSelection({ key, id: "" });
      } finally {
        if (active) setAppsLoading(false);
      }
    };
    void load();
    return () => {
      active = false;
    };
  }, [key, user?.tenant_id]);

  useEffect(() => {
    let active = true;
    setDatasetState({ key: "", items: [] });
    setOptionalState({ key: "", ids: new Set() });
    if (!key) return;
    const load = async () => {
      try {
        const response = await axios.get("/api/datasets");
        if (!active) return;
        const items: Dataset[] = response.data || [];
        setDatasetState({ key, items });
        let saved: unknown = [];
        try {
          saved = JSON.parse(localStorage.getItem(optionalKey) || "[]");
        } catch {
          /* Ignore corrupt hints. */
        }
        const ids = new Set<string>(
          Array.isArray(saved)
            ? saved.filter((id) => typeof id === "string" && items.some((ds) => ds.id === id))
            : []
        );
        setOptionalState({ key, ids });
      } catch (error) {
        if (active) {
          console.error("Load datasets failed:", error);
          setDatasetState({ key, items: [] });
          setOptionalState({ key, ids: new Set() });
        }
      }
    };
    void load();
    return () => {
      active = false;
    };
  }, [key, optionalKey]);

  // Selected app
  const selectedApp = apps.find((app) => app.id.toString() === selectedAppId);

  // App datasets
  const appDatasets = useMemo(() => {
    if (!selectedApp) return [];
    return selectedApp.dataset_ids
      .map((id) => allDatasets.find((ds) => ds.id === id))
      .filter((ds): ds is Dataset => ds !== undefined);
  }, [selectedApp, allDatasets]);

  // Update app dataset IDs when app changes
  useEffect(() => {
    if (selectedApp && appDatasets.length > 0) {
      setAppDatasetIds(appDatasets.map((ds) => ds.id));
    } else {
      setAppDatasetIds([]);
    }
  }, [selectedApp, appDatasets]);

  // Effective app dataset IDs
  const effectiveAppDatasetIds = useMemo(() => {
    if (optionalDatasetSelections.size > 0) {
      return [];
    }
    return appDatasetIds;
  }, [appDatasetIds, optionalDatasetSelections]);

  // Combined selected dataset IDs
  useEffect(() => {
    const combined = [
      ...new Set([...effectiveAppDatasetIds, ...Array.from(optionalDatasetSelections)]),
    ];
    setSelectedDatasetIds(combined);
  }, [effectiveAppDatasetIds, optionalDatasetSelections]);

  // Selection hints are scoped by user and tenant; the authorized app list is the only source.
  const handleAppSelect = useCallback(
    (appId: string) => {
      if (!key || (appId && !apps.some((app) => String(app.id) === appId))) return;
      if (appId !== previousAppIdRef.current && appId !== "") {
        setOptionalState({ key, ids: new Set() });
        localStorage.setItem(optionalKey, "[]");
      }
      previousAppIdRef.current = appId;
      setSelection({ key, id: appId });
      if (appId) localStorage.setItem(key, appId);
      else localStorage.removeItem(key);
    },
    [key, optionalKey, apps]
  );

  // Handle dataset toggle
  const handleDatasetToggle = useCallback(
    (datasetId: string) => {
      if (!key || !allDatasets.some((ds) => ds.id === datasetId)) return;
      setOptionalState((prev) => {
        const ids = new Set(prev.key === key ? prev.ids : []);
        if (ids.has(datasetId)) ids.delete(datasetId);
        else ids.add(datasetId);
        localStorage.setItem(optionalKey, JSON.stringify([...ids]));
        return { key, ids };
      });
    },
    [key, optionalKey, allDatasets]
  );

  return {
    apps,
    appsLoading,
    selectedAppId,
    selectedDatasetIds: selection.key === key && datasetState.key === key ? selectedDatasetIds : [],
    appDatasets,
    appDatasetIds: selection.key === key && datasetState.key === key ? appDatasetIds : [],
    optionalDatasetSelections,
    handleAppSelect,
    handleDatasetToggle,
  };
}
