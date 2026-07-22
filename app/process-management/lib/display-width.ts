/**
 * 按"显示宽度"计算字符串长度（命名规则 §3.7）：
 *   中文/全角字符计 2，英文/数字等计 1
 * 保持与 docfuse extract.py `_display_width` 一致。两处修改需同步。
 */
export function displayWidth(text: string): number {
  let width = 0;
  for (const ch of text) {
    const code = ch.codePointAt(0) ?? 0;
    width +=
      (code >= 0x4e00 && code <= 0x9fff) || // CJK 统一汉字
      (code >= 0x3400 && code <= 0x4dbf) || // CJK 扩展 A
      (code >= 0x3000 && code <= 0x303f) || // CJK 符号
      (code >= 0xff00 && code <= 0xffef)    // 全角 ASCII
        ? 2
        : 1;
  }
  return width;
}

/** 命名规则 §3.7：AI 总结显示宽度上限（= 20 个汉字） */
export const AI_SUMMARY_MAX_WIDTH = 40;
