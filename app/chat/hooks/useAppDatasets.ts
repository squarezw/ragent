import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import axios from "@/lib/axios";

interface App {
  id: number;
  name: string;
  description: string;
  dataset_ids: string[];
  is_default?: boolean;
}

interface Dataset {
  id: string;
  name: string;
}

export function useAppDatasets() {
  const [apps, setApps] = useState<App[]>([]);
  const [appsLoading, setAppsLoading] = useState(false);
  const [allDatasets, setAllDatasets] = useState<Dataset[]>([]);
  const [selectedAppId, setSelectedAppId] = useState<string>(() => {
    if (typeof window !== "undefined") {
      return localStorage.getItem("ragent_selected_app_id") || "";
    }
    return "";
  });
  const [selectedDatasetIds, setSelectedDatasetIds] = useState<string[]>([]);
  const [appDatasetIds, setAppDatasetIds] = useState<string[]>([]);
  const [optionalDatasetSelections, setOptionalDatasetSelections] = useState<Set<string>>(() => {
    if (typeof window !== "undefined") {
      try {
        const saved = localStorage.getItem("ragent_optional_dataset_ids");
        return new Set(saved ? JSON.parse(saved) : []);
      } catch {
        return new Set();
      }
    }
    return new Set();
  });

  const hasInitializedAppRef = useRef(false);
  const previousAppIdRef = useRef<string>(selectedAppId);

  // Load apps
  useEffect(() => {
    const loadApps = async () => {
      try {
        setAppsLoading(true);
        const response = await axios.get("/api/apps/simple");
        setApps(response.data.items || []);
      } catch (error) {
        console.error("Load apps failed:", error);
        setApps([]);
      } finally {
        setAppsLoading(false);
      }
    };
    loadApps();
  }, []);

  // Load all datasets
  useEffect(() => {
    const loadDatasets = async () => {
      try {
        const response = await axios.get("/api/datasets");
        setAllDatasets(response.data || []);
      } catch (error) {
        console.error("Load datasets failed:", error);
      }
    };
    loadDatasets();
  }, []);

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

  // Initialize default app if no initial selection
  useEffect(() => {
    if (hasInitializedAppRef.current) return;
    if (apps.length === 0) return;

    const initialAppId = localStorage.getItem("ragent_selected_app_id") || "";

    if (initialAppId) {
      const appExists = apps.some((app) => app.id.toString() === initialAppId);
      if (appExists) {
        hasInitializedAppRef.current = true;
        setSelectedAppId(initialAppId);
        previousAppIdRef.current = initialAppId;
      }
    } else {
      const defaultApp = apps.find((app) => app.is_default === true);
      if (defaultApp) {
        hasInitializedAppRef.current = true;
        const defaultAppId = defaultApp.id.toString();
        setSelectedAppId(defaultAppId);
        previousAppIdRef.current = defaultAppId;
        localStorage.setItem("ragent_selected_app_id", defaultAppId);
      } else {
        hasInitializedAppRef.current = true;
      }
    }
  }, [apps]);

  // Save optional dataset selections to localStorage
  useEffect(() => {
    if (typeof window !== "undefined") {
      const optionalArray = Array.from(optionalDatasetSelections);
      localStorage.setItem("ragent_optional_dataset_ids", JSON.stringify(optionalArray));
    }
  }, [optionalDatasetSelections]);

  // Save selected app to localStorage
  useEffect(() => {
    if (typeof window !== "undefined") {
      if (selectedAppId) {
        localStorage.setItem("ragent_selected_app_id", selectedAppId);
      } else {
        localStorage.removeItem("ragent_selected_app_id");
      }
    }
  }, [selectedAppId]);

  // Handle app selection
  const handleAppSelect = useCallback((appId: string) => {
    const previousAppId = previousAppIdRef.current;

    if (appId !== previousAppId && appId !== "") {
      setOptionalDatasetSelections(new Set());
    }

    previousAppIdRef.current = appId;
    setSelectedAppId(appId);
  }, []);

  // Handle dataset toggle
  const handleDatasetToggle = useCallback((datasetId: string) => {
    setOptionalDatasetSelections((prev) => {
      const newSet = new Set(prev);
      if (newSet.has(datasetId)) {
        newSet.delete(datasetId);
      } else {
        newSet.add(datasetId);
      }
      return newSet;
    });
  }, []);

  return {
    apps,
    appsLoading,
    selectedAppId,
    selectedDatasetIds,
    appDatasets,
    appDatasetIds,
    optionalDatasetSelections,
    handleAppSelect,
    handleDatasetToggle,
  };
}
