"use client";

import React, { useRef, useCallback, useState, useEffect } from "react";
import { useTranslations } from "next-intl";
import { Loader2, ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";

interface App {
  id: number;
  name: string;
  description: string;
  dataset_ids: string[];
  is_default?: boolean;
}

interface AppShortcutsProps {
  apps: App[];
  appsLoading: boolean;
  selectedAppId: string;
  onAppSelect: (appId: string) => void;
}

export default function AppShortcuts({
  apps,
  appsLoading,
  selectedAppId,
  onAppSelect,
}: AppShortcutsProps) {
  const t = useTranslations("chat");
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const [showLeftButton, setShowLeftButton] = useState(false);
  const [showRightButton, setShowRightButton] = useState(false);

  // Check scroll position to show/hide buttons
  const checkScrollButtons = useCallback(() => {
    if (scrollContainerRef.current) {
      const { scrollLeft, scrollWidth, clientWidth } = scrollContainerRef.current;
      setShowLeftButton(scrollLeft > 0);
      setShowRightButton(scrollLeft < scrollWidth - clientWidth - 1);
    }
  }, []);

  useEffect(() => {
    checkScrollButtons();
    const container = scrollContainerRef.current;
    if (container) {
      container.addEventListener("scroll", checkScrollButtons);
      // Also check on resize
      window.addEventListener("resize", checkScrollButtons);
      return () => {
        container.removeEventListener("scroll", checkScrollButtons);
        window.removeEventListener("resize", checkScrollButtons);
      };
    }
  }, [checkScrollButtons, apps]);

  const scroll = useCallback((direction: "left" | "right") => {
    if (scrollContainerRef.current) {
      const scrollAmount = 200;
      scrollContainerRef.current.scrollBy({
        left: direction === "left" ? -scrollAmount : scrollAmount,
        behavior: "smooth",
      });
    }
  }, []);

  if (appsLoading) {
    return (
      <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground py-2">
        <Loader2 className="w-4 h-4 animate-spin" />
        <span>{t("loadingApps")}</span>
      </div>
    );
  }

  if (!apps || apps.length === 0) {
    return null;
  }

  return (
    <div className="relative">
      {/* Left scroll button - only show when can scroll left */}
      {showLeftButton && (
        <Button
          variant="ghost"
          size="icon"
          onClick={() => scroll("left")}
          className="absolute left-0 top-1/2 -translate-y-1/2 z-10 h-7 w-7 rounded-full bg-background/90 backdrop-blur-sm shadow-sm border border-border/50"
        >
          <ChevronLeft className="w-3.5 h-3.5 text-muted-foreground" />
        </Button>
      )}

      {/* Scrollable container - max width for ~4 items */}
      <div
        ref={scrollContainerRef}
        className="flex gap-2 overflow-x-auto scrollbar-hide py-1 scroll-smooth mx-auto"
        style={{
          scrollbarWidth: "none",
          msOverflowStyle: "none",
          maxWidth: "480px", // ~4 buttons visible
          paddingLeft: showLeftButton ? "32px" : "4px",
          paddingRight: showRightButton ? "32px" : "4px",
        }}
      >
        {apps.map((app) => {
          const isSelected = selectedAppId === app.id.toString();
          return (
            <button
              key={app.id}
              type="button"
              onClick={() => onAppSelect(app.id.toString())}
              className={`
                flex-shrink-0 px-3 py-1.5 rounded-full text-xs
                transition-all duration-200 whitespace-nowrap border
                ${
                  isSelected
                    ? "bg-primary/10 text-primary border-primary/30"
                    : "bg-transparent text-muted-foreground/70 border-border/50 hover:border-border hover:text-muted-foreground"
                }
              `}
            >
              <span className="max-w-[100px] truncate inline-block">{app.name}</span>
            </button>
          );
        })}
      </div>

      {/* Right scroll button - only show when can scroll right */}
      {showRightButton && (
        <Button
          variant="ghost"
          size="icon"
          onClick={() => scroll("right")}
          className="absolute right-0 top-1/2 -translate-y-1/2 z-10 h-7 w-7 rounded-full bg-background/90 backdrop-blur-sm shadow-sm border border-border/50"
        >
          <ChevronRight className="w-3.5 h-3.5 text-muted-foreground" />
        </Button>
      )}

      {/* Hide scrollbar CSS */}
      <style jsx>{`
        .scrollbar-hide::-webkit-scrollbar {
          display: none;
        }
      `}</style>
    </div>
  );
}
