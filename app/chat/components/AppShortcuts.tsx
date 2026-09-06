"use client";

import React, { useRef, useCallback, useState, useEffect } from "react";
import { useTranslations } from "next-intl";
import { Loader2, ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { centerItemScrollLeft, isFullyVisible } from "@/lib/horizontalScroll";

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

  // 首次渲染时把已选中的员工滚进视野。
  //
  // 不做这件事的表现不是"位置不对"：列表停在最左端，选中项在视野外，
  // 可见的四个标签全是灰的——看起来像**谁都没选**，而用户上次明明选过。
  //
  // 只在挂载后做一次（`didInitialScrollRef`）。选择变化时不滚：那是用户自己点的，
  // 本来就在视野里，再滚一下只是无谓的跳动。
  const didInitialScrollRef = useRef(false);
  useEffect(() => {
    if (didInitialScrollRef.current) return;
    const container = scrollContainerRef.current;
    if (!container || !selectedAppId || apps.length === 0) return;
    if (!container.querySelector(`[data-app-id="${selectedAppId}"]`)) return;

    didInitialScrollRef.current = true;

    // 推迟一帧再量。容器的左右内边距取决于箭头是否显示（4px vs 32px），
    // 而那两个状态由**另一个** effect 设置；同一轮里量到的可能还是箭头出现前的
    // 4px，按它居中，等箭头一出来项就又被盖住 —— 就是"滚了但只露一半"。
    const raf = requestAnimationFrame(() => {
      const el = container.querySelector<HTMLElement>(`[data-app-id="${selectedAppId}"]`);
      if (!el) return;

      // 用 getBoundingClientRect 而不是 offsetLeft：按钮的 offsetParent 是外层那个
      // `relative` 容器（滚动容器自身没有 position），offsetLeft 量的不是滚动内容
      // 坐标系里的偏移。
      const contRect = container.getBoundingClientRect();
      const itemRect = el.getBoundingClientRect();
      const style = window.getComputedStyle(container);
      const geometry = {
        containerWidth: container.clientWidth,
        contentWidth: container.scrollWidth,
        itemOffset: itemRect.left - contRect.left + container.scrollLeft,
        itemWidth: itemRect.width,
        // 箭头按钮浮在容器两侧、盖住这两段，居中时要排除在可用宽度外
        padStart: parseFloat(style.paddingLeft) || 0,
        padEnd: parseFloat(style.paddingRight) || 0,
      };
      if (isFullyVisible(geometry, container.scrollLeft)) return;

      // 瞬间到位而不是平滑滚动：这是"恢复上次的位置"，不是用户触发的动作，
      // 从最左端一路滑过去像是界面自己在动
      container.scrollLeft = centerItemScrollLeft(geometry);
      checkScrollButtons();
    });
    return () => cancelAnimationFrame(raf);
  }, [apps, selectedAppId, checkScrollButtons]);

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
              data-app-id={app.id}
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
