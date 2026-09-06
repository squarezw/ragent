import assert from "node:assert/strict";
import { test } from "node:test";
import { centerItemScrollLeft, isFullyVisible } from "../lib/horizontalScroll.ts";

/**
 * 员工快捷条的滚动定位（2026-09-06）。
 *
 * 现象：选了一个排在后面的员工，下次进来列表停在最左端，选中项在视野外——
 * 四个可见的标签全是灰的，看起来像"谁都没选"。
 */

const G = (o: Partial<Parameters<typeof centerItemScrollLeft>[0]> = {}) => ({
  containerWidth: 480,
  contentWidth: 1200,
  itemOffset: 600,
  itemWidth: 100,
  ...o,
});

test("把目标项居中", () => {
  // 600 - (480-100)/2 = 600 - 190 = 410
  assert.equal(centerItemScrollLeft(G()), 410);
});

test("最前面的项不会算出负数", () => {
  // 0 - 190 = -190，必须夹到 0
  assert.equal(centerItemScrollLeft(G({ itemOffset: 0 })), 0);
});

test("最后一项不会滚过内容末尾", () => {
  // 内容 1200、容器 480 → 最大 720。居中公式给 1100-190=910，要夹到 720
  assert.equal(centerItemScrollLeft(G({ itemOffset: 1100 })), 720);
});

test("内容比容器窄时不滚", () => {
  assert.equal(centerItemScrollLeft(G({ contentWidth: 300, itemOffset: 100 })), 0);
});

test("已经完整可见就判定为不需要滚", () => {
  // 容器 [0,480)，项在 [100,200) 内
  assert.ok(isFullyVisible(G({ itemOffset: 100 }), 0));
  // 项右边缘超出容器右边界
  assert.ok(!isFullyVisible(G({ itemOffset: 450 }), 0));
  // 项左边缘在当前滚动位置左侧
  assert.ok(!isFullyVisible(G({ itemOffset: 50 }), 100));
});

test("边界项恰好贴边也算可见", () => {
  // 项占 [380,480)，容器 [0,480) —— 右边缘正好相等
  assert.ok(isFullyVisible(G({ itemOffset: 380 }), 0));
});

// ── 组件接线（结构性检查）──

import fs from "node:fs";
import path from "node:path";
const REPO = path.resolve(import.meta.dirname, "..");
const COMPONENT = fs.readFileSync(
  path.join(REPO, "app/chat/components/AppShortcuts.tsx"), "utf8");

test("按钮带 data-app-id，定位才找得到", () => {
  // 靠它 querySelector；漏了的话 effect 静默 return，滚动就永远不发生
  assert.match(COMPONENT, /data-app-id=\{app\.id\}/);
});

test("定位只做一次，不在每次选择变化时滚", () => {
  assert.match(COMPONENT, /didInitialScrollRef/,
    "缺少一次性守卫：用户点了某个员工后还会被再滚一次，是无谓跳动");
  assert.match(COMPONENT, /if \(didInitialScrollRef\.current\) return;/);
});

/** 精确取出那个定位 effect —— 按稳定边界切，不靠出现次数。
 *  第一版用 split("didInitialScrollRef")[2]，而这个名字出现三次（注释/声明/守卫），
 *  切出来的根本不是 effect 体，断言等于在看别处。 */
function locateEffect(): string {
  const start = COMPONENT.indexOf("const didInitialScrollRef = useRef(false);");
  const end = COMPONENT.indexOf("const scroll = useCallback", start);
  assert.ok(start !== -1 && end !== -1 && end > start, "找不到定位 effect");
  return COMPONENT.slice(start, end);
}

test("滚动后刷新左右箭头状态", () => {
  // 不刷新的话箭头会停在"还能往左滚吗"的旧判断上
  assert.ok(locateEffect().includes("checkScrollButtons()"),
    "程序化滚动后没有重算箭头显示");
});

test("用瞬时赋值而不是平滑滚动", () => {
  // 恢复位置不是用户触发的动作，平滑滚动看起来像界面自己在动
  const eff = locateEffect();
  assert.match(eff, /container\.scrollLeft = centerItemScrollLeft\(geometry\)/);
  assert.ok(!/behavior:\s*"smooth"/.test(eff), "恢复位置用了平滑滚动");
});


// ── padding 与测量方式（2026-09-06 第二轮：滚了但只露一半）──

test("居中时扣掉被箭头盖住的左右内边距", () => {
  // 容器 480，两侧各 32 给箭头 → 真正能看清的只有 416。
  // 项在 600、宽 100：600 - 32 - (416-100)/2 = 600 - 32 - 158 = 410
  assert.equal(
    centerItemScrollLeft({
      containerWidth: 480, contentWidth: 1200,
      itemOffset: 600, itemWidth: 100, padStart: 32, padEnd: 32,
    }),
    410,
  );
});

test("可见性判断也要扣 padding，否则被箭头盖住的项被判成可见", () => {
  // 项占 [1280,1380)，滚到底 920 时可视区是 [952, 1368) —— 右边缘超出
  const g = {
    containerWidth: 480, contentWidth: 1400,
    itemOffset: 1280, itemWidth: 100, padStart: 32, padEnd: 32,
  };
  assert.equal(isFullyVisible(g, 920), false, "被箭头盖住却判成可见 → 永远不会去滚它");
  // 不扣 padding 的旧判据会误判成可见，这正是第一版没修好的原因
  assert.equal(isFullyVisible({ ...g, padStart: 0, padEnd: 0 }, 920), true);
});

test("padding 缺省为 0，老调用方行为不变", () => {
  assert.equal(
    centerItemScrollLeft({
      containerWidth: 480, contentWidth: 1200, itemOffset: 600, itemWidth: 100,
    }),
    410,
  );
});

test("用 rect 测量，不用 offsetLeft", () => {
  // 按钮的 offsetParent 是外层 relative 容器（滚动容器自身没有 position），
  // offsetLeft 量的不是滚动内容坐标系里的偏移 —— 第一版就错在这里。
  const eff = locateEffect();
  assert.match(eff, /getBoundingClientRect\(\)/);
  // 排除注释行：解释"为什么不用 offsetLeft"本身是有价值的，不该被这条禁掉
  const code = eff.split("\n").filter((l) => !l.trim().startsWith("//")).join("\n");
  assert.ok(!/offsetLeft/.test(code), "又用回了 offsetLeft");
  assert.match(eff, /\+ container\.scrollLeft/, "偏移没有加回当前滚动位置");
});

test("推迟一帧再量，等箭头带来的 padding 变化落定", () => {
  // 内边距取决于箭头是否显示（4px vs 32px），而那两个状态由另一个 effect 设置。
  // 同一轮里量到的可能还是箭头出现前的 4px。
  const eff = locateEffect();
  assert.match(eff, /requestAnimationFrame\(/);
  assert.match(eff, /cancelAnimationFrame\(raf\)/, "缺少清理，卸载后仍会操作 DOM");
});

test("padding 从计算样式读，不写死 32", () => {
  const eff = locateEffect();
  assert.match(eff, /getComputedStyle\(container\)/);
  assert.ok(!/padStart: 32/.test(eff), "写死了内边距，箭头隐藏时是 4px 就错了");
});