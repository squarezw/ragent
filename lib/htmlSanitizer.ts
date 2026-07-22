import DOMPurify from "isomorphic-dompurify";

/**
 * HTML 清理配置
 * 最大 HTML 长度：50KB
 */
const MAX_HTML_LENGTH = 50 * 1024; // 50KB

/**
 * DOMPurify 配置：允许的 HTML 标签和属性白名单
 */
const DOMPURIFY_CONFIG = {
  ALLOWED_TAGS: [
    "div",
    "p",
    "h1",
    "h2",
    "h3",
    "h4",
    "h5",
    "h6",
    "span",
    "strong",
    "em",
    "b",
    "i",
    "u",
    "s",
    "ul",
    "ol",
    "li",
    "a",
    "img",
    "br",
    "hr",
    "style",
  ],
  ALLOWED_ATTR: [
    "class",
    "id",
    "style",
    "href",
    "target",
    "rel", // 链接属性
    "src",
    "alt",
    "title",
    "width",
    "height", // 图片属性
  ],
  ALLOWED_URI_REGEXP:
    /^(?:(?:(?:f|ht)tps?|mailto|tel|callto|sms|cid|xmpp|data):|[^a-z]|[a-z+.-]+(?:[^a-z+.\-:]|$))/i,
  KEEP_CONTENT: true,
  RETURN_DOM: false,
  RETURN_DOM_FRAGMENT: false,
  RETURN_TRUSTED_TYPE: false,
  SAFE_FOR_TEMPLATES: false,
  SANITIZE_DOM: true,
  FORBID_TAGS: ["script", "iframe", "object", "embed", "form", "input", "button"],
  FORBID_ATTR: ["onerror", "onload", "onclick", "onmouseover", "onfocus", "onblur"],
  // 允许 style 标签中的 CSS
  ALLOW_DATA_ATTR: false,
  // 清理 style 属性中的危险内容
  SAFE_FOR_XML: false,
};

/**
 * 转义 HTML 特殊字符，防止 XSS
 */
