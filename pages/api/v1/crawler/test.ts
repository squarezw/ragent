import type { NextApiRequest, NextApiResponse } from "next";
import axios from "axios";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { curl } = req.body;

  if (!curl || typeof curl !== "string") {
    return res.status(400).json({ error: "curl command is required" });
  }

  try {
    // 改进的 curl 解析（支持多种格式和多行）
    const parseCurl = (curlStr: string) => {
      // 先处理多行：移除行尾的反斜杠和换行符
      const normalized = curlStr
        .replace(/\\\s*\n\s*/g, " ") // 将反斜杠+换行替换为空格
        .replace(/\s+/g, " ") // 合并多个空格
        .trim();

      // 提取 HTTP 方法
      const methodMatch = normalized.match(/-X\s+(\w+)/i);
      const method = (methodMatch?.[1] || "GET").toUpperCase();

      // 提取 URL - 匹配 http:// 或 https:// 开头的 URL，支持引号和复杂查询参数
      let url = "";

      // 方法1: 优先匹配引号中的 URL（最可靠）
      const quotedUrlMatch = normalized.match(/['"](https?:\/\/[^'"]+)['"]/);
      if (quotedUrlMatch) {
        url = quotedUrlMatch[1];
      } else {
        // 方法2: 匹配 curl 后面紧跟的 URL（无引号）
        // 查找 curl 关键字后的第一个 URL
        const curlIndex = normalized.toLowerCase().indexOf("curl");
        if (curlIndex >= 0) {
          const afterCurl = normalized.substring(curlIndex + 4).trim();
          // 匹配以 http:// 或 https:// 开头的 URL
          const urlRegex = /(https?:\/\/[^\s]+)/;
          const urlMatch = afterCurl.match(urlRegex);
          if (urlMatch) {
            // 检查 URL 后面是什么字符，如果是参数选项（以 - 开头），则停止
            const urlStartPos = afterCurl.indexOf(urlMatch[1]);
            const urlEndPos = urlStartPos + urlMatch[1].length;
            const afterUrl = afterCurl.substring(urlEndPos).trim();

            // 如果 URL 后面是空格、引号，或者是参数选项（-H, -b, -d 等），说明 URL 完整
            if (afterUrl === "" || afterUrl.startsWith(" ") || afterUrl.startsWith("-")) {
              url = urlMatch[1];
            }
          }
        }

        // 如果还是没找到，尝试在整个字符串中查找第一个 URL
        if (!url) {
          const anyUrlMatch = normalized.match(/(https?:\/\/[^\s'"]+)/);
          if (anyUrlMatch) {
            url = anyUrlMatch[1];
          }
        }
      }

      // 提取 Cookie (从 -b 参数)
      const cookieMatch = normalized.match(/-b\s+(['"])([^'"]+)\1/);
      const cookies = cookieMatch ? cookieMatch[2] : "";

      // 提取 headers
      const headers: Record<string, string> = {};

      // 如果有 Cookie，添加到 headers
      if (cookies) {
        headers["Cookie"] = cookies;
      }

      // 支持 -H "key: value" 和 -H 'key: value'
      // 使用更精确的正则，匹配 -H 后面的引号内容
      const headerRegex = /-H\s+(['"])([^'"]+)\1/g;
      let headerMatch;

      while ((headerMatch = headerRegex.exec(normalized)) !== null) {
        const headerLine = headerMatch[2];
        const colonIndex = headerLine.indexOf(":");
        if (colonIndex > 0) {
          const key = headerLine.substring(0, colonIndex).trim();
          const value = headerLine.substring(colonIndex + 1).trim();
          if (key && value) {
            headers[key] = value;
          }
        }
      }

      // 提取 data
      let data = "";
      // 支持 -d '...', -d "...", --data-raw '...', --data '...'
      const dataPatterns = [
        /-d\s+(['"])([\s\S]*?)\1/,
        /--data-raw\s+(['"])([\s\S]*?)\1/,
        /--data\s+(['"])([\s\S]*?)\1/,
      ];

      for (const pattern of dataPatterns) {
        const match = normalized.match(pattern);
        if (match) {
          data = match[2] || "";
          if (data) break;
        }
      }

      return { method, url, headers, data };
    };

    const parsed = parseCurl(curl.trim());
    const { method, url, headers, data } = parsed;

    if (!url) {
      console.error("[Crawler Test] Failed to parse URL from curl:", {
        curlLength: curl.length,
        curlPreview: curl.substring(0, 200),
        parsed,
      });
      return res.status(400).json({
        error: "Unable to parse URL from curl command",
        message: "无法从 curl 命令中解析出 URL，请确保 URL 格式正确",
        parsed,
      });
    }

    // 发送请求
    const config: any = {
      method,
      url,
      headers: {
        ...headers,
        "User-Agent": "Mozilla/5.0 (compatible; CrawlerTest/1.0)",
      },
      timeout: 30000,
      validateStatus: () => true, // 接受所有状态码
    };

    if (data && (method === "POST" || method === "PUT" || method === "PATCH")) {
      config.data = data;
    }

    const response = await axios(config);

    // 检测是否是 WAF 拦截页面
    let isWAFBlocked = false;
    let wafWarning = "";

    if (response.data && typeof response.data === "string") {
      // 检测阿里云 WAF 特征
      if (
        response.data.includes("aliyun_waf") ||
        response.data.includes("_waf_bd8ce2ce37") ||
        response.data.includes("renderData") ||
        response.data.includes("<!doctype html>")
      ) {
        isWAFBlocked = true;
        wafWarning =
          "⚠️ 检测到 WAF 拦截页面。测试 API 使用简单 HTTP 请求，无法绕过 WAF 保护。实际的后端爬虫服务会使用浏览器自动化工具来绕过 WAF，可以正常获取数据。";
      }
    } else if (
      response.data &&
      typeof response.data === "object" &&
      response.data._waf_bd8ce2ce37
    ) {
      isWAFBlocked = true;
      wafWarning =
        "⚠️ 检测到 WAF 拦截页面。测试 API 使用简单 HTTP 请求，无法绕过 WAF 保护。实际的后端爬虫服务会使用浏览器自动化工具来绕过 WAF。";
    }

    // 返回响应
    return res.status(200).json({
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
      data: response.data,
      isWAFBlocked,
      warning: wafWarning || undefined,
    });
  } catch (error: any) {
    console.error("[Crawler Test] Error:", error.message || error);

    if (error.code === "ECONNREFUSED" || error.code === "ECONNRESET") {
      return res.status(503).json({
        error: "Connection refused",
        message: "无法连接到目标服务器",
      });
    }

    if (error.code === "ETIMEDOUT" || error.message?.includes("timeout")) {
      return res.status(504).json({
        error: "Request timed out",
        message: "请求超时",
      });
    }

    if (error.response) {
      return res.status(200).json({
        status: error.response.status,
        statusText: error.response.statusText,
        headers: error.response.headers,
        data: error.response.data,
      });
    }

    return res.status(500).json({
      error: "Request failed",
      message: error.message || "未知错误",
    });
  }
}
