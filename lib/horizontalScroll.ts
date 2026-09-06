/**
 * 把横向列表里的某一项滚进视野。
 *
 * 抽成纯函数是为了能真正测：算错了在界面上表现为"滚过头露出半个"或"根本没动"，
 * 靠肉眼看截图很难判定，而这里给定数字就能断言。
 */
export interface ScrollGeometry {
  /** 容器可视宽度（clientWidth，**含左右 padding**） */
  containerWidth: number;
  /** 容器内容总宽度（scrollWidth） */
  contentWidth: number;
  /** 目标项在滚动内容坐标系里的左偏移 */
  itemOffset: number;
  /** 目标项自身宽度 */
  itemWidth: number;
  /** 左内边距。箭头按钮浮在容器两侧，这段是被它盖住的区域 */
  padStart?: number;
  /** 右内边距 */
  padEnd?: number;
}

/**
 * 返回让目标项在**未被遮挡的那段可视区**里居中的 scrollLeft，夹在合法范围内。
 *
 * ## padding 必须扣掉
 *
 * 容器在箭头可见时有 32px 的左右内边距，`clientWidth` 把它算在内。按整个
 * clientWidth 居中，靠边的项会被箭头盖住一半 —— 2026-09-06 实际就是这个现象：
 * 滚是滚了，选中项贴在右边缘只露出一半。
 *
 * ## 两端必须夹住
 *
 * 不夹的话最前面的项算出负数、最后一项算出超过内容宽度的值。浏览器会自己夹，
 * 但那样这段逻辑本身就是错的，也没法从返回值判断算得对不对。
 */
export function centerItemScrollLeft(g: ScrollGeometry): number {
  const padStart = g.padStart ?? 0;
  const padEnd = g.padEnd ?? 0;
  const maxScroll = Math.max(0, g.contentWidth - g.containerWidth);
  // 真正能看清的宽度：扣掉被箭头盖住的两段
  const usable = Math.max(0, g.containerWidth - padStart - padEnd);
  const centered = g.itemOffset - padStart - (usable - g.itemWidth) / 2;
  return Math.round(Math.min(Math.max(centered, 0), maxScroll));
}

/**
 * 目标项当前是否**完整落在未被遮挡的可视区**里——已经看得见就不要滚，
 * 无谓的跳动很扎眼。
 *
 * 判据用的是扣掉 padding 后的区间：只判 clientWidth 的话，一个被箭头盖住一半的项
 * 会被判成"可见"，于是永远不会被滚出来。
 */
export function isFullyVisible(g: ScrollGeometry, scrollLeft: number): boolean {
  const padStart = g.padStart ?? 0;
  const padEnd = g.padEnd ?? 0;
  const visibleStart = scrollLeft + padStart;
  const visibleEnd = scrollLeft + g.containerWidth - padEnd;
  return g.itemOffset >= visibleStart && g.itemOffset + g.itemWidth <= visibleEnd;
}
