import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * 验证密码强度
 * 要求：至少8位，包含字母和数字
 * @returns 错误信息，验证通过返回 null
 */
export function validatePassword(password: string): string | null {
  if (password.length < 8) {
    return "密码至少需要8位";
  }
  if (!/[A-Za-z]/.test(password)) {
    return "密码必须包含字母";
  }
  if (!/\d/.test(password)) {
    return "密码必须包含数字";
  }
  return null;
}

/**
 * 清理文本中的空字符和其他不可见字符
 * 解决 PostgreSQL JSON 转换错误：\u0000 cannot be converted to text
 */
export function cleanText(text: string): string {
  if (!text || typeof text !== "string") {
    return text;
  }

  return (
    text
      // 移除空字符 \u0000
      .replace(/\u0000/g, "")
      // 移除其他控制字符（除了换行符和制表符）
      .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "")
      // 移除零宽字符
      .replace(/[\u200B-\u200D\uFEFF]/g, "")
      // 移除其他不可见字符
      .replace(/[\u2060-\u2064\u206A-\u206F]/g, "")
      // 清理多余的空格
      .replace(/\s+/g, " ")
      .trim()
  );
}

/**
 * 清理对象中所有字符串字段的空字符
 */
export function cleanObjectStrings(obj: any): any {
  if (obj === null || obj === undefined) {
    return obj;
  }

  if (typeof obj === "string") {
    return cleanText(obj);
  }

  if (Array.isArray(obj)) {
    return obj.map((item) => cleanObjectStrings(item));
  }

  if (typeof obj === "object") {
    const cleaned: any = {};
    for (const [key, value] of Object.entries(obj)) {
      cleaned[key] = cleanObjectStrings(value);
    }
    return cleaned;
  }

  return obj;
}
