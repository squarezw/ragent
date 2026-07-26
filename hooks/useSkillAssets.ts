"use client";

import { useCallback, useState } from "react";
import useSWR from "swr";
import axios from "@/lib/axios";
import {
  arrayBufferToBase64,
  encodeAssetPath,
  parseAssetList,
  parseExecConfig,
  parseSandboxImages,
} from "@/lib/skillAssets";
import type {
  SandboxImage,
  SkillAssetItem,
  SkillAssetKind,
  SkillExecConfig,
  SkillExecConfigPayload,
} from "@/types/skill";

/** 单文件上传结果（逐文件成功/失败清单用） */
export interface AssetUploadResult {
  path: string;
  ok: boolean;
  /** 后端 detail 或本地异常信息 */
  detail?: string;
}

export interface AssetUploadItem {
  file: File;
  /** 规范化后的目标路径（planUploads 产出） */
  path: string;
  kind: SkillAssetKind;
}

function detailOf(error: unknown): string {
  const res = (error as { response?: { data?: { detail?: unknown } } })?.response;
  const detail = res?.data?.detail;
  if (typeof detail === "string") return detail;
  return error instanceof Error ? error.message : String(error);
}

const listFetcher = async (url: string) => parseAssetList((await axios.get(url)).data);

/** exec 配置不存在（非可执行 skill）是正常态：404 归一为 null，不当错误 */
const execConfigFetcher = async (url: string): Promise<SkillExecConfig | null> => {
  try {
    const res = await axios.get(url, { suppressErrorToast: true } as never);
    return parseExecConfig(res.data);
  } catch (error) {
    if ((error as { response?: { status?: number } })?.response?.status === 404) return null;
    throw error;
  }
};

/** 镜像白名单拿不到时降级为空清单，UI 转手工输入镜像名 */
const imagesFetcher = async (url: string): Promise<SandboxImage[]> => {
  try {
    const res = await axios.get(url, { suppressErrorToast: true } as never);
    return parseSandboxImages(res.data);
  } catch {
    return [];
  }
};

/**
 * 可执行 skill 的 draft 资产 + exec 配置数据层。
 * 三条独立请求：资产清单 / exec 配置（404=非可执行）/ 镜像白名单（失败=降级手输）。
 */
export function useSkillAssets(skillId: number | null, enabled: boolean) {
  const key = enabled && skillId ? skillId : null;

  const assets = useSWR(key ? `/api/v1/skills/${key}/assets?stage=draft` : null, listFetcher, {
    revalidateOnFocus: false,
  });
  const execConfig = useSWR(
    key ? `/api/v1/skills/${key}/exec-config?stage=draft` : null,
    execConfigFetcher,
    { revalidateOnFocus: false, shouldRetryOnError: false }
  );
  const images = useSWR(key ? "/api/v1/sandbox-images" : null, imagesFetcher, {
    revalidateOnFocus: false,
    shouldRetryOnError: false,
  });

  const [uploading, setUploading] = useState(false);
  const [uploadedCount, setUploadedCount] = useState(0);

  /** 逐个 PUT（后端就是单文件端点），任一失败不中断其余文件 */
  const uploadAssets = useCallback(
    async (items: AssetUploadItem[]): Promise<AssetUploadResult[]> => {
      if (!skillId || items.length === 0) return [];
      setUploading(true);
      setUploadedCount(0);
      const results: AssetUploadResult[] = [];
      try {
        for (const item of items) {
          try {
            const buffer = await item.file.arrayBuffer();
            await axios.put(
              `/api/v1/skills/${skillId}/assets/${encodeAssetPath(item.path)}`,
              { kind: item.kind, content_base64: arrayBufferToBase64(buffer) },
              { suppressErrorToast: true } as never
            );
            results.push({ path: item.path, ok: true });
          } catch (error) {
            results.push({ path: item.path, ok: false, detail: detailOf(error) });
          }
          setUploadedCount((n) => n + 1);
        }
      } finally {
        setUploading(false);
      }
      await assets.mutate();
      return results;
    },
    [skillId, assets.mutate]
  );

  const deleteAsset = useCallback(
    async (path: string): Promise<AssetUploadResult> => {
      if (!skillId) return { path, ok: false, detail: "no skill" };
      try {
        await axios.delete(`/api/v1/skills/${skillId}/assets/${encodeAssetPath(path)}`, {
          suppressErrorToast: true,
        } as never);
        await assets.mutate();
        return { path, ok: true };
      } catch (error) {
        return { path, ok: false, detail: detailOf(error) };
      }
    },
    [skillId, assets.mutate]
  );

  const saveExecConfig = useCallback(
    async (payload: SkillExecConfigPayload): Promise<{ ok: boolean; detail?: string }> => {
      if (!skillId) return { ok: false, detail: "no skill" };
      try {
        const res = await axios.put(`/api/v1/skills/${skillId}/exec-config`, payload, {
          suppressErrorToast: true,
        } as never);
        await execConfig.mutate(parseExecConfig(res.data), { revalidate: false });
        return { ok: true };
      } catch (error) {
        return { ok: false, detail: detailOf(error) };
      }
    },
    [skillId, execConfig.mutate]
  );

  const items: SkillAssetItem[] = assets.data?.items ?? [];
  return {
    items,
    totalBytes: assets.data?.total_bytes ?? 0,
    assetsLoading: assets.isLoading,
    assetsError: assets.error,
    execConfig: execConfig.data ?? null,
    execConfigLoading: execConfig.isLoading,
    images: images.data ?? [],
    imagesUnavailable: !images.isLoading && (images.data?.length ?? 0) === 0,
    uploading,
    uploadedCount,
    uploadAssets,
    deleteAsset,
    saveExecConfig,
    refresh: assets.mutate,
  };
}