export function escapeHtml(text: string | null | undefined): string {
  if (!text) return "";
  const map: Record<string, string> = {
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;",
  };
  return text.replace(/[&<>"']/g, (m) => map[m]);
}

/**
 * 清理和验证 HTML 内容
 * @param html 原始 HTML 字符串
 * @returns 清理后的 HTML 字符串，如果输入无效则返回空字符串
 */
export function sanitizeHtml(html: string | null | undefined): string {
  if (!html) return "";

  // 检查长度限制
  if (html.length > MAX_HTML_LENGTH) {
    console.warn(`HTML 内容超过最大长度限制 (${MAX_HTML_LENGTH} 字节)`);
    return "";
  }

  try {
    // 使用 DOMPurify 清理 HTML
    const cleaned = DOMPurify.sanitize(html, DOMPURIFY_CONFIG);
    return cleaned;
  } catch (error) {
    console.error("HTML 清理失败:", error);
    return "";
  }
}

/**
 * 替换模板变量并清理 HTML
 * @param template HTML 模板，包含 {{variableName}} 占位符
 * @param variables 变量对象，键为变量名（不含花括号），值为要替换的值
 * @returns 清理后的 HTML 字符串
 */
export function renderTemplate(
  template: string | null | undefined,
  variables: Record<string, string | null | undefined>
): string {
  if (!template) return "";

  // 先转义变量值，防止 XSS
  const escapedVariables: Record<string, string> = {};
  for (const [key, value] of Object.entries(variables)) {
    escapedVariables[key] = escapeHtml(value?.toString() || "");
  }

  // 替换变量占位符
  let result = template;
  for (const [key, value] of Object.entries(escapedVariables)) {
    const regex = new RegExp(`\\{\\{${key}\\}\\}`, "g");
    result = result.replace(regex, value);
  }

  // 清理 HTML
  return sanitizeHtml(result);
}

/**
 * 验证 HTML 长度
 * @param html HTML 字符串
 * @returns 是否在长度限制内
 */
export function validateHtmlLength(html: string | null | undefined): boolean {
  if (!html) return true;
  return html.length <= MAX_HTML_LENGTH;
}

/**
 * 获取最大 HTML 长度限制（字节）
 */
export function getMaxHtmlLength(): number {
  return MAX_HTML_LENGTH;
}

/**
 * HTML 有效性校验结果
 */
export interface HtmlValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

/**
 * 验证 HTML 的基本有效性
 * 检查标签是否正确闭合、是否有无效的标签等
 * @param html HTML 字符串
 * @returns 校验结果，包含是否有效和错误/警告信息
 */
export function validateHtml(html: string | null | undefined): HtmlValidationResult {
  const result: HtmlValidationResult = {
    valid: true,
    errors: [],
    warnings: [],
  };

  if (!html || !html.trim()) {
    return result; // 空内容视为有效
  }

  // 检查长度
  if (html.length > MAX_HTML_LENGTH) {
    result.errors.push(`HTML 内容超过最大长度限制 (${MAX_HTML_LENGTH} 字节)`);
    result.valid = false;
  }

  // 自闭合标签列表
  const selfClosingTags = new Set([
    "area",
    "base",
    "br",
    "col",
    "embed",
    "hr",
    "img",
    "input",
    "link",
    "meta",
    "param",
    "source",
    "track",
    "wbr",
  ]);

  // 提取所有标签
  const tagRegex = /<\/?([a-zA-Z][a-zA-Z0-9]*)\s*[^>]*\/?>/g;
  const stack: { tag: string; pos: number }[] = [];
  let match: RegExpExecArray | null;

  while ((match = tagRegex.exec(html)) !== null) {
    const fullMatch = match[0];
    const tagName = match[1].toLowerCase();
    const isClosingTag = fullMatch.startsWith("</");
    const isSelfClosing = fullMatch.endsWith("/>") || selfClosingTags.has(tagName);

    if (isClosingTag) {
      // 闭合标签
      if (stack.length === 0) {
        result.errors.push(`多余的闭合标签: </${tagName}>`);
        result.valid = false;
      } else {
        const last = stack[stack.length - 1];
        if (last.tag === tagName) {
          stack.pop();
        } else {
          // 查找是否有匹配的开始标签
          const matchIndex = stack.findIndex((s) => s.tag === tagName);
          if (matchIndex >= 0) {
            // 存在匹配，但中间有未闭合的标签
            const unclosed = stack
              .slice(matchIndex + 1)
              .map((s) => `<${s.tag}>`)
              .join(", ");
            result.errors.push(
              `标签闭合顺序错误: 在 </${tagName}> 之前有未闭合的标签: ${unclosed}`
            );
            result.valid = false;
            // 弹出到匹配位置
            stack.splice(matchIndex);
          } else {
            result.errors.push(`多余的闭合标签: </${tagName}>（没有对应的开始标签）`);
            result.valid = false;
          }
        }
      }
    } else if (!isSelfClosing) {
      // 非自闭合的开始标签
      stack.push({ tag: tagName, pos: match.index });
    }
  }

  // 检查是否有未闭合的标签
  if (stack.length > 0) {
    const unclosed = stack.map((s) => `<${s.tag}>`).join(", ");
    result.errors.push(`未闭合的标签: ${unclosed}`);
    result.valid = false;
  }

  // 检查是否包含危险标签（警告）
  const dangerousTags = ["script", "iframe", "object", "embed", "form"];
  for (const tag of dangerousTags) {
    const regex = new RegExp(`<${tag}\\b`, "i");
    if (regex.test(html)) {
      result.warnings.push(`包含不安全的标签 <${tag}>，将被自动移除`);
    }
  }

  // 检查是否包含事件处理器（警告）
  const eventHandlerRegex = /\s+on\w+\s*=/i;
  if (eventHandlerRegex.test(html)) {
    result.warnings.push("包含事件处理器属性（如 onclick），将被自动移除");
  }

  return result;
}
