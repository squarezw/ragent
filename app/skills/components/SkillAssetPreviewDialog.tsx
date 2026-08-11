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
import { Loader2, Pencil, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { MarkdownRenderer } from "@/components/MarkdownRenderer";
import { canEditAsset } from "@/lib/assetEditGuard";
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
  /**
   * 资产的 kind，**原样取自服务端**。保存时必须原封不动传回去 —— 后端 PUT 是
   * upsert，kind 传错会把一份 script 悄悄改判成 reference，它就此不再被执行且不报错。
   * 用 string 而非 SkillAssetKind：收窄会强迫把后端将来新增的 kind 映射成某个已知值。
   */
  kind?: string;
  /** 有写权限才给编辑入口；不传 = 只读（内置技能、无权限的人） */
  onSave?: (text: string) => Promise<boolean>;
  onClose: () => void;
}

export default function SkillAssetPreviewDialog({
  skillId,
  path,
  sizeBytes,
  stage = "draft",
  kind,
  onSave,
  onClose,
}: Props) {
  const t = useTranslations("skills");
  const [loading, setLoading] = useState(false);
  const [text, setText] = useState<string | null>(null);
  const [objectUrl, setObjectUrl] = useState<string | null>(null);
  const [officeUrl, setOfficeUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  /**
   * 取回的正文是否被截断。**截断的内容绝对不能保存** —— 那等于把文件后半截
   * 静默抹掉，而且保存会成功、界面会显示"已保存"。宁可不给编辑入口。
   */
  const [truncated, setTruncated] = useState(false);

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
    setEditing(false);
    setTruncated(false);

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
          const cut = raw.length > TEXT_PREVIEW_MAX_CHARS;
          setTruncated(cut);
          setText(
            cut
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

  // 判据在 lib/assetEditGuard —— 两条硬约束（截断不可存、二进制不可当文本改）
  // 关乎"保存会不会悄悄弄坏东西"，值得单测，所以不写在组件里
  const canEdit = canEditAsset({
    hasWritePermission: !!onSave,
    textLoaded: text !== null,
    isImage,
    isOffice,
    truncated,
  });

  const handleSave = async () => {
    if (!onSave) return;
    setSaving(true);
    try {
      const ok = await onSave(draft);
      if (ok) {
        setText(draft);
        setEditing(false);
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={!!path} onOpenChange={(v) => !v && onClose()}>
      {/* `!flex !flex-col` 的叹号不是风格问题，是必需的：
          DialogContent 的基础类里带着 `grid`，而 twMerge **不认为 grid 与 flex 冲突**
          （分属 display 与 flex-direction 两组），于是两个类都留在 DOM 上。编译后的
          CSS 里 `.grid` 定义在 `.flex` 之后、优先级相同 —— display:grid 赢，整条 flex
          布局（flex-1 / min-h-0）静默失效，编辑框塌成一条。

          编辑态还要**确定**高度：max-h 只是上限，容器高度仍由内容决定，撑不开子项。
          预览态保持自适应 —— 短文件不该占满屏。 */}
      <DialogContent
        className="max-w-4xl overflow-hidden"
        style={{
          // 用内联样式而不是 tailwind 类：DialogContent 的基础类里带着 `grid`，
          // 而 twMerge **不认为 grid 与 flex 冲突**（分属 display 与 flex-direction
          // 两组），两个类都会留在 DOM 上；编译后的 CSS 里 `.grid` 定义在 `.flex`
          // 之后、优先级相同 —— display:grid 赢，整条 flex 布局静默失效。
          // 内联样式胜过任何类，不必跟类名顺序较劲。
          display: "flex",
          flexDirection: "column",
          // 编辑态要**确定**高度：max-height 只是上限，容器高度仍由内容决定，
          // 撑不开子项。预览态保持自适应 —— 短文件不该占满屏。
          ...(editing ? { height: "85vh" } : { maxHeight: "85vh" }),
        }}
      >
        <DialogHeader>
          <div className="flex items-start justify-between gap-3">
            <DialogTitle className="font-mono text-sm break-all">
              {path}
              {sizeBytes !== undefined && (
                <span className="ml-2 font-sans text-xs text-muted-foreground">
                  {formatBytes(sizeBytes)}
                </span>
              )}
            </DialogTitle>
            {canEdit && !editing && (
              <Button
                size="sm"
                variant="outline"
                className="shrink-0"
                onClick={() => {
                  setDraft(text ?? "");
                  setEditing(true);
                }}
              >
                <Pencil className="h-3.5 w-3.5 mr-1" />
                编辑
              </Button>
            )}
            {editing && (
              <div className="flex gap-2 shrink-0">
                <Button size="sm" variant="ghost" disabled={saving}
                        onClick={() => setEditing(false)}>
                  <X className="h-3.5 w-3.5 mr-1" />
                  取消
                </Button>
                <Button size="sm" onClick={handleSave} disabled={saving || draft === text}>
                  {saving && <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />}
                  保存
                </Button>
              </div>
            )}
          </div>
          {editing && (
            <p className="text-xs text-amber-600 pt-1">
              保存会写入草稿。资产变更属于实质编辑 —— 已发布的技能会退回草稿，需重新提交审核后才对运行时生效。
            </p>
          )}
          {onSave && truncated && (
            <p className="text-xs text-muted-foreground pt-1">
              内容过长已截断显示，因此不能在线编辑（保存截断的正文会丢掉文件后半部分）。请下载后修改再上传。
            </p>
          )}
        </DialogHeader>

        <div className="overflow-auto" style={{ flex: "1 1 auto", minHeight: 0 }}>
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
          ) : editing ? (
            <Textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              spellCheck={false}
              className="resize-none font-mono text-xs leading-relaxed"
              style={{ height: "100%", minHeight: "24rem" }}
            />
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
