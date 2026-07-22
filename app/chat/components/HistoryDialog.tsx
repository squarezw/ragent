import { useTranslations } from "next-intl";
import * as Dialog from "@radix-ui/react-dialog";
import { X } from "lucide-react";

interface HistorySummary {
  id: number;
  summary: string;
  updated_at?: string;
}

interface HistoryDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  historySummaries: HistorySummary[];
  historyLoading: boolean;
  loadingHistorySession: boolean;
  onLoadSession: (sessionId: number) => void;
}

export default function HistoryDialog({
  open,
  onOpenChange,
  historySummaries,
  historyLoading,
  loadingHistorySession,
  onLoadSession,
}: HistoryDialogProps) {
  const t = useTranslations("chat");

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/30 z-50" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-[90vw] max-w-2xl max-h-[80vh] -translate-x-1/2 -translate-y-1/2 rounded-lg bg-background shadow-lg flex flex-col">
          <div className="flex items-center justify-between p-4 border-b">
            <Dialog.Title className="text-lg font-semibold">{t("historyRecords")}</Dialog.Title>
            <Dialog.Close asChild>
              <button
                type="button"
                className="rounded-sm opacity-70 ring-offset-background transition-opacity hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
              >
                <X className="h-4 w-4" />
                <span className="sr-only">{t("close")}</span>
              </button>
            </Dialog.Close>
          </div>
          <div className="flex-1 overflow-y-auto p-4">
            {historyLoading ? (
              <div className="flex items-center justify-center py-8 text-muted-foreground">
                {t("loadingHistory")}
              </div>
            ) : historySummaries.length === 0 ? (
              <div className="flex items-center justify-center py-8 text-muted-foreground">
                {t("noHistory")}
              </div>
            ) : (
              <div className="space-y-2">
                {historySummaries.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => {
                      onLoadSession(item.id);
                      onOpenChange(false);
                    }}
                    disabled={loadingHistorySession}
                    className="w-full text-left p-3 rounded-lg border border-border hover:bg-muted hover:border-muted-foreground/20 transition-colors disabled:opacity-50"
                  >
                    <div className="flex items-center justify-between">
                      <span className="truncate flex-1 text-sm">{item.summary}</span>
                      {item.updated_at && (
                        <span className="text-xs text-muted-foreground ml-2 flex-shrink-0">
                          {new Date(item.updated_at).toLocaleDateString()}
                        </span>
                      )}
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
