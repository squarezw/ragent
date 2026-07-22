"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { ProcessNode } from "../types/process";

export interface NodeFormValues {
  name: string;
  desc: string;
  role: string;
  org: string;
  owner: string;
}

interface ProcessNodeFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  node?: ProcessNode | null;
  mode?: "edit" | "create";
  parentNode?: ProcessNode | null;
  /** edit: id of edited node; create: null */
  onSave: (id: string | null, values: NodeFormValues) => void | Promise<void>;
}

const EMPTY_VALUES: NodeFormValues = {
  name: "",
  desc: "",
  role: "",
  org: "",
  owner: "",
};

export default function ProcessNodeFormDialog({
  open,
  onOpenChange,
  node,
  mode = "edit",
  parentNode,
  onSave,
}: ProcessNodeFormDialogProps) {
  const t = useTranslations("processManagement");

  const [values, setValues] = useState<NodeFormValues>(EMPTY_VALUES);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!open) return;
    if (mode === "edit" && node) {
      setValues({
        name: node.name || "",
        desc: node.desc || "",
        role: node.role || "",
        org: node.org || "",
        owner: node.owner || "",
      });
    } else {
      setValues(EMPTY_VALUES);
    }
  }, [open, mode, node]);

  const targetLevel = mode === "create" && parentNode ? parentNode.level + 1 : node?.level;

  const titleKey =
    mode === "edit"
      ? "dialog.editNode"
      : targetLevel === 2
        ? "dialog.createL2"
        : targetLevel === 3
          ? "dialog.createL3"
          : "dialog.createNode";
  const title = t(titleKey);

  const handleSave = async () => {
    if (submitting) return;
    if (!values.name.trim()) return;
    if (mode === "edit" && !node) return;
    setSubmitting(true);
    try {
      await onSave(mode === "edit" ? (node?.id ?? null) : null, values);
      onOpenChange(false);
    } finally {
      setSubmitting(false);
    }
  };

  const set = <K extends keyof NodeFormValues>(key: K, val: NodeFormValues[K]) =>
    setValues((prev) => ({ ...prev, [key]: val }));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription className="sr-only">{title}</DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 py-4">
          <div className="grid gap-2">
            <Label htmlFor="node-name">{t("dialog.name")}</Label>
            <Input
              id="node-name"
              value={values.name}
              onChange={(e) => set("name", e.target.value)}
              placeholder={t("dialog.namePlaceholder")}
            />
          </div>

          <div className="grid gap-2">
            <Label htmlFor="node-desc">{t("detail.description")}</Label>
            <Textarea
              id="node-desc"
              value={values.desc}
              onChange={(e) => set("desc", e.target.value)}
              placeholder={t("dialog.descPlaceholder")}
              rows={3}
            />
          </div>

          <div className="grid gap-2">
            <Label htmlFor="node-owner">{t("dialog.owner")}</Label>
            <Input
              id="node-owner"
              value={values.owner}
              onChange={(e) => set("owner", e.target.value)}
              placeholder={t("dialog.ownerPlaceholder")}
            />
          </div>

          <div className="grid gap-2">
            <Label htmlFor="node-role">{t("detail.role")}</Label>
            <Input
              id="node-role"
              value={values.role}
              onChange={(e) => set("role", e.target.value)}
              placeholder={t("dialog.rolePlaceholder")}
            />
          </div>

          <div className="grid gap-2">
            <Label htmlFor="node-org">{t("detail.organization")}</Label>
            <Input
              id="node-org"
              value={values.org}
              onChange={(e) => set("org", e.target.value)}
              placeholder={t("dialog.orgPlaceholder")}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
            {t("dialog.cancel")}
          </Button>
          <Button onClick={handleSave} disabled={submitting || !values.name.trim()}>
            {t("dialog.save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
