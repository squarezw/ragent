"use client";

import { avatarFallbackText } from "@/lib/appAvatar";

interface Props {
  /** 头像 URL；空 = 未设置，显示按名称生成的占位 */
  src?: string | null;
  name: string;
  /** 边长（px）。占位文字按边长取比例，保证各尺寸下观感一致 */
  size?: number;
  className?: string;
}

/**
 * 数字员工头像。列表、卡片、详情页、编辑弹窗共用一个，样式规则就不会四处各写一遍
 * 然后慢慢走样——同一个员工在不同页面显示成不同样子是很难察觉却很伤的那种不一致。
 *
 * ## 颜色归属
 *
 * · **选了头像**（内置的或上传的）→ 原样渲染，用它自己的颜色。用户明确挑过的东西
 *   不该被主题覆盖，内置那八张各有一套配色，挑哪张就是哪个颜色。
 * · **没选头像** → 名称首字 + **品牌主色**底（`bg-primary/10` / `text-primary`）。
 *   这是系统替他填的空白，就该跟着品牌走，而不是由我们随便指定一个颜色；租户改了
 *   主色它会跟着变。存量应用全是这一种。
 *
 * 所以两条分支的判据是"有没有 src"，而不是"内置还是上传"——只要是他选的，一律不动色。
 */
export default function AppAvatar({ src, name, size = 40, className = "" }: Props) {
  const box = { width: size, height: size };
  // 圆角跟着尺寸走：固定 rounded-lg 在 24px 上显得太圆、在 64px 上显得太方
  const radius = Math.round(size * 0.28);

  if (src) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={src}
        alt=""
        style={{ ...box, borderRadius: radius }}
        className={`object-cover bg-muted shrink-0 ${className}`}
      />
    );
  }

  return (
    <div
      style={{ ...box, borderRadius: radius, fontSize: Math.round(size * 0.45) }}
      className={`flex items-center justify-center shrink-0 font-semibold bg-primary/10 text-primary ${className}`}
      aria-hidden
    >
      {avatarFallbackText(name)}
    </div>
  );
}
