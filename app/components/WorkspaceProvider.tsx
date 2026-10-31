"use client";
import { createContext, useContext, useLayoutEffect, useState } from "react";
import { SWRConfig } from "swr";
import axios from "@/lib/axios";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { checkSuperAdmin } from "@/lib/clientPermissions";
import {
  installWorkspaceFetch,
  setWorkspaceOperation,
  workspaceBusy,
} from "@/lib/workspaceBrowser";

export interface WorkspaceTenant {
  id: number;
  name: string;
  code?: string;
  company_code?: string | null;
}
interface Workspace {
  enabled: boolean;
  ready: boolean;
  tenant: WorkspaceTenant | null;
  tenants: WorkspaceTenant[];
  isSuperAdmin: boolean;
  selectTenant: (tenant: WorkspaceTenant) => boolean;
}
const Context = createContext<Workspace>({
  enabled: false,
  ready: true,
  tenant: null,
  tenants: [],
  isSuperAdmin: false,
  selectTenant: () => false,
});
export function useWorkspace() {
  return useContext(Context);
}
export function WorkspaceProvider({ children }: { children: React.ReactNode }) {
  const { user, loading } = useCurrentUser();
  const [tenant, setTenant] = useState<WorkspaceTenant | null>(null);
  const [tenants, setTenants] = useState<WorkspaceTenant[]>([]);
  const [ready, setReady] = useState(false);
  const [readyFor, setReadyFor] = useState("");
  const enabled = user?.workspace_enabled === true;
  const isSuperAdmin = checkSuperAdmin(user);
  const key = `ragent:workspace:${user?.id}`;
  const identity = `${user?.id}:${user?.tenant_id}:${user?.dept_id}:${user?.status}:${enabled}:${isSuperAdmin}:${JSON.stringify(user?.roles || [])}`;
  const effectiveReady = !loading && ready && readyFor === identity;
  useLayoutEffect(() => {
    let active = true;
    setReady(false);
    setWorkspaceOperation(enabled, user?.id || null, null);
    setTenant(null);
    setTenants([]);
    if (loading) return;
    installWorkspaceFetch();
    if (!enabled || !user) {
      setWorkspaceOperation(false, user?.id || null, null);
      setTenant(null);
      setReadyFor(identity);
      setReady(true);
      return;
    }
    axios
      .get("/api/workspace/context")
      .then(({ data }) => {
        if (!active) return;
        const available: WorkspaceTenant[] = data.tenants || [];
        setTenants(available);
        const stored = sessionStorage.getItem(key);
        const selected = isSuperAdmin
          ? available.find((t) => String(t.id) === stored)
          : available.find((t) => t.id === Number(user.tenant_id));
        setWorkspaceOperation(true, user.id, selected?.id || null);
        setTenant(selected || null);
        setReadyFor(identity);
        setReady(true);
      })
      .catch(() => {
        if (!active) return;
        setWorkspaceOperation(true, user.id, null);
        setTenant(null);
        setTenants([]);
        setReadyFor(identity);
        setReady(true);
      });
    return () => {
      active = false;
    };
  }, [enabled, loading, user?.id, user?.tenant_id, isSuperAdmin, key, identity]);
  const selectTenant = (next: WorkspaceTenant) => {
    if (!isSuperAdmin || workspaceBusy() || !tenants.some((t) => t.id === next.id)) return false;
    setWorkspaceOperation(true, user.id, next.id);
    sessionStorage.setItem(key, String(next.id));
    setTenant(next);
    return true;
  };
  return (
    <Context.Provider
      value={{
        enabled,
        ready: effectiveReady,
        tenant: effectiveReady ? tenant : null,
        tenants: effectiveReady ? tenants : [],
        isSuperAdmin,
        selectTenant,
      }}
    >
      <SWRConfig
        key={`${user?.id}:${enabled ? tenant?.id || "none" : "legacy"}`}
        value={{ provider: () => new Map() }}
      >
        {children}
      </SWRConfig>
    </Context.Provider>
  );
}
