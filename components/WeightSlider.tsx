"use client";

import React, { useState } from "react";
import { useTranslations } from "next-intl";
import { Slider } from "@/components/ui/slider";
import { Label } from "@/components/ui/label";
import { HelpCircle } from "lucide-react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

interface WeightSliderProps {
  vectorWeight: number;
  textWeight: number;
  onWeightChange: (vectorWeight: number, textWeight: number) => void;
  disabled?: boolean;
}

export default function WeightSlider({
  vectorWeight,
  textWeight,
  onWeightChange,
  disabled = false,
}: WeightSliderProps) {
  const t = useTranslations("common");

  // 计算滑动条的值 (0-1)，其中0表示全文检索权重最大，1表示语义检索权重最大
  const sliderValue = vectorWeight;

  const handleSliderChange = (value: number[]) => {
    const newVectorWeight = value[0];
    const newTextWeight = 1 - newVectorWeight;
    onWeightChange(newVectorWeight, newTextWeight);
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Label className="text-sm font-medium">{t("retrievalWeightSettings")}</Label>
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <HelpCircle className="h-4 w-4 text-gray-400 hover:text-muted-foreground cursor-help" />
            </TooltipTrigger>
            <TooltipContent side="top" className="max-w-xs">
              <div className="space-y-1 text-sm">
                <p>• {t("retrievalWeightHelpLine1")}</p>
                <p>• {t("retrievalWeightHelpLine2")}</p>
                <p>• {t("retrievalWeightHelpLine3")}</p>
              </div>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      </div>

      {/* 权重标签 */}
      <div className="flex justify-between items-center text-sm text-muted-foreground">
        <div className="flex items-center gap-2">
          <span>{t("semanticRetrieval")}</span>
          <span className="font-mono text-xs bg-blue-100 text-blue-800 px-2 py-1 rounded">
            {vectorWeight.toFixed(1)}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <span>{t("fulltextRetrieval")}</span>
          <span className="font-mono text-xs bg-pink-100 text-pink-800 px-2 py-1 rounded">
            {textWeight.toFixed(1)}
          </span>
        </div>
      </div>

      {/* 滑动条容器 */}
      <div className="relative">
        {/* 背景渐变 */}
        <div className="absolute inset-0 h-2 bg-gradient-to-r from-primary to-accent rounded-full opacity-30"></div>

        {/* 滑动条 */}
        <Slider
          value={[sliderValue]}
          onValueChange={handleSliderChange}
          max={1}
          min={0}
          step={0.1}
          disabled={disabled}
          className="relative z-10"
        />

        {/* 中心线 */}
        <div className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 w-px h-4 bg-border"></div>
      </div>
    </div>
  );
}
