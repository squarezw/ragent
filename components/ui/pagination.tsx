import React from "react";
import { Button } from "./button";

export interface PaginationData {
  page: number;
  total: number;
  total_pages: number;
}

export interface PaginationProps {
  pagination: PaginationData;
  onPageChange: (page: number) => void;
  itemName?: string; // 可自定义项目名称，默认为"个文件"
  className?: string;
  showInfo?: boolean; // 是否显示分页信息，默认为true
  maxVisiblePages?: number; // 最大显示的页码数，默认为5
}

export const Pagination: React.FC<PaginationProps> = ({
  pagination,
  onPageChange,
  itemName = "个文件",
  className = "",
  showInfo = true,
  maxVisiblePages = 5,
}) => {
  const { page, total, total_pages } = pagination;
  const currentPage = page || 1;
  const totalPages = total_pages || 1;
  const totalItems = total || 0;

  // 如果只有一页或没有数据，不显示分页组件
  if (totalPages <= 1) {
    return null;
  }

  // 生成页码数组
  const generatePageNumbers = () => {
    const pages: number[] = [];
    const maxPages = Math.min(maxVisiblePages, totalPages);

    if (totalPages <= maxPages) {
      // 总页数小于等于最大显示页数，显示所有页码
      for (let i = 1; i <= totalPages; i++) {
        pages.push(i);
      }
    } else if (currentPage <= Math.ceil(maxPages / 2)) {
      // 当前页在开始部分
      for (let i = 1; i <= maxPages; i++) {
        pages.push(i);
      }
    } else if (currentPage >= totalPages - Math.floor(maxPages / 2)) {
      // 当前页在结束部分
      for (let i = totalPages - maxPages + 1; i <= totalPages; i++) {
        pages.push(i);
      }
    } else {
      // 当前页在中间部分
      const start = currentPage - Math.floor(maxPages / 2);
      for (let i = start; i < start + maxPages; i++) {
        pages.push(i);
      }
    }

    return pages;
  };

  const pageNumbers = generatePageNumbers();

  return (
    <div className={`flex items-center justify-between mt-4 pt-4 border-t ${className}`}>
      {showInfo && (
        <div className="text-sm text-muted-foreground">
          共 {totalItems} {itemName}，第 {currentPage} / {totalPages} 页
        </div>
      )}
      <div className="flex items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          onClick={() => onPageChange(currentPage - 1)}
          disabled={currentPage <= 1}
        >
          上一页
        </Button>

        {/* 页码按钮 */}
        <div className="flex items-center gap-1">
          {pageNumbers.map((pageNum) => (
            <Button
              key={pageNum}
              variant={currentPage === pageNum ? "default" : "outline"}
              size="sm"
              onClick={() => onPageChange(pageNum)}
              className="w-8 h-8 p-0"
            >
              {pageNum}
            </Button>
          ))}
        </div>

        <Button
          variant="outline"
          size="sm"
          onClick={() => onPageChange(currentPage + 1)}
          disabled={currentPage >= totalPages}
        >
          下一页
        </Button>
      </div>
    </div>
  );
};

export default Pagination;
