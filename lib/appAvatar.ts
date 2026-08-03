/**
 * 数字员工头像。
 *
 * `apps.avatar_url` 存的是**一个 URL 字符串**，两种来源共用一列：
 *   · 内置头像 → `/avatars/<name>.svg`（随代码走的静态资源）
 *   · 用户上传 → `/api/oss/app-avatars/...`（OSS 读代理）
 * 浏览器眼里它们是同一种东西，所以渲染侧不做来源判断，直接塞 <img src>。
 *
 * 没设头像（绝大多数存量应用）不留空白，回落到"名称首字 + 一个按名字定死的底色"。
 * 底色必须**由名字算出来**而不是随机或按 id：同一个数字员工在列表、详情、聊天里
 * 得是同一个颜色，否则用户会以为看到的是两个不同的东西。
 */

/** 内置头像。value 就是存进 avatar_url 的那截路径。 */
export const BUILTIN_AVATARS = [
  "/avatars/bot.svg",
  "/avatars/support.svg",
  "/avatars/analyst.svg",
  "/avatars/reviewer.svg",
  "/avatars/writer.svg",
  "/avatars/engineer.svg",
  "/avatars/finance.svg",
  "/avatars/scheduler.svg",
] as const;

/** 上传头像在 OSS 里的分类目录 */
export const AVATAR_OSS_CATEGORY = "app-avatars";

/** 上传限制：头像就该是张小图，5MB 已经很宽松 */
export const AVATAR_MAX_BYTES = 5 * 1024 * 1024;

/**
 * 占位文字：取名称的第一个字符。
 *
 * 中文取一个字就够（"财经助理"→"财"），英文名同理取首字母。不取两个字符：
 * 小尺寸圆角块里塞两个汉字会挤成一团黑。
 */
export function avatarFallbackText(name: string | undefined | null): string {
  const trimmed = (name ?? "").trim();
  if (!trimmed) return "?";
  // 用 Array.from 而不是 [0]：emoji 和部分生僻字是代理对，按 UTF-16 下标切会拿到半个字符
  return Array.from(trimmed)[0].toUpperCase();
}

/** 是内置头像吗（决定选择器里哪一格显示为选中） */
export function isBuiltinAvatar(url: string | undefined | null): boolean {
  return !!url && (BUILTIN_AVATARS as readonly string[]).includes(url);
}

/**
 * 上传前把文件改成唯一名。
 *
 * OSS 的 objectKey = `<category>/<年月>/<原文件名>`，**服务端不做去重**（实测：
 * 同名两次 presign 返回同一个 key）。头像又是重名重灾区——大家都叫 avatar.png、
 * logo.png、头像.png。撞上了不会报错，只会让一个数字员工的脸悄悄变成另一个的，
 * 而且先传的那个人永远不知道。
 *
 * 扩展名保留：OSS 按后缀推 content-type，丢了浏览器可能当附件下载而不是显示。
 */
export function uniqueAvatarFilename(originalName: string): string {
  const m = /\.[a-zA-Z0-9]{1,8}$/.exec(originalName || "");
  const ext = m ? m[0].toLowerCase() : "";
  const rand =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : // 老浏览器兜底：时间戳＋随机串，重复概率同样可以忽略
        `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  return `${rand}${ext}`;
}
