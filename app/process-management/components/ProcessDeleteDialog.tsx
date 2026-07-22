"use client";

import { useTranslations } from "next-intl";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { AlertTriangle } from "lucide-react";
import type { ProcessNode } from "../types/process";

interface ProcessDeleteDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  node: ProcessNode | null;
  onConfirm: () => void;
}

export default function ProcessDeleteDialog({
  open,
  onOpenChange,
  node,
  onConfirm,
}: ProcessDeleteDialogProps) {
  const t = useTranslations("processManagement");

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t("dialog.confirmDelete")}</AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="space-y-2">
              <p>
                {t("dialog.deleteMsg")}
                {node && (
                  <span className="font-medium text-foreground"> &laquo;{node.name}&raquo;</span>
                )}
              </p>
              <p className="flex items-center gap-1.5 text-amber-500 text-xs">
                <AlertTriangle className="h-3.5 w-3.5 flex-shrink-0" />
                {t("dialog.deleteWarning")}
              </p>
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{t("dialog.cancel")}</AlertDialogCancel>
          <AlertDialogAction
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            onClick={onConfirm}
          >
            {t("dialog.confirmDeleteBtn")}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
