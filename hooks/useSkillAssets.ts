"use client";

import { useCallback, useMemo, useState } from "react";
import useSWR from "swr";
import axios from "@/lib/axios";
import {
  arrayBufferToBase64,
  encodeAssetPath,
  parseAssetList,
  parseExecConfig,
  parseSandboxImages,
  readableAssetPaths,
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

/** 已发布快照只用于打「模型可读」标；拿不到就不标，不该弹错误吐司 */
const publishedListFetcher = async (url: string) => {
  try {
    return parseAssetList((await axios.get(url, { suppressErrorToast: true } as never)).data);
  } catch {
    return parseAssetList(null);
  }
};

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
 * Skill 资产（draft 清单 + published 快照）与 exec 配置数据层。
 * 四条独立请求：draft 清单 / published 清单（算模型可读集）/ exec 配置（404=非可执行）/
 * 镜像白名单（失败=降级手输）。
 */
export function useSkillAssets(skillId: number | null, enabled: boolean) {
  const key = enabled && skillId ? skillId : null;

  const assets = useSWR(key ? `/api/v1/skills/${key}/assets?stage=draft` : null, listFetcher, {
    revalidateOnFocus: false,
  });
  // 可读性只由已发布快照决定（draft 未过审，skill_view 读不到），故单独取一份
  const publishedAssets = useSWR(
    key ? `/api/v1/skills/${key}/assets?stage=published` : null,
    publishedListFetcher,
    { revalidateOnFocus: false, shouldRetryOnError: false }
  );
  const execConfig = useSWR(
    key ? `/api/v1/skills/${key}/exec-config?stage=draft` : null,
    execConfigFetcher,
    { revalidateOnFocus: false, shouldRetryOnError: false }
  );
  // 线上那份单独取：「skill 已发布」不等于「线上那份是可执行的」——先发布再配可执行、
  // 或已经撤过线上配置，两种情况 status 都是 published 而 published 侧没有行。
  // 「要不要停线上」只能由这份数据回答，拿 status 当判据会把停不掉的东西说成停掉了。
  const execConfigPublished = useSWR(
    key ? `/api/v1/skills/${key}/exec-config?stage=published` : null,
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

  /**
   * 在线编辑：把一份文本原样写回某个资产（draft stage）。
   *
   * 与 uploadAssets 的区别只是入参 —— 那个吃 File，这个吃字符串。后端是同一个
   * PUT（整份 upsert），所以"改了一行"在传输上仍是整份提交；用户感受与实现口径
   * 不同是正常的，不必为此另造一个增量接口。
   *
   * kind 必须**原样回传服务端给的值**（故用宽松的 string，不收窄成 SkillAssetKind）：
   * 后端 PUT 是 upsert，kind 传错会把一份 script 悄悄改判成 reference，它就此不再被
   * 执行且没有任何报错。收窄类型会强迫把未来新增的 kind 映射成某个已知值 —— 那正是
   * 这里要防的"悄悄改判"。
   */
  const saveAssetText = useCallback(
    async (path: string, kind: string, text: string): Promise<AssetUploadResult> => {
      if (!skillId) return { path, ok: false, detail: "no skill" };
      try {
        const bytes = new TextEncoder().encode(text);
        await axios.put(
          `/api/v1/skills/${skillId}/assets/${encodeAssetPath(path)}`,
          { kind, content_base64: arrayBufferToBase64(bytes.buffer as ArrayBuffer) },
          { suppressErrorToast: true } as never
        );
        await assets.mutate();
        return { path, ok: true };
      } catch (error) {
        return { path, ok: false, detail: detailOf(error) };
      }
    },
    [skillId, assets.mutate]
  );

  /**
   * 用一个新文件替换某个已有资产：**路径与 kind 都保持原样**，只换内容。
   *
   * kind 原样回传（宽松的 string，见 saveAssetText 上面那段）：后端 PUT 是
   * upsert，替换时若按新文件名重新推断 kind，把 `scripts/run.py` 换成一个叫
   * `run_v2.py` 的文件就会连带把它从 script 改判成 reference —— 它此后不再被
   * 执行，而替换本身显示成功。替换的语义是"换这一份的内容"，不是"重新登记一份"。
   */
  const replaceAssetFile = useCallback(
    async (path: string, kind: string, file: File): Promise<AssetUploadResult> => {
      if (!skillId) return { path, ok: false, detail: "no skill" };
      try {
        const buffer = await file.arrayBuffer();
        await axios.put(
          `/api/v1/skills/${skillId}/assets/${encodeAssetPath(path)}`,
          { kind, content_base64: arrayBufferToBase64(buffer) },
          { suppressErrorToast: true } as never
        );
        await assets.mutate();
        return { path, ok: true };
      } catch (error) {
        return { path, ok: false, detail: detailOf(error) };
      }
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

  /**
   * 取消可执行。`stage` 决定影响面：
   *   draft     — 只撤草稿，线上照跑（需要再发布一次才真正停掉）
   *   published — 立刻停掉线上执行
   *
   * 返回后端那句 message 原样交给调用方 —— 两个 stage 的后果截然不同，
   * 自己拼一句「已取消」会让用户以为停掉了线上，而实际上没有。
   */
  const deleteExecConfig = useCallback(
    async (stage: "draft" | "published" = "draft"): Promise<{
      ok: boolean; message?: string; detail?: string;
    }> => {
      if (!skillId) return { ok: false, detail: "no skill" };
      try {
        const res = await axios.delete(
          `/api/v1/skills/${skillId}/exec-config?stage=${stage}`,
          { suppressErrorToast: true } as never
        );
        // 撤 draft 后本地那份配置就没了；撤 published 不影响 draft 的展示，
        // 但两种情况都重新拉一次最稳妥 —— 状态由服务端说了算。
        await Promise.all([execConfig.mutate(), execConfigPublished.mutate()]);
        return { ok: true, message: res.data?.message };
      } catch (error) {
        return { ok: false, detail: detailOf(error) };
      }
    },
    [skillId, execConfig.mutate, execConfigPublished.mutate]
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
  const publishedItems = publishedAssets.data?.items;
  const readablePaths = useMemo(() => readableAssetPaths(publishedItems ?? []), [publishedItems]);
  return {
    items,
    /** 已发布快照里模型可读的路径（草稿行据此打标） */
    readablePaths,
    totalBytes: assets.data?.total_bytes ?? 0,
    assetsLoading: assets.isLoading,
    assetsError: assets.error,
    execConfig: execConfig.data ?? null,
    execConfigPublished: execConfigPublished.data ?? null,
    execConfigLoading: execConfig.isLoading,
    images: images.data ?? [],
    imagesUnavailable: !images.isLoading && (images.data?.length ?? 0) === 0,
    uploading,
    uploadedCount,
    uploadAssets,
    saveAssetText,
    replaceAssetFile,
    deleteAsset,
    saveExecConfig,
    deleteExecConfig,
    refresh: assets.mutate,
  };
}
