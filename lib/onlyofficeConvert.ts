import axios from "axios";
import jwt from "jsonwebtoken";
import { requireEnv } from "./env";

// 服务端访问 OnlyOffice 必须用容器内可达的地址。不回退 localhost ——
// 那是宿主机调试地址，容器内不可达（kkFileView 时期踩过同样的坑），没配就早早抛错。
function getOnlyofficeUrl(): string {
  const url = process.env.ONLYOFFICE_INTERNAL_URL || process.env.ONLYOFFICE_URL;
  if (!url) {
    throw new Error(
      "ONLYOFFICE_INTERNAL_URL (or ONLYOFFICE_URL) is required for server-side docx→pdf conversion."
    );
  }
  return url.replace(/\/+$/, "");
}

// 100 MB 上限：正常 docx 转出来的 PDF 远小于此；超过基本是转换出了异常产物。
const PDF_MAX_BYTES = 100 * 1024 * 1024;

export interface OnlyofficeConvertOptions {
  /** OnlyOffice 容器可访问的 docx 下载 URL（web 代理签名 URL 或 OSS 签名 URL） */
  sourceUrl: string;
  /** ConvertService 缓存 key：必须随内容变化而变化（建议用源文件内容哈希） */
  cacheKey: string;
  /** 总转换超时预算（包含 ConvertService + 拉 PDF 两段），默认 120s */
  timeoutMs?: number;
}

/**
 * 通过 OnlyOffice Document Server 的 ConvertService.ashx 将 docx 转成 PDF。
 * 同步转换（async=false），返回 PDF 二进制 Buffer。转换失败直接抛错。
 *
 * 注意：OnlyOffice 转出的 PDF **不含标题书签**（DocumentServer#2062），
 * 业务侧请走 lib/docxToPdf.ts —— 它在转换后用源 docx 的标题反向注入书签。
 *
 * timeoutMs 是**总预算**：两段请求共享同一个 deadline，避免各自 timeoutMs 翻倍。
 */
export async function onlyofficeConvertDocxToPdf(opts: OnlyofficeConvertOptions): Promise<Buffer> {
  const { sourceUrl, cacheKey, timeoutMs = 120_000 } = opts;
  const onlyofficeUrl = getOnlyofficeUrl();
  const deadline = Date.now() + timeoutMs;

  const payload = {
    async: false,
    filetype: "docx",
    key: cacheKey,
    outputtype: "pdf",
    url: sourceUrl,
  };
  const token = jwt.sign(payload, requireEnv("ONLYOFFICE_JWT_SECRET"), { algorithm: "HS256" });

  const convertResp = await axios.post(
    `${onlyofficeUrl}/ConvertService.ashx`,
    { ...payload, token },
    { headers: { "Content-Type": "application/json" }, timeout: remainingMs(deadline) }
  );

  const result = convertResp.data;
  if (!result?.endConvert || !result?.fileUrl) {
    throw new Error(
      `OnlyOffice conversion incomplete: endConvert=${result?.endConvert}, error=${result?.error ?? "none"}`
    );
  }

  const fileResp = await axios.get(result.fileUrl, {
    responseType: "arraybuffer",
    timeout: remainingMs(deadline),
    maxContentLength: PDF_MAX_BYTES,
    maxBodyLength: PDF_MAX_BYTES,
  });
  return Buffer.from(fileResp.data);
}

/** 共享 deadline 的剩余预算；耗尽即抛。docx→pdf 全链路（下载/转换/取产物）共用。 */
export function remainingMs(deadline: number): number {
  const r = deadline - Date.now();
  if (r <= 0) {
    throw new Error("docx→pdf conversion exceeded total timeout budget");
  }
  return r;
}
