/**
 * URL加密/解密工具
 * 使用Fernet (AES-128-CBC) 对称加密
 */

import crypto from "crypto";
const fernet = require("fernet");

const SALT = Buffer.from("ragent_salt_2025"); // 必须与后端一致
const ITERATIONS = 100000;
const KEY_LENGTH = 32;

/**
 * 从密钥派生Fernet密钥（与后端保持一致）
 */
function deriveFernetKey(secret: string): string {
  const derivedKey = crypto.pbkdf2Sync(secret, SALT, ITERATIONS, KEY_LENGTH, "sha256");

  // Python的Fernet需要base64 URL-safe编码的密钥
  return derivedKey.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
}

/**
 * 解析URL编码的参数字符串为对象
 * 格式: key1=value1&key2=value2
 */
function parseParams(paramString: string): Record<string, string> {
  const params: Record<string, string> = {};
  const pairs = paramString.split("&");

  for (const pair of pairs) {
    if (pair.includes("=")) {
      const [key, value] = pair.split("=", 2);
      params[key] = decodeURIComponent(value.replace(/\+/g, " "));
    }
  }

  return params;
}

/**
 * 解密Fernet格式的token
 * @param token - Base64编码的加密token（不带padding的URL-safe格式）
 * @param secret - 加密密钥
 * @returns 解密后的数据对象
 */
export function decryptFeedbackToken(
  token: string,
  secret: string
): {
  wechat_id: string;
  detail_id: number;
  action: "good" | "bad";
} {
  try {
    // 1. 补充Base64 padding
    const padding = 4 - (token.length % 4);
    if (padding !== 4) {
      token += "=".repeat(padding);
    }

    // 2. 第一次Base64解码（Python做了二次base64编码）
    const fernetTokenBytes = Buffer.from(token, "base64");

    // 3. Fernet token本身是base64编码的字符串
    const fernetTokenString = fernetTokenBytes.toString("utf8");

    // 4. 派生Fernet密钥
    const fernetKey = deriveFernetKey(secret);

    // 5. 创建Fernet secret对象
    const secret_obj = new fernet.Secret(fernetKey);

    // 6. 创建Fernet token对象
    const fernetToken = new fernet.Token({
      secret: secret_obj,
      token: fernetTokenString,
      ttl: 0, // 不检查过期时间
    });

    // 7. 解密
    const decrypted = fernetToken.decode();

    // 8. 解析参数（格式: key1=value1&key2=value2）
    const params = parseParams(decrypted);

    // 后端使用user_id，这里映射为wechat_id
    return {
      wechat_id: params.user_id || "", // 后端传的是user_id
      detail_id: parseInt(params.detail_id || "0"),
      action: (params.action as "good" | "bad") || "good",
    };
  } catch (error) {
    console.error("Token decryption failed:", error);
    throw new Error("Invalid or expired token");
  }
}

/**
 * 验证解密后的数据
 */
export function validateDecryptedData(data: any): boolean {
  if (!data.wechat_id || typeof data.wechat_id !== "string") {
    return false;
  }
  if (!data.detail_id || typeof data.detail_id !== "number") {
    return false;
  }
  if (!data.action || !["good", "bad"].includes(data.action)) {
    return false;
  }
  return true;
}
