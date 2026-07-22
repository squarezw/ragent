"use client";

import { useTranslations } from "next-intl";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { FileText, Settings, User, Building2 } from "lucide-react";
import { toast } from "sonner";
import type { ProcessNode } from "../types/process";

interface L3DetailModalProps {
  node: ProcessNode | null;
  open: boolean;
  onClose: () => void;
  onViewInManagement?: (nodeId: string) => void;
}

export default function L3DetailModal({
  node,
  open,
  onClose,
  onViewInManagement,
}: L3DetailModalProps) {
  const t = useTranslations("processManagement");

  if (!node) return null;

  const levelLabel = `L${node.level}`;

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">{node.name}</DialogTitle>
          <DialogDescription className="sr-only">
            {t("architecture.detailModal.description")}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 mt-2">
          {/* Level badge */}
          <div className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground">
              {t("architecture.detailModal.level")}
            </span>
            <span className="inline-flex items-center rounded-full bg-teal-100 px-2.5 py-0.5 text-xs font-medium text-teal-800 dark:bg-teal-900 dark:text-teal-200">
              {levelLabel}
            </span>
          </div>

          {/* Description */}
          {node.desc && (
            <div className="space-y-1">
              <p className="text-sm font-medium text-muted-foreground flex items-center gap-1.5">
                <FileText className="h-3.5 w-3.5" />
                {t("architecture.detailModal.description")}
              </p>
              <p className="text-sm leading-relaxed">{node.desc}</p>
            </div>
          )}

          {/* Role */}
          {node.role && (
            <div className="space-y-1">
              <p className="text-sm font-medium text-muted-foreground flex items-center gap-1.5">
                <User className="h-3.5 w-3.5" />
                {t("architecture.detailModal.role")}
              </p>
              <p className="text-sm">{node.role}</p>
            </div>
          )}

          {/* Organization */}
          {node.org && (
            <div className="space-y-1">
              <p className="text-sm font-medium text-muted-foreground flex items-center gap-1.5">
                <Building2 className="h-3.5 w-3.5" />
                {t("architecture.detailModal.organization")}
              </p>
              <p className="text-sm">{node.org}</p>
            </div>
          )}

          {/* Documents */}
          {node.docs && (
            <div className="space-y-1">
              <p className="text-sm font-medium text-muted-foreground flex items-center gap-1.5">
                <Settings className="h-3.5 w-3.5" />
                {t("architecture.detailModal.documents")}
              </p>
              <p className="text-sm">{node.docs}</p>
            </div>
          )}
        </div>

        {/* Footer button */}
        <div className="mt-4 pt-4 border-t">
          <button
            type="button"
            className="w-full inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow hover:bg-primary/90 transition-colors"
            onClick={() => {
              onClose();
              if (node && onViewInManagement) {
                onViewInManagement(node.id);
              }
            }}
          >
            {t("architecture.detailModal.manageBtn")}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
