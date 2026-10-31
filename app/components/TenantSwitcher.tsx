"use client";
import { useState } from "react";
import { useTranslations } from "next-intl";
import { Building2, Check } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { workspaceBusy, workspaceHasUnsavedChanges } from "@/lib/workspaceBrowser";
import { useWorkspace } from "./WorkspaceProvider";

export default function TenantSwitcher() {
  const t = useTranslations("navigation");
  const { enabled, ready, tenant, tenants, isSuperAdmin, selectTenant } = useWorkspace();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  if (!enabled || !ready) return null;
  const name = tenant?.name || t("workspaceSelect");
  if (!isSuperAdmin) return <span className="text-sm text-muted-foreground">{tenant?.name || t("workspaceTenantUnavailableShort")}</span>;
  const filtered = tenants.filter((item) =>
    `${item.name} ${item.code || ""}`.toLocaleLowerCase().includes(search.toLocaleLowerCase())
  );
  return (
    <>
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        <Building2 className="mr-2 h-4 w-4" />
        {name}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg" data-workspace-switcher="true">
          <DialogHeader>
            <DialogTitle>{t("workspaceSelect")}</DialogTitle>
            <DialogDescription>{t("workspaceDescription")}</DialogDescription>
          </DialogHeader>
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder={t("workspaceSearch")}
          />
          <div className="max-h-80 overflow-y-auto space-y-1">
            {filtered.map((item) => (
              <Button
                key={item.id}
                variant={tenant?.id === item.id ? "secondary" : "ghost"}
                className="w-full justify-between h-auto py-3"
                onClick={() => {
                  if (item.id === tenant?.id) {
                    setOpen(false);
                    return;
                  }
                  if (workspaceBusy()) {
                    toast.error(t("workspaceBusy"));
                    return;
                  }
                  if (
                    tenant &&
                    workspaceHasUnsavedChanges() &&
                    !window.confirm(t("workspaceConfirm"))
                  )
                    return;
                  if (selectTenant(item)) {
                    setOpen(false);
                    setSearch("");
                  }
                }}
              >
                <span className="text-left">
                  <span className="block">{item.name}</span>
                  <span className="block text-xs text-muted-foreground">{item.code}</span>
                </span>
                {tenant?.id === item.id && <Check className="h-4 w-4" />}
              </Button>
            ))}
            {!filtered.length && (
              <p className="p-4 text-sm text-muted-foreground">{t("workspaceEmpty")}</p>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
