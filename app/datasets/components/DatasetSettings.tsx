"use client";
import { useEffect, useRef } from "react";
import { useTranslations } from "next-intl";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { ChevronDown, ChevronRight } from "lucide-react";
import VisibilitySelect from "@/components/VisibilitySelect";
import WeightSlider from "@/components/WeightSlider";

interface DatasetSettingsProps {
  // 基础设置
  datasetName: string;
  setDatasetName: (name: string) => void;
  datasetDescription: string;
  setDatasetDescription: (description: string) => void;
  datasetVisibility: string;
  setDatasetVisibility: (visibility: string) => void;
  autoFocus?: boolean;

  // 高级设置
  splitMode: string;
  setSplitMode: (mode: string) => void;
  fixedLength: number;
  setFixedLength: (length: number) => void;
  segmentModel: string;
  setSegmentModel: (model: string) => void;
  contentParsing: string;
  setContentParsing: (parsing: string) => void;
  enhanced: boolean;
  setEnhanced: (enhanced: boolean) => void;
  enableOcr: boolean;
  setEnableOcr: (enableOcr: boolean) => void;
  promptType: string;
  setPromptType: (type: string) => void;
  vectorWeight: number;
  setVectorWeight: (weight: number) => void;
  textWeight: number;
  setTextWeight: (weight: number) => void;
  rerankService: string;
  setRerankService: (service: string) => void;

  // 状态控制
  showAdvancedSettings: boolean;
  setShowAdvancedSettings: (show: boolean) => void;
  disabled?: boolean;

  // 编辑模式相关
  isEditMode?: boolean;
  editingDataset?: any;
}

