"use client";

import { useCallback, useState } from "react";
import { AxiosError } from "axios";
import { toast } from "sonner";
import { useTranslations } from "next-intl";
import { useProcessData } from "../hooks/useProcessData";
import { exportProcessTree } from "../services/api";
import { getErrorMessage } from "../lib/error-message";
import ProcessTree from "./ProcessTree";
import ProcessDetailPanel from "./ProcessDetailPanel";
import ProcessArchitectureTab, { countDocumentsRecursive } from "./ProcessArchitectureTab";
import ProcessNodeFormDialog, { type NodeFormValues } from "./ProcessNodeFormDialog";
import ProcessDeleteDialog from "./ProcessDeleteDialog";
import ProcessMigrationDialog from "./ProcessMigrationDialog";
import AddDocFromKbDialog from "./AddDocFromKbDialog";
import ProcessImportDialog from "./ProcessImportDialog";
import type { ProcessNode } from "../types/process";
import type { EditingContext } from "./DocumentEditorTab";

interface ProcessManagementTabProps {
  companyCode?: string | null;
  onSwitchView?: (view: string) => void;
  onMergeFiles?: (payload: {
    fileIds: string[];
    fileKeys: string[];
    nodeId: string | null;
    companyCode: string;
    fileNames?: string[];
    sourceNodeId?: string;
    l1OwnerName?: string;
  }) => void;
  sessionRefreshKey?: number;
  onEditDocument?: (ctx: EditingContext) => void;
  onOpenConversion?: (sessionId: string) => void;
}

