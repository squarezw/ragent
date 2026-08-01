"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import axios from "@/lib/axios";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Loader2 } from "lucide-react";
import { MarkdownRenderer } from "@/components/MarkdownRenderer";
import {
  IMAGE_PREVIEW_EXTENSIONS,
  OFFICE_PREVIEW_EXTENSIONS,
  assetExtname,
  formatBytes,
} from "@/lib/skillAssets";

/** 文本预览的字符上限：几 MB 的脚本一次塞进 DOM 会把页面卡住 */
const TEXT_PREVIEW_MAX_CHARS = 200_000;

interface Props {
  skillId: number;
  /** 资产相对路径；null = 不打开 */
  path: string | null;
  sizeBytes?: number;
  stage?: "draft" | "published";
  onClose: () => void;
}

export default function SkillAssetPreviewDialog({
  skillId,
  path,
  sizeBytes,
  stage = "draft",
  onClose,
}: Props) {
  const t = useTranslations("skills");
  const [loading, setLoading] = useState(false);
  const [text, setText] = useState<string | null>(null);
  const [objectUrl, setObjectUrl] = useState<string | null>(null);
  const [officeUrl, setOfficeUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const ext = path ? assetExtname(path) : "";
  const isOffice = OFFICE_PREVIEW_EXTENSIONS.has(ext);
  const isImage = IMAGE_PREVIEW_EXTENSIONS.has(ext);

  useEffect(() => {
    if (!path) return;
    let revoked: string | null = null;
    setLoading(true);
    setText(null);
    setObjectUrl(null);
    setOfficeUrl(null);
    setError(null);

    const contentUrl =
      `/api/v1/skills/${skillId}/asset-content` +
      `?path=${encodeURIComponent(path)}&stage=${stage}`;

    (async () => {
      try {
        if (isOffice) {
          // 复用平台既有的 kkFileView 链路：它自己去抓 fileUrl，所以这里只给地址。
          // create-link 会把调用者的 Authorization 放进预览 token 里转发，
          // 因此指向受保护的 /api/v1 端点也拿得到。
          const origin = typeof window !== "undefined" ? window.location.origin : "";
          const res = await axios.post("/api/file-preview/create-link", {
            fileUrl: `${origin}${contentUrl}`,
            extension: ext,
          });
          const url = res.data?.previewUrl;
          if (!url) throw new Error("no previewUrl");
          setOfficeUrl(url);
        } else if (isImage) {
          const res = await axios.get(contentUrl, { responseType: "blob" });
          const url = URL.createObjectURL(res.data as Blob);
          revoked = url;
          setObjectUrl(url);
        } else {
          // 文本/代码：按 blob 取再解码，避免 axios 对未知 content-type 的自动 JSON 解析
          const res = await axios.get(contentUrl, { responseType: "blob" });
          const raw = await (res.data as Blob).text();
          setText(
            raw.length > TEXT_PREVIEW_MAX_CHARS
              ? `${raw.slice(0, TEXT_PREVIEW_MAX_CHARS)}\n\n…（已截断，完整内容请用「导出全部」下载）`
              : raw
          );
        }
      } catch {
        setError(t("assetPreviewFailed"));
      } finally {
        setLoading(false);
      }
    })();

    return () => {
      if (revoked) URL.revokeObjectURL(revoked);
    };
  }, [path, skillId, stage, ext, isOffice, isImage, t]);

  return (
    <Dialog open={!!path} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-4xl max-h-[85vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle className="font-mono text-sm break-all">
            {path}
            {sizeBytes !== undefined && (
              <span className="ml-2 font-sans text-xs text-muted-foreground">
                {formatBytes(sizeBytes)}
              </span>
            )}
          </DialogTitle>
        </DialogHeader>

        <div className="flex-1 overflow-auto">
          {loading ? (
            <div className="flex justify-center py-12">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : error ? (
            <p className="text-sm text-destructive py-8 text-center">{error}</p>
          ) : officeUrl ? (
            <iframe src={officeUrl} className="w-full h-[65vh] border-0" title={path || ""} />
          ) : objectUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={objectUrl} alt={path || ""} className="max-w-full mx-auto" />
          ) : text !== null ? (
            ext === ".md" || ext === ".markdown" ? (
              <MarkdownRenderer content={text} />
            ) : (
              // 代码用等宽 + 保留空白：markdown 渲染会把缩进和 # 吃掉
              <pre className="text-xs font-mono whitespace-pre-wrap break-words p-3 rounded-md bg-muted/50">
                {text}
              </pre>
            )
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}
