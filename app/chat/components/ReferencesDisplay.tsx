import { useTranslations } from "next-intl";
import { FileSpreadsheet, FileText, FileType } from "lucide-react";

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

interface ReferencesDisplayProps {
  messageIndex: number;
  reference?:
    | string
    | { id?: number; originalname: string; filename?: string; path?: string | null; mimetype?: string }
    | { id?: number; originalname: string; filename?: string; path?: string | null; mimetype?: string }[];
  segmentIds?: number[];
  segmentsLoading: { [key: number]: boolean };
  onOpenReferencesDialog: (messageIndex: number, segmentIds: number[]) => void;
  onPreviewFile: (file: any) => void;
}

export default function ReferencesDisplay({
  messageIndex,
  reference,
  segmentIds,
  segmentsLoading,
  onOpenReferencesDialog,
  onPreviewFile,
}: ReferencesDisplayProps) {
  const t = useTranslations("chat");
  if (!reference && !segmentIds) return null;

  const references =
    reference && typeof reference === "object" && reference !== null
      ? Array.isArray(reference)
        ? reference
        : [reference]
      : [];

  const isLoading = segmentsLoading[messageIndex];

  return (
    <div className="text-sm mt-3 mb-3">
      {references.length > 0 && (
        <div className="mb-2">
          <div className="text-muted-foreground mb-2 flex items-center">
            {t("reference")}
            <div className="flex-1 h-px bg-border ml-2" style={{ width: "30%" }}></div>
          </div>
          <div className="flex flex-wrap gap-2">
            {references.map((refObj, index) => (
              <div
                key={index}
                className="flex items-center bg-background border border-border rounded-lg overflow-hidden"
              >
                <div className="w-5 h-full bg-muted flex items-center justify-center flex-shrink-0">
                  <span className="text-muted-foreground text-xs font-medium">{index + 1}</span>
                </div>
                <div className="flex items-center gap-1 px-2 py-1">
                  <div className="w-4 h-4 flex items-center justify-center">
                    {getFileIcon(refObj.mimetype)}
                  </div>
                  {refObj.path || refObj.id ? (
                    <button
                      className="text-foreground text-left text-sm leading-relaxed hover:text-primary transition-colors"
                      type="button"
                      onClick={() =>
                        onPreviewFile({
                          id: refObj.id?.toString(),
                          filename: refObj.filename || refObj.path?.split("/").pop(),
                          originalname: refObj.originalname,
                          mimetype: refObj.mimetype || "",
                          path: refObj.path || "",
                        })
                      }
                    >
                      {refObj.originalname}
                    </button>
                  ) : (
                    <span className="text-foreground text-sm leading-relaxed">
                      {refObj.originalname}
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {segmentIds && segmentIds.length > 0 && (
        <div className="flex items-center gap-2">
          <button
            type="button"
            className="flex items-center gap-1 px-3 py-1 rounded-full border border-primary/20 bg-primary/5 text-primary hover:bg-primary/10 transition-colors text-sm"
            onClick={() => onOpenReferencesDialog(messageIndex, segmentIds)}
            disabled={isLoading}
          >
            {isLoading && (
              <div className="w-3 h-3 border border-primary/30 border-t-primary rounded-full animate-spin"></div>
            )}
            <span>{t("viewReferences", { count: segmentIds.length })}</span>
          </button>
        </div>
      )}
    </div>
  );
}
