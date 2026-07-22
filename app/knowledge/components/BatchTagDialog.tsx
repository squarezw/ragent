"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import * as Dialog from "@radix-ui/react-dialog";
import { Button } from "@/components/ui/button";
import TagSelect from "@/components/TagSelect";

interface BatchTagDialogProps {
  isOpen: boolean;
  onClose: () => void;
  selectedCount: number;
  onSave: (tagIds: number[]) => void;
}

export const BatchTagDialog = ({ isOpen, onClose, selectedCount, onSave }: BatchTagDialogProps) => {
  const t = useTranslations("knowledge");
  const tc = useTranslations("common");
  const [selectedTags, setSelectedTags] = useState<number[]>([]);
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    if (selectedTags.length === 0) return;

    setSaving(true);
    try {
      await onSave(selectedTags);
      setSelectedTags([]);
      onClose();
    } finally {
      setSaving(false);
    }
  };

  const handleClose = () => {
    if (!saving) {
      setSelectedTags([]);
      onClose();
    }
  };

  return (
    <Dialog.Root open={isOpen} onOpenChange={handleClose}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/30 z-50" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-full max-w-md -translate-x-1/2 -translate-y-1/2 rounded-lg bg-card p-6 shadow-lg flex flex-col gap-4">
          <Dialog.Title className="text-lg font-bold">{t("batchAddTags")}</Dialog.Title>

          <div className="space-y-4">
            <div className="text-sm text-muted-foreground">
              {t("addTagsToFiles", { count: selectedCount })}
            </div>

            <div>
              <TagSelect value={selectedTags} onChange={setSelectedTags} disabled={saving} />
            </div>
          </div>

          <div className="flex gap-2 justify-end">
            <Button variant="outline" onClick={handleClose} disabled={saving}>
              {tc("cancel")}
            </Button>
            <Button onClick={handleSave} disabled={saving || selectedTags.length === 0}>
              {saving ? t("processing") : t("confirm")}
            </Button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
};