export default function DatasetSettings({
  datasetName,
  setDatasetName,
  datasetDescription,
  setDatasetDescription,
  datasetVisibility,
  setDatasetVisibility,
  autoFocus = false,
  splitMode,
  setSplitMode,
  fixedLength,
  setFixedLength,
  segmentModel,
  setSegmentModel,
  contentParsing,
  setContentParsing,
  enhanced,
  setEnhanced,
  enableOcr,
  setEnableOcr,
  promptType,
  setPromptType,
  vectorWeight,
  setVectorWeight,
  textWeight,
  setTextWeight,
  rerankService,
  setRerankService,
  showAdvancedSettings,
  setShowAdvancedSettings,
  disabled = false,
  isEditMode = false,
  editingDataset,
}: DatasetSettingsProps) {
  const t = useTranslations("datasets");
  const nameInputRef = useRef<HTMLInputElement | null>(null);
  useEffect(() => {
    if (autoFocus && nameInputRef.current) {
      nameInputRef.current.focus();
    }
  }, [autoFocus]);

  return (
    <div className="space-y-4">
      {/* 基础设置 */}
      <div>
        <Label htmlFor="dataset-name" className="text-base font-semibold">
          {t("datasetName")}
        </Label>
        <Input
          id="dataset-name"
          value={datasetName}
          onChange={(e) => setDatasetName(e.target.value)}
          placeholder={t("datasetNamePlaceholder")}
          className="mt-1"
          disabled={disabled}
          ref={nameInputRef}
        />
      </div>

      <div>
        <Label htmlFor="dataset-description" className="text-base font-semibold">
          {t("datasetDescription")}
        </Label>
        <Textarea
          id="dataset-description"
          value={datasetDescription}
          onChange={(e) => setDatasetDescription(e.target.value)}
          placeholder={t("datasetDescriptionPlaceholder")}
          className="mt-1"
          disabled={disabled}
          rows={3}
        />
      </div>

      {/* 编辑模式下显示可见性设置 */}
      {isEditMode && (
        <div>
          <VisibilitySelect
            value={datasetVisibility}
            onChange={setDatasetVisibility}
            disabled={disabled}
            className="mt-1"
          />
        </div>
      )}

      {/* 高级设置 */}
      <div className="border-t pt-4">
        <button
          type="button"
          onClick={() => setShowAdvancedSettings(!showAdvancedSettings)}
          className="flex items-center gap-2 text-sm font-medium text-foreground hover:text-foreground transition-colors"
        >
          {showAdvancedSettings ? (
            <ChevronDown className="h-4 w-4" />
          ) : (
            <ChevronRight className="h-4 w-4" />
          )}
          {t("advancedSettings")}
        </button>

        {showAdvancedSettings && (
          <div className="mt-4 space-y-4 pl-6 border-l-2 border-gray-100">
            {/* 分段方式与文档解析配置 - 并排显示 */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* 分段方式 */}
              <div>
                <Label>{t("splitMode")}</Label>
                <div className="flex items-center gap-2 mt-1">
                  <Select value={splitMode} onValueChange={setSplitMode} disabled={disabled}>
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder={t("splitModePlaceholder")} />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="auto">{t("splitModeAuto")}</SelectItem>
                      <SelectItem value="line">{t("splitModeLine")}</SelectItem>
                      <SelectItem value="paragraph">{t("splitModeParagraph")}</SelectItem>
                      <SelectItem value="sentence">{t("splitModeSentence")}</SelectItem>
                      <SelectItem value="fixed">{t("splitModeFixed")}</SelectItem>
                    </SelectContent>
                  </Select>
                  {splitMode === "fixed" && (
                    <Input
                      type="number"
                      min={50}
                      max={2000}
                      value={fixedLength}
                      onChange={(e) => setFixedLength(Number(e.target.value))}
                      className="w-24"
                      placeholder={t("fixedLengthPlaceholder")}
                      disabled={disabled}
                    />
                  )}
                </div>
                <p className="text-xs text-muted-foreground mt-1">{t("splitModeDesc")}</p>

                {/* 编辑模式下的警告信息 */}
                {isEditMode &&
                  editingDataset &&
                  editingDataset.settings?.splitMode &&
                  splitMode !== editingDataset.settings.splitMode && (
                    <div className="mt-2 p-2 bg-red-50 border border-red-200 rounded text-xs text-red-800">
                      {t("splitModeWarning")}
                    </div>
                  )}
              </div>

              {/* 文档解析配置 */}
              <div>
                <Label>{t("documentParsing")}</Label>
                <Select
                  value={contentParsing}
                  onValueChange={setContentParsing}
                  disabled={disabled}
                >
                  <SelectTrigger className="w-full mt-1">
                    <SelectValue placeholder={t("documentParsingPlaceholder")} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="local">{t("parsingLocal")}</SelectItem>
                    <SelectItem value="remote">{t("parsingRemote")}</SelectItem>
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground mt-1">{t("documentParsingDesc")}</p>
              </div>
            </div>

            {/* 模型配置 - 训练模型与重排模型并排 */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* 训练模型 */}
              <div>
                <Label>{t("trainingModel")}</Label>
                <Select value={segmentModel} onValueChange={setSegmentModel} disabled={disabled}>
                  <SelectTrigger className="w-full mt-1">
                    <SelectValue placeholder={t("trainingModelPlaceholder")} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="aliyun">Aliyun</SelectItem>
                    <SelectItem value="aliyun-v4">Aliyun V4</SelectItem>
                    <SelectItem value="e5">E5</SelectItem>
                    <SelectItem value="qwen">Qwen</SelectItem>
                    <SelectItem value="openai">OpenAI</SelectItem>
                  </SelectContent>
                </Select>

                {/* 创建模式下的提示信息 */}
                {!isEditMode && (
                  <div className="mt-2 p-2 bg-blue-50 border border-blue-200 rounded text-xs text-blue-800">
                    {t("trainingModelInfo")}
                  </div>
                )}

                {/* 编辑模式下的警告信息 */}
                {isEditMode &&
                  editingDataset &&
                  editingDataset.settings?.segmentModel &&
                  segmentModel !== editingDataset.settings.segmentModel && (
                    <div className="mt-2 p-2 bg-yellow-50 border border-yellow-200 rounded text-xs text-yellow-800">
                      {t("trainingModelWarning")}
                    </div>
                  )}
              </div>

              {/* 重排模型 */}
              <div>
                <Label>{t("rerankModel")}</Label>
                <Select value={rerankService} onValueChange={setRerankService} disabled={disabled}>
                  <SelectTrigger className="w-full mt-1">
                    <SelectValue placeholder={t("rerankModelPlaceholder")} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="deepseek">DeepSeek</SelectItem>
                    <SelectItem value="aliyun">Aliyun</SelectItem>
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground mt-1">{t("rerankModelDesc")}</p>
              </div>
            </div>

            {/* 分段增强和 OCR 识别 */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* 分段增强 */}
              <div>
                <div className="flex items-center space-x-2">
                  <Checkbox
                    id="enhanced"
                    checked={enhanced}
                    onCheckedChange={(checked) => setEnhanced(checked === true)}
                    disabled={disabled}
                  />
                  <Label htmlFor="enhanced" className="text-sm font-medium">
                    {t("segmentEnhancement")}
                  </Label>
                </div>
                <p className="text-xs text-muted-foreground mt-1 ml-6">
                  {t("segmentEnhancementDesc")}
                </p>

                {enhanced && (
                  <div className="mt-3 ml-6">
                    <Label className="text-sm">{t("promptCategory")}</Label>
                    <Select value={promptType} onValueChange={setPromptType} disabled={disabled}>
                      <SelectTrigger className="w-full mt-1">
                        <SelectValue placeholder={t("promptCategoryPlaceholder")} />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="1">{t("promptCategoryResume")}</SelectItem>
                        <SelectItem value="2">{t("promptCategoryPolicy")}</SelectItem>
                        <SelectItem value="3">{t("promptCategoryOther")}</SelectItem>
                      </SelectContent>
                    </Select>
                    <p className="text-xs text-muted-foreground mt-1">{t("promptCategoryDesc")}</p>
                  </div>
                )}
              </div>

              {/* OCR 识别 */}
              <div>
                <div className="flex items-center space-x-2">
                  <Checkbox
                    id="enableOcr"
                    checked={enableOcr}
                    onCheckedChange={(checked) => setEnableOcr(checked === true)}
                    disabled={disabled}
                  />
                  <Label htmlFor="enableOcr" className="text-sm font-medium">
                    {t("ocrRecognition")}
                  </Label>
                </div>
                <p className="text-xs text-muted-foreground mt-1 ml-6">{t("ocrRecognitionDesc")}</p>
              </div>
            </div>

            {/* 权重设置 */}
            <div>
              <WeightSlider
                vectorWeight={vectorWeight}
                textWeight={textWeight}
                onWeightChange={(newVectorWeight, newTextWeight) => {
                  setVectorWeight(newVectorWeight);
                  setTextWeight(newTextWeight);
                }}
                disabled={disabled}
              />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
