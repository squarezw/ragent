"use client";

import { type ReactNode, useId, useState } from "react";
import { ChevronDown } from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

interface CollapsibleCardProps {
  icon: ReactNode;
  title: string;
  description?: string;
  /** 默认展开与否。系统设置里配一次就不再动的区块传 false */
  defaultOpen?: boolean;
  children: ReactNode;
}

/**
 * 可折叠的设置区块。
 *
 * 内容用条件渲染而不是 CSS 隐藏：这些区块里有表单控件，`display:none` 的输入框
 * 仍然在 DOM 里，仍会被 Tab 键走到、被浏览器自动填充、被表单校验拦住 ——
 * 用户看不见的地方报错，找不到是哪儿出的问题。
 */
export function CollapsibleCard({
  icon,
  title,
  description,
  defaultOpen = true,
  children,
}: CollapsibleCardProps) {
  const [open, setOpen] = useState(defaultOpen);
  const contentId = useId();

  return (
    <Card className="break-inside-avoid">
      {/* button 而非 div+onClick：键盘要能聚焦、回车要能触发、读屏要念出展开状态 */}
      <CardHeader
        className="pb-3 cursor-pointer select-none"
        onClick={() => setOpen((v) => !v)}
      >
        <button
          type="button"
          aria-expanded={open}
          aria-controls={contentId}
          className="flex w-full items-center gap-2 text-left"
          onClick={(e) => {
            // 外层 CardHeader 也在监听；不拦住会触发两次，等于点了没反应
            e.stopPropagation();
            setOpen((v) => !v);
          }}
        >
          <CardTitle className="flex flex-1 items-center gap-2 text-base">
            {icon}
            {title}
          </CardTitle>
          <ChevronDown
            className={`h-4 w-4 shrink-0 text-muted-foreground transition-transform ${
              open ? "" : "-rotate-90"
            }`}
          />
        </button>
        {description && (
          <CardDescription className="text-xs text-muted-foreground">
            {description}
          </CardDescription>
        )}
      </CardHeader>
      {open && (
        <CardContent id={contentId} className="space-y-3">
          {children}
        </CardContent>
      )}
    </Card>
  );
}
