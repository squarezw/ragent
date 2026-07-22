import { useDeferredValue, useState } from "react";
import { useTranslations } from "next-intl";
import * as Dialog from "@radix-ui/react-dialog";
import { Search, X, FileSpreadsheet, FileText, FileType } from "lucide-react";
import { Card } from "@/components/ui/card";
import { MarkdownRenderer } from "@/components/MarkdownRenderer";
import type { Segment } from "@/hooks/useChatSegments";

function getFileIcon(mimetype?: string) {
  if (mimetype?.includes("pdf") || mimetype?.includes("PDF")) {
    return <FileType className="w-4 h-4 text-destructive" />;
  }

  if (
    mimetype?.includes("csv") ||
    mimetype?.includes("excel") ||
    mimetype?.includes("spreadsheet") ||
    mimetype?.includes("Excel")
  ) {
    return <FileSpreadsheet className="w-4 h-4 text-success" />;
  }

  return <FileText className="w-4 h-4 text-info" />;
}

interface ReferencesDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  segments: { [key: number]: Segment[] };
  segmentsLoading: { [key: number]: boolean };
  currentMessageIndex: number;
}

export default function ReferencesDialog({
  open,
  onOpenChange,
  segments,
  segmentsLoading,
  currentMessageIndex,
}: ReferencesDialogProps) {
  const t = useTranslations("chat");
  const [referencesSearchQuery, setReferencesSearchQuery] = useState("");
  const deferredSearchQuery = useDeferredValue(referencesSearchQuery);

  const handleOpenChange = (newOpen: boolean) => {
    onOpenChange(newOpen);
    if (!newOpen) {
      setReferencesSearchQuery("");
    }
  };

  return (
    <Dialog.Root open={open} onOpenChange={handleOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/30 z-50" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-[90vw] max-w-4xl max-h-[80vh] -translate-x-1/2 -translate-y-1/2 rounded-lg bg-background shadow-lg flex flex-col">
          <div className="flex items-center justify-between p-6 border-b gap-4">
            <Dialog.Title className="text-lg font-semibold flex-shrink-0">
              {t("referenceContent")}
            </Dialog.Title>
            <div
              className="w-48 relative"
              style={{
                margin: "0 20px 0 auto",
              }}
            >
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <input
                type="text"
                placeholder={t("searchReferences")}
                value={referencesSearchQuery}
                onChange={(e) => setReferencesSearchQuery(e.target.value)}
                className="w-full pl-8 pr-7 py-1 text-sm border border-border rounded-md focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent bg-background"
              />
              {referencesSearchQuery && (
                <button
                  type="button"
                  onClick={() => setReferencesSearchQuery("")}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
            <Dialog.Close asChild>
              <button
                type="button"
                className="rounded-sm opacity-70 ring-offset-background transition-opacity hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:pointer-events-none"
              >
                <X className="h-4 w-4" />
                <span className="sr-only">{t("close")}</span>
              </button>
            </Dialog.Close>
          </div>
          <div className="flex-1 overflow-y-auto p-6">
            {currentMessageIndex >= 0 && segments[currentMessageIndex] ? (
              <div className="space-y-4">
                {segments[currentMessageIndex].map((segment, index) => (
                  <Card key={segment.id} className="p-4 bg-muted/50">
                    <div className="flex items-start gap-3">
                      <div className="w-6 h-6 rounded-full bg-success/10 flex items-center justify-center flex-shrink-0">
                        <span className="text-success text-sm font-bold">{index + 1}</span>
                      </div>
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-2">
                          <div className="w-4 h-4 rounded bg-muted flex items-center justify-center">
                            {getFileIcon(segment.mimetype)}
                          </div>
                          <span className="text-sm text-muted-foreground font-medium">
                            {segment.originalname}
                          </span>
                        </div>
                        <div className="text-sm leading-relaxed bg-background p-3 rounded border">
                          <MarkdownRenderer
                            content={segment.segment_text}
                            highlightText={deferredSearchQuery}
                          />
                        </div>
                      </div>
                    </div>
                  </Card>
                ))}
              </div>
            ) : segmentsLoading[currentMessageIndex] ? (
              <div className="flex items-center justify-center py-8">
                <div className="flex items-center gap-2 text-muted-foreground">
                  <div className="w-4 h-4 border border-muted-foreground border-t-primary rounded-full animate-spin"></div>
                  <span>{t("loadingReferences")}</span>
                </div>
              </div>
            ) : (
              <div className="flex items-center justify-center py-8 text-muted-foreground">
                {t("noReferences")}
              </div>
            )}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
