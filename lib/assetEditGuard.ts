/**
 * 资产在线编辑的准入判断 —— 抽成纯函数才测得到。
 *
 * 两条都关乎「保存会不会悄悄弄坏东西」，而不是界面好不好看：
 *
 * 1. **截断的正文不能保存。** 预览对超长文本只取前 20 万字符，保存它等于把文件
 *    后半截抹掉 —— 而且 PUT 会成功、界面会显示「已保存」，没有任何地方报错。
 * 2. **图片 / Office 不能当文本改。** 把二进制当字符串读进来再写回去，字节已经
 *    在解码那一步就毁了。
 */

export interface AssetEditability {
  /** 调用方是否给了保存能力（无写权限、内置技能都不给） */
  hasWritePermission: boolean;
  /** 正文是否已成功取回（null = 还没取到 / 不是文本） */
  textLoaded: boolean;
  isImage: boolean;
  isOffice: boolean;
  /** 预览内容是否被截断 */
  truncated: boolean;
}

export function canEditAsset(s: AssetEditability): boolean {
  if (!s.hasWritePermission) return false;
  if (!s.textLoaded) return false;
  if (s.isImage || s.isOffice) return false;
  if (s.truncated) return false;
  return true;
}
