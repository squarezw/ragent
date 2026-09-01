/**
 * 手机端登录后落到对话页（2026-09-01）。
 *
 * 登录是覆盖层，登录成功不改 URL —— 手机上打开首页登录完，看到的是桌面版
 * 仪表盘的几张图表。这里的判断错一格，症状是「分享的链接在手机上打不开」
 * 或者「侧边栏首页点不进去」，两种都不会报错。
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { MOBILE_BREAKPOINT, shouldLandOnChat } from "../lib/postLoginLanding.ts";

const PHONE = 430; // iPhone 14 Pro Max
const DESKTOP = 1440;

test("手机上在首页登录 → 跳对话页", () => {
  assert.equal(shouldLandOnChat({ pathname: "/", search: "", viewportWidth: PHONE }), true);
});

test("桌面上不跳——首页在宽屏上是有用的", () => {
  assert.equal(shouldLandOnChat({ pathname: "/", search: "", viewportWidth: DESKTOP }), false);
});

test("断点上恰好等于 768 算桌面，与 use-mobile 同一条线", () => {
  assert.equal(
    shouldLandOnChat({ pathname: "/", search: "", viewportWidth: MOBILE_BREAKPOINT }),
    false
  );
  assert.equal(
    shouldLandOnChat({ pathname: "/", search: "", viewportWidth: MOBILE_BREAKPOINT - 1 }),
    true
  );
});

test("从深链接进来登录的，留在原页", () => {
  for (const p of ["/skills/31", "/chat", "/apps/34", "/system-settings"]) {
    assert.equal(
      shouldLandOnChat({ pathname: p, search: "", viewportWidth: PHONE }),
      false,
      `${p} 被劫持到 chat，等于分享链接在手机上失效`
    );
  }
});

test("带 ?redirect= 时不跳——那是个已经确定的目的地", () => {
  assert.equal(
    shouldLandOnChat({ pathname: "/", search: "?redirect=%2Fapi%2Fuploads%2Fabc", viewportWidth: PHONE }),
    false
  );
});

test("首页带其它查询参数照跳", () => {
  assert.equal(
    shouldLandOnChat({ pathname: "/", search: "?from=qr&utm=wechat", viewportWidth: PHONE }),
    true
  );
});

test("末尾斜杠不改变行为", () => {
  assert.equal(shouldLandOnChat({ pathname: "//", search: "", viewportWidth: PHONE }), true);
  assert.equal(shouldLandOnChat({ pathname: "", search: "", viewportWidth: PHONE }), true);
});

test("路径以 / 开头但不是首页的，不该被当成首页", () => {
  assert.equal(shouldLandOnChat({ pathname: "/chat/", search: "", viewportWidth: PHONE }), false);
});

test("空的 redirect 参数不算目的地", () => {
  // ?redirect= 是空串，跳回去等于跳到空地址
  assert.equal(shouldLandOnChat({ pathname: "/", search: "?redirect=", viewportWidth: PHONE }), true);
});

test("断点与 use-mobile 同值", () => {
  // 两处分叉会造出一个宽度区间：侧边栏按手机版收起，却不跳 chat。
  // 上面的边界测试用符号写，改常量时期望值跟着一起动，抓不到这个。
  const src = readFileSync(
    new URL("../hooks/use-mobile.tsx", import.meta.url),
    "utf-8"
  );
  const m = src.match(/const MOBILE_BREAKPOINT = (\d+)/);
  assert.ok(m, "use-mobile 里找不到 MOBILE_BREAKPOINT");
  assert.equal(
    Number(m![1]),
    MOBILE_BREAKPOINT,
    "两处断点不一致，会出现「侧边栏收起了却没跳 chat」的宽度区间"
  );
});

test("AuthGate 真的调了这个判断，且只在登录成功那一下", () => {
  // 纯函数写对了不等于接上了。而且位置要对：放进 loggedIn 的 effect 里，
  // 带 token 每次打开都会跳，侧边栏「首页」在手机上就永远点不进去。
  const src = readFileSync(
    new URL("../app/components/AuthGate.tsx", import.meta.url),
    "utf-8"
  );
  assert.match(src, /shouldLandOnChat\(/, "AuthGate 没有调用这个判断");
  const handler = src.slice(src.indexOf("const handleLogin"));
  const body = handler.slice(0, handler.indexOf("}, ["));
  assert.match(body, /shouldLandOnChat\(/, "判断不在 handleLogin 里");
  assert.match(body, /MOBILE_LANDING_PATH/, "没有跳到对话页");
});
