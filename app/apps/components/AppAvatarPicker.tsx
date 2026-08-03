"use client";

import { useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Loader2, Trash2, Upload } from "lucide-react";
import { uploadFile, getFileUrl } from "@/lib/ossUpload";
import {
  AVATAR_MAX_BYTES,
  AVATAR_OSS_CATEGORY,
  BUILTIN_AVATARS,
  uniqueAvatarFilename,
} from "@/lib/appAvatar";
import AppAvatar from "./AppAvatar";

interface Props {
  /** 当前头像 URL；空 = 未设置，显示按名称生成的占位 */
  value: string | null;
  /** 传空串表示清空——调用方要把它当"用户主动删了头像"，不是"没改" */
  onChange: (value: string) => void;
  /** 数字员工名称，只用来算占位块 */
  name: string;
}

export default function AppAvatarPicker({ value, onChange, name }: Props) {
  const t = useTranslations("apps");
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    // 先把 input 清空，否则同一个文件选第二次不触发 change（换了图又换回来的场景）
    e.target.value = "";
    if (!file) return;

    if (!file.type.startsWith("image/")) {
      setError(t("avatarMustBeImage"));
      return;
    }
    if (file.size > AVATAR_MAX_BYTES) {
      setError(t("avatarTooLarge"));
      return;
    }

    setUploading(true);
    setError(null);
    try {
      // 换成唯一名再传：OSS 的 key 直接用原文件名，同名会互相覆盖（见 uniqueAvatarFilename）
      const renamed = new File([file], uniqueAvatarFilename(file.name), { type: file.type });
      const objectKey = await uploadFile({ file: renamed, category: AVATAR_OSS_CATEGORY });
      onChange(getFileUrl(objectKey));
    } catch (err: any) {
      setError(err?.response?.data?.error || err?.message || t("avatarUploadFailed"));
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-4">
        {/* 当前头像。内置与上传是同一种东西（都是 URL），这里不做来源判断 */}
        <AppAvatar src={value} name={name} size={64} />

        <div className="space-y-2 min-w-0">
          <div className="flex items-center gap-2">
            <input
              ref={inputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={handleUpload}
              disabled={uploading}
            />
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={uploading}
              onClick={() => inputRef.current?.click()}
            >
              {uploading ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <Upload className="h-4 w-4 mr-2" />
              )}
              {uploading ? t("avatarUploading") : t("avatarUpload")}
            </Button>
            {value && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={uploading}
                // 空串而不是 null：后端靠"字段缺席 vs 空串"区分"没改"和"清空"
                onClick={() => onChange("")}
              >
                <Trash2 className="h-4 w-4 mr-2" />
                {t("avatarClear")}
              </Button>
            )}
          </div>
          <p className="text-xs text-muted-foreground">{t("avatarHint")}</p>
        </div>
      </div>

      {error && <p className="text-xs text-destructive">{error}</p>}

      <div className="flex flex-wrap gap-2">
        {BUILTIN_AVATARS.map((url) => (
          <button
            key={url}
            type="button"
            onClick={() => onChange(url)}
            // 选中态用外圈描边而不是改底色：底色是头像自己的，动它就看不出原样了
            className={`rounded-lg p-0.5 transition-all ${
              value === url
                ? "ring-2 ring-primary ring-offset-1"
                : "hover:ring-2 hover:ring-muted-foreground/30"
            }`}
            title={t("avatarBuiltinPick")}
          >
            {/* 走同一个组件：内置头像的颜色由它按主色上色，直接 <img> 会是透明字形 */}
            <AppAvatar src={url} name="" size={40} />
          </button>
        ))}
      </div>
    </div>
  );
}
