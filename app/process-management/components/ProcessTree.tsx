"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { useDebounce } from "use-debounce";
import { ChevronsDownUp, ChevronsUpDown, Search, LayoutGrid, Upload, Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { toast } from "sonner";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { checkSuperAdmin } from "@/lib/clientPermissions";
import type { ProcessNode } from "../types/process";
import ProcessTreeNode from "./ProcessTreeNode";

interface ProcessTreeProps {
  tree: ProcessNode[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onToggle: (id: string) => void;
  searchQuery: string;
  onSearchChange: (q: string) => void;
  onCollapseAll: () => void;
  onExpandAll: () => void;
  onShowArchitecture?: () => void;
  onImport?: () => void;
  onExport?: () => void;
}

export default function ProcessTree({
  tree,
  selectedId,
  onSelect,
  onToggle,
  searchQuery,
  onSearchChange,
  onCollapseAll,
  onExpandAll,
  onShowArchitecture,
  onImport,
  onExport,
}: ProcessTreeProps) {
  const t = useTranslations("processManagement");
  const { user } = useCurrentUser();
  const isSuperAdmin = checkSuperAdmin(user);
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [localQuery, setLocalQuery] = useState(searchQuery);
  const [debouncedQuery] = useDebounce(localQuery, 250);

  useEffect(() => {
    onSearchChange(debouncedQuery);
  }, [debouncedQuery, onSearchChange]);

  const handleToggleCollapse = () => {
    if (isCollapsed) {
      onExpandAll();
    } else {
      onCollapseAll();
    }
    setIsCollapsed(!isCollapsed);
  };

  return (
    <TooltipProvider delayDuration={300}>
    <div className="flex flex-col h-full border-r bg-muted/30">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b">
        <h3 className="text-sm font-semibold text-foreground">{t("tree.title")}</h3>
        <div className="flex items-center gap-0.5">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7"
                onClick={handleToggleCollapse}
              >
                {isCollapsed ? (
                  <ChevronsUpDown className="h-3.5 w-3.5" />
                ) : (
                  <ChevronsDownUp className="h-3.5 w-3.5" />
                )}
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom">
              <p>
                {isCollapsed
                  ? t("tree.collapseAll").replace("折叠", "展开").replace("Collapse", "Expand")
                  : t("tree.collapseAll")}
              </p>
            </TooltipContent>
          </Tooltip>
          {onShowArchitecture && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7"
                  onClick={onShowArchitecture}
                >
                  <LayoutGrid className="h-3.5 w-3.5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom">
                <p>{t("tabs.processArchitecture")}</p>
              </TooltipContent>
            </Tooltip>
          )}
        </div>
      </div>

      {/* Search */}
      <div className="px-3 py-2 border-b">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            value={localQuery}
            onChange={(e) => setLocalQuery(e.target.value)}
            placeholder={t("tree.search")}
            className="pl-8 h-8 text-sm"
          />
        </div>
      </div>

      {/* Tree Content */}
      <div className="flex-1 overflow-y-auto py-1">
        {tree.map((rootNode) => (
          <ProcessTreeNode
            key={rootNode.id}
            node={rootNode}
            selectedId={selectedId}
            onSelect={onSelect}
            onToggle={onToggle}
            depth={0}
            searchQuery={searchQuery}
          />
        ))}
      </div>

      {/* Footer: Import / Export buttons */}
      <div className="px-3 py-2 border-t flex items-center gap-2">
        {isSuperAdmin ? (
          <Button variant="outline" size="sm" className="h-7 text-xs flex-1" onClick={onImport}>
            <Upload className="h-3 w-3 mr-1" />
            {t("export.importArchitecture")}
          </Button>
        ) : (
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="flex-1">
                <Button variant="outline" size="sm" className="h-7 text-xs w-full" disabled>
                  <Upload className="h-3 w-3 mr-1" />
                  {t("export.importArchitecture")}
                </Button>
              </span>
            </TooltipTrigger>
            <TooltipContent side="top">
              <p>{t("export.importRequiresSuperAdmin")}</p>
            </TooltipContent>
          </Tooltip>
        )}
        <Button variant="outline" size="sm" className="h-7 text-xs flex-1" onClick={onExport}>
          <Download className="h-3 w-3 mr-1" />
          {t("export.exportExcel")}
        </Button>
      </div>
    </div>
    </TooltipProvider>
  );
}
