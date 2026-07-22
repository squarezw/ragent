"use client";

import React, { useMemo } from "react";
import { useTranslations } from "next-intl";
import { ChevronDown, Database, Building2, Users, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuTrigger,
  DropdownMenuCheckboxItem,
  DropdownMenuSub,
  DropdownMenuSubTrigger,
  DropdownMenuSubContent,
  DropdownMenuPortal,
} from "@/components/ui/dropdown-menu";

interface DatasetSelectorDropdownProps {
  optionalDatasetSelections: Set<string>;
  selectedDatasetIds: string[];
  onDatasetToggle: (datasetId: string) => void;
  organizedDatasets: any;
  orgLoading: boolean;
  disabled?: boolean;
  // Keep these props for compatibility but don't use them in this dropdown
  apps?: any[];
  appsLoading?: boolean;
  selectedAppId?: string;
  appDatasets?: any[];
  onAppSelect?: (appId: string) => void;
}

export default function DatasetSelectorDropdown({
  optionalDatasetSelections,
  selectedDatasetIds,
  onDatasetToggle,
  organizedDatasets,
  orgLoading,
  disabled,
}: DatasetSelectorDropdownProps) {
  const t = useTranslations("chat");

  // Compute display label
  const displayLabel = useMemo(() => {
    if (selectedDatasetIds.length === 0) {
      return t("selectKnowledgeBase");
    }
    return t("selectedKbCount", { count: selectedDatasetIds.length });
  }, [selectedDatasetIds.length, t]);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          disabled={disabled || orgLoading}
          className="h-8 px-3 text-sm gap-1.5 text-muted-foreground hover:text-foreground"
        >
          {orgLoading ? (
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
          ) : (
            <Database className="w-3.5 h-3.5" />
          )}
          <span className="max-w-[120px] truncate">{displayLabel}</span>
          <ChevronDown className="w-3.5 h-3.5 opacity-50" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-72 max-h-[400px] overflow-y-auto">
        {/* Datasets section by organization */}
        {Object.keys(organizedDatasets || {}).length > 0 ? (
          <>
            <DropdownMenuLabel className="flex items-center gap-2 text-xs">
              <Database className="w-3 h-3" />
              {t("specifyDatasets")}
            </DropdownMenuLabel>

            {Object.entries(organizedDatasets || {}).map(
              ([tenantId, tenantData]: [string, any]) => (
                <DropdownMenuSub key={tenantId}>
                  <DropdownMenuSubTrigger className="pl-2">
                    <Building2 className="w-3.5 h-3.5 mr-2 text-primary" />
                    <span>{tenantData.tenant?.name || "Unknown"}</span>
                  </DropdownMenuSubTrigger>
                  <DropdownMenuPortal>
                    <DropdownMenuSubContent className="max-h-[300px] overflow-y-auto">
                      {/* Tenant-level datasets */}
                      {tenantData.datasets?.map((dataset: any) => (
                        <DropdownMenuCheckboxItem
                          key={dataset.id}
                          checked={optionalDatasetSelections.has(dataset.id)}
                          onCheckedChange={() => onDatasetToggle(dataset.id)}
                        >
                          {dataset.name}
                        </DropdownMenuCheckboxItem>
                      ))}

                      {/* Department submenus */}
                      {Object.entries(tenantData.departments || {}).map(
                        ([deptId, deptData]: [string, any]) => {
                          if (!deptData.datasets?.length) return null;
                          return (
                            <DropdownMenuSub key={deptId}>
                              <DropdownMenuSubTrigger className="pl-2">
                                <Users className="w-3.5 h-3.5 mr-2 text-muted-foreground" />
                                <span>{deptData.department?.name}</span>
                                <span className="ml-auto text-xs text-muted-foreground">
                                  ({deptData.datasets.length})
                                </span>
                              </DropdownMenuSubTrigger>
                              <DropdownMenuPortal>
                                <DropdownMenuSubContent className="max-h-[200px] overflow-y-auto">
                                  {deptData.datasets.map((dataset: any) => (
                                    <DropdownMenuCheckboxItem
                                      key={dataset.id}
                                      checked={optionalDatasetSelections.has(dataset.id)}
                                      onCheckedChange={() => onDatasetToggle(dataset.id)}
                                    >
                                      {dataset.name}
                                    </DropdownMenuCheckboxItem>
                                  ))}
                                </DropdownMenuSubContent>
                              </DropdownMenuPortal>
                            </DropdownMenuSub>
                          );
                        }
                      )}
                    </DropdownMenuSubContent>
                  </DropdownMenuPortal>
                </DropdownMenuSub>
              )
            )}
          </>
        ) : (
          /* Empty state */
          !orgLoading && (
            <div className="px-2 py-3 text-sm text-muted-foreground text-center">
              {t("noKnowledgeBase")}
            </div>
          )
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
