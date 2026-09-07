import { requireAuth } from "@/lib/auth";
import type { NextApiRequest, NextApiResponse } from "next";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (!requireAuth(req, res)) return;

  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  const { url, payload, auth, credential } = req.body ?? {};

  if (typeof url !== "string" || !url.trim()) {
    return res.status(400).json({ error: "缺少接收 URL" });
  }

  let target: URL;
  try {
    target = new URL(url.trim());
  } catch {
    return res.status(400).json({ error: "接收 URL 格式不正确" });
  }

  if (!['http:', 'https:'].includes(target.protocol)) {
    return res.status(400).json({ error: "接收 URL 仅支持 http 或 https" });
  }

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };

  if (auth === "Token 验证" && typeof credential === "string" && credential.trim()) {
    headers.Authorization = `Bearer ${credential.trim()}`;
  }

  if (auth === "自定义请求头" && typeof credential === "string") {
    const index = credential.indexOf(":");
    if (index > 0) {
      const key = credential.slice(0, index).trim();
      const value = credential.slice(index + 1).trim();
      if (key && value) headers[key] = value;
    }
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);

  try {
    const response = await fetch(target.toString(), {
      method: "POST",
      headers,
      body: JSON.stringify(payload ?? {}),
      signal: controller.signal,
    });

    const text = await response.text();

    if (!response.ok) {
      return res.status(502).json({
        error: "接收系统返回失败状态",
        detail: `HTTP ${response.status}${text ? ` - ${text.slice(0, 300)}` : ""}`,
      });
    }

    return res.status(200).json({
      success: true,
      target_status: response.status,
      target_response: text.slice(0, 500),
    });
  } catch (error: any) {
    return res.status(502).json({
      error: "结果发送失败",
      detail: error?.name === "AbortError" ? "接收 URL 请求超时" : error?.message || "Unknown error",
    });
  } finally {
    clearTimeout(timeout);
  }
}
