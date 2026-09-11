"use client";
import React from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeRaw from "rehype-raw";
import rehypeSanitize from "rehype-sanitize";
import { toPreviewResource, type PreviewResource } from "@/lib/chatResourcePreview";

interface MarkdownRendererProps {
  content: string;
  className?: string;
  highlightText?: string;
  onPreviewResource?: (resource: PreviewResource) => void;
}

/**
 * 高亮文本中的搜索关键词
 */
function highlightContent(text: string, searchText: string): React.ReactNode {
  if (!searchText || !text) return text;

  const regex = new RegExp(`(${searchText.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})`, "gi");
  const parts = text.split(regex);

  return parts.map((part, index) =>
    regex.test(part) ? (
      <mark key={index} className="bg-yellow-300 text-black px-0.5 rounded">
        {part}
      </mark>
    ) : (
      part
    )
  );
}

/**
 * Markdown 渲染组件（基于 react-markdown）
 * 支持的功能：
 * - GitHub Flavored Markdown (GFM)
 * - 表格、任务列表、删除线
 * - 自动链接
 * - 代码块和行内代码
 * - HTML 标签（安全渲染）
 */
export function MarkdownRenderer({
  content,
  className = "",
  highlightText,
  onPreviewResource,
}: MarkdownRendererProps) {
  if (!content) return null;

  // 创建一个用于高亮文本的包装函数
  const renderWithHighlight = (children: React.ReactNode): React.ReactNode => {
    if (!highlightText) return children;

    if (typeof children === "string") {
      return highlightContent(children, highlightText);
    }

    if (Array.isArray(children)) {
      return children.map((child, index) => (
        <React.Fragment key={index}>{renderWithHighlight(child)}</React.Fragment>
      ));
    }

    return children;
  };

  return (
    <div className={className}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeRaw, rehypeSanitize]}
        components={{
          // 自定义样式
          h1: ({ node, ...props }) => <h1 className="text-2xl font-bold mb-4 mt-6" {...props} />,
          h2: ({ node, ...props }) => <h2 className="text-xl font-bold mb-3 mt-5" {...props} />,
          h3: ({ node, ...props }) => <h3 className="text-lg font-bold mb-2 mt-4" {...props} />,
          h4: ({ node, ...props }) => <h4 className="text-base font-bold mb-2 mt-3" {...props} />,
          p: ({ node, children, ...props }) => (
            <p className="mb-2 leading-relaxed" {...props}>
              {renderWithHighlight(children)}
            </p>
          ),
          ul: ({ node, ...props }) => <ul className="list-disc pl-5 mb-2 space-y-1" {...props} />,
          ol: ({ node, ...props }) => (
            <ol className="list-decimal pl-5 mb-2 space-y-1" {...props} />
          ),
          li: ({ node, children, ...props }) => (
            <li className="leading-relaxed" {...props}>
              {renderWithHighlight(children)}
            </li>
          ),
          table: ({ node, ...props }) => (
            <div className="overflow-x-auto my-4">
              <table
                className="min-w-full border-collapse border border-border text-sm"
                {...props}
              />
            </div>
          ),
          thead: ({ node, ...props }) => <thead className="bg-muted" {...props} />,
          th: ({ node, children, ...props }) => (
            <th className="border border-border px-3 py-2 text-left font-medium" {...props}>
              {renderWithHighlight(children)}
            </th>
          ),
          td: ({ node, children, ...props }) => (
            <td className="border border-border px-3 py-2 text-left" {...props}>
              {renderWithHighlight(children)}
            </td>
          ),
          tr: ({ node, ...props }) => <tr className="even:bg-muted" {...props} />,
          code: ({ node, className, ...props }: any) => {
            const isInline = !className?.includes("language-");
            return isInline ? (
              <code
                className="bg-muted text-destructive px-1.5 py-0.5 rounded text-sm font-mono"
                {...props}
              />
            ) : (
              <code className={className} {...props} />
            );
          },
          pre: ({ node, ...props }) => (
            <pre
              className="bg-gray-900 text-gray-100 p-4 rounded my-3 overflow-x-auto"
              {...props}
            />
          ),
          blockquote: ({ node, children, ...props }) => (
            <blockquote
              className="border-l-4 border-border pl-4 my-2 italic text-foreground"
              {...props}
            >
              {renderWithHighlight(children)}
            </blockquote>
          ),
          a: ({ node, href, onClick, ...props }) => (
            <a
              className="text-blue-500 underline hover:text-blue-400"
              href={href}
              onClick={(event) => {
                const resource = toPreviewResource("url", href);
                if (resource && onPreviewResource) {
                  event.preventDefault();
                  onPreviewResource(resource);
                  return;
                }
                onClick?.(event);
              }}
              rel="noopener noreferrer"
              target="_blank"
              {...props}
            />
          ),
          img: ({ node, src, alt, className: imageClassName, ...props }) => {
            const resource = toPreviewResource("image", typeof src === "string" ? src : undefined, alt);
            const image = (
              // Chat content can reference arbitrary external image hosts, so it cannot use Next image optimization.
              // biome-ignore lint/performance/noImgElement: external chat images need direct rendering
              <img alt={alt || ""} className={imageClassName} src={src} {...props} />
            );
            if (!resource || !onPreviewResource) return image;

            return (
              <button
                aria-label={alt || ""}
                className="inline-block cursor-zoom-in"
                onClick={() => onPreviewResource(resource)}
                type="button"
              >
                {image}
              </button>
            );
          },
          strong: ({ node, children, ...props }) => (
            <strong className="font-semibold" {...props}>
              {renderWithHighlight(children)}
            </strong>
          ),
          em: ({ node, children, ...props }) => (
            <em className="italic" {...props}>
              {renderWithHighlight(children)}
            </em>
          ),
          hr: ({ node, ...props }) => <hr className="my-4 border-border" {...props} />,
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}

export default MarkdownRenderer;
