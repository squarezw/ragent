"use client";

import { useState, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Upload } from "lucide-react";
import { UploadDialog } from "./UploadDialog";

interface FloatingUploadButtonProps {
  datasetId: string;
  onUploadSuccess: () => void;
  onAutoVectorize?: (fileIds: string[]) => void;
}

export const FloatingUploadButton = ({
  datasetId,
  onUploadSuccess,
  onAutoVectorize,
}: FloatingUploadButtonProps) => {
  const [showUploadDialog, setShowUploadDialog] = useState(false);
  const [initialFiles, setInitialFiles] = useState<File[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleButtonClick = () => {
    // 先触发文件选择
    fileInputRef.current?.click();
  };

  const handleFileSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files || []);
    if (files.length > 0) {
      setInitialFiles(files);
      setShowUploadDialog(true);
    }
  };

  const handleDialogClose = () => {
    setShowUploadDialog(false);
    setInitialFiles([]);
    // 清空文件输入框
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  return (
    <>
      {/* 隐藏的文件输入框 */}
      <input
        type="file"
        ref={fileInputRef}
        onChange={handleFileSelect}
        multiple
        accept=".pdf,.doc,.docx,.xls,.xlsx,.txt,.md,.csv,image/*"
        className="hidden"
      />

      {/* 悬浮上传按钮 */}
      <div className="fixed bottom-6 right-6 z-40">
        <Button
          size="lg"
          className="rounded-full w-14 h-14 shadow-lg hover:shadow-xl transition-all duration-200"
          onClick={handleButtonClick}
        >
          <Upload className="h-6 w-6" />
        </Button>
      </div>

      {/* 上传对话框 */}
      <UploadDialog
        isOpen={showUploadDialog}
        onClose={handleDialogClose}
        datasetId={datasetId}
        onUploadSuccess={onUploadSuccess}
        initialFiles={initialFiles}
        onAutoVectorize={onAutoVectorize}
      />
    </>
  );
};