export default function ProcessManagementTab({
  companyCode,
  onSwitchView,
  onMergeFiles,
  sessionRefreshKey,
  onEditDocument,
  onOpenConversion,
}: ProcessManagementTabProps) {
  const t = useTranslations("processManagement");
  const {
    tree,
    filteredTree,
    allNodes,
    selectedNode,
    selectedNodeId,
    searchQuery,
    isLoading,
    selectNode,
    setSearchQuery,
    getBreadcrumb,
    updateNode,
    deleteNode,
    createChildNode,
    refreshTree,
    toggleExpand,
    collapseAll,
    expandAll,
  } = useProcessData(companyCode);

  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [editingNodeId, setEditingNodeId] = useState<string | null>(null);
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [createParent, setCreateParent] = useState<ProcessNode | null>(null);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deletingNodeId, setDeletingNodeId] = useState<string | null>(null);
  const [migrationDialogOpen, setMigrationDialogOpen] = useState(false);
  const [addDocDialogOpen, setAddDocDialogOpen] = useState(false);
  const [docRefreshKey, setDocRefreshKey] = useState(0);
  const [importDialogOpen, setImportDialogOpen] = useState(false);
  const [showArchitecture, setShowArchitecture] = useState(false);

  const editingNode = editingNodeId ? (allNodes[editingNodeId] ?? null) : null;
  const deletingNode = deletingNodeId ? (allNodes[deletingNodeId] ?? null) : null;

  const handleEdit = (id: string) => {
    setEditingNodeId(id);
    setEditDialogOpen(true);
  };

  const handleDelete = (id: string) => {
    setDeletingNodeId(id);
    setDeleteDialogOpen(true);
  };

  const handleConfirmDelete = async () => {
    if (!deletingNodeId) return;
    const deleting = allNodes[deletingNodeId];
    const name = deleting?.name ?? "";
    setDeleteDialogOpen(false);
    try {
      await deleteNode(deletingNodeId);
      toast.success(t("architecture.deleteSuccess", { name }));
    } catch (e: unknown) {
      if (
        e instanceof AxiosError &&
        e.response?.status === 409 &&
        e.response.data?.error?.code === "HAS_DOCUMENTS"
      ) {
        const count = deleting ? countDocumentsRecursive(deleting) : 0;
        toast.error(t("architecture.deleteHasDocs", { count }));
        return;
      }
      toast.error(t("architecture.deleteFailed", { message: getErrorMessage(e) }));
    }
  };

  const handleSave = async (id: string | null, values: NodeFormValues) => {
    if (id) {
      try {
        await updateNode(id, {
          name: values.name,
          desc: values.desc,
          role: values.role,
          org: values.org,
          owner: values.owner,
        });
        toast.success(t("toast.nodeUpdated"));
      } catch {
        toast.error(t("toast.nodeUpdateFailed"));
      }
    } else if (createParent) {
      try {
        await createChildNode(createParent, values);
        toast.success(t("architecture.createSuccess", { name: values.name }));
      } catch (e: unknown) {
        toast.error(t("architecture.createFailed", { message: getErrorMessage(e) }));
        throw e;
      }
    }
  };

  const handleAddChild = (parent: ProcessNode) => {
    setCreateParent(parent);
    setCreateDialogOpen(true);
  };

  const handleArchitectureDelete = (node: ProcessNode) => {
    setDeletingNodeId(node.id);
    setDeleteDialogOpen(true);
  };

  const handleExport = useCallback(async () => {
    try {
      const blob = await exportProcessTree(companyCode || undefined, "xlsx");
      const url = URL.createObjectURL(blob as Blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = t("tree.exportFilename");
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      toast.error(t("toast.exportFailed"));
    }
  }, [t]);

  return (
    <div className="flex flex-col flex-1 min-h-0">
      <div className="flex flex-1 min-h-0">
        {/* Left Panel: Process Tree */}
        <div className="w-[340px] min-w-[340px] flex-shrink-0 h-full">
          <ProcessTree
            tree={filteredTree}
            selectedId={selectedNodeId}
            onSelect={(id) => {
              setShowArchitecture(false);
              selectNode(id);
            }}
            onToggle={toggleExpand}
            searchQuery={searchQuery}
            onSearchChange={setSearchQuery}
            onCollapseAll={collapseAll}
            onExpandAll={expandAll}
            onShowArchitecture={() => setShowArchitecture((v) => !v)}
            onImport={() => setImportDialogOpen(true)}
            onExport={handleExport}
          />
        </div>

        {/* Right Panel: Detail or Architecture */}
        {showArchitecture ? (
          <div className="flex-1 overflow-auto">
            <ProcessArchitectureTab
              onBack={() => setShowArchitecture(false)}
              tree={tree}
              onSelectNode={(id) => {
                setShowArchitecture(false);
                selectNode(id);
              }}
              onAddChild={handleAddChild}
              onDeleteNode={handleArchitectureDelete}
            />
          </div>
        ) : (
          <ProcessDetailPanel
            node={selectedNode}
            tree={tree}
            onSelect={selectNode}
            getBreadcrumb={getBreadcrumb}
            onEdit={handleEdit}
            onDelete={handleDelete}
            onMigrate={() => setMigrationDialogOpen(true)}
            onAddDoc={() => setAddDocDialogOpen(true)}
            onSwitchTab={onSwitchView}
            onEditDocument={onEditDocument}
            onOpenConversion={onOpenConversion}
            sessionRefreshKey={(sessionRefreshKey ?? 0) + docRefreshKey}
          />
        )}
      </div>

      {/* Edit Dialog */}
      <ProcessNodeFormDialog
        open={editDialogOpen}
        onOpenChange={setEditDialogOpen}
        node={editingNode}
        mode="edit"
        onSave={handleSave}
      />

      {/* Create Child Dialog */}
      <ProcessNodeFormDialog
        open={createDialogOpen}
        onOpenChange={(v) => {
          setCreateDialogOpen(v);
          if (!v) setCreateParent(null);
        }}
        mode="create"
        parentNode={createParent}
        onSave={handleSave}
      />

      {/* Delete Confirm Dialog */}
      <ProcessDeleteDialog
        open={deleteDialogOpen}
        onOpenChange={setDeleteDialogOpen}
        node={deletingNode}
        onConfirm={handleConfirmDelete}
      />

      {/* Migration Dialog */}
      <ProcessMigrationDialog
        open={migrationDialogOpen}
        onOpenChange={setMigrationDialogOpen}
        onMerge={(fileIds, fileKeys, fileNames) => {
          const breadcrumb = selectedNodeId ? getBreadcrumb(selectedNodeId) : [];
          const l1Node = breadcrumb.find((n) => n.level === 1);
          onMergeFiles?.({
            fileIds,
            fileKeys,
            nodeId: selectedNodeId,
            companyCode: companyCode ?? "",
            fileNames,
            sourceNodeId: selectedNodeId || undefined,
            l1OwnerName: l1Node?.owner,
          });
        }}
      />

      {/* Add Document from KB Dialog */}
      <AddDocFromKbDialog
        open={addDocDialogOpen}
        onOpenChange={setAddDocDialogOpen}
        nodeId={selectedNodeId || ""}
        onAdded={() => setDocRefreshKey((k) => k + 1)}
      />

      {/* Import Dialog */}
      <ProcessImportDialog
        open={importDialogOpen}
        onOpenChange={setImportDialogOpen}
        onImported={refreshTree}
      />
    </div>
  );
}
