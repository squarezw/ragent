import { useTranslations } from "next-intl";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Maximize2, Minimize2, RefreshCw } from "lucide-react";

interface ChatHeaderProps {
  isFullscreen: boolean;
  onToggleFullscreen: () => void;
  onNewConversation: () => void;
}

export default function ChatHeader({
  isFullscreen,
  onToggleFullscreen,
  onNewConversation,
}: ChatHeaderProps) {
  const t = useTranslations("chat");

  return (
    <div className="hidden sm:flex items-center justify-start py-2 flex-shrink-0">
      <div className="flex items-center gap-1 bg-muted/50 rounded-full px-1 py-1">
        <TooltipProvider delayDuration={100}>
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                onClick={onToggleFullscreen}
                className="p-1.5 rounded-full hover:bg-muted transition-colors"
              >
                {isFullscreen ? (
                  <Minimize2 className="w-4 h-4 text-muted-foreground" />
                ) : (
                  <Maximize2 className="w-4 h-4 text-muted-foreground" />
                )}
              </button>
            </TooltipTrigger>
            <TooltipContent>
              <p>{isFullscreen ? t("exitFullscreen") : t("fullscreenMode")}</p>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>

        <TooltipProvider delayDuration={100}>
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                onClick={onNewConversation}
                className="p-1.5 rounded-full hover:bg-muted transition-colors"
              >
                <RefreshCw className="w-4 h-4 text-muted-foreground" />
              </button>
            </TooltipTrigger>
            <TooltipContent>
              <p>{t("newConversation")}</p>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      </div>
    </div>
  );
}
