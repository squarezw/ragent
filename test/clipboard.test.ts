import assert from "node:assert/strict";
import { test, afterEach } from "node:test";
import { copyText } from "../lib/clipboard.ts";

/**
 * 这些测试的重点不是"复制成功"，而是**客户内网那条路**：
 * 部署在 http://192.168.80.3:3001 时 navigator.clipboard 是 undefined，
 * 首选路径根本不存在。没有兜底的话按钮点得动、无提示、剪贴板是空的。
 */

// ── 极简假 DOM（本仓测试不带 jsdom，用 node:test 直接跑）──

type FakeEl = {
  value: string;
  style: Record<string, string>;
  setAttribute: (k: string, v: string) => void;
  select: () => void;
  setSelectionRange: (a: number, b: number) => void;
};

let appended: FakeEl[] = [];
let removed: FakeEl[] = [];
let execResult = true;
let execArg: string | null = null;
let focusRestoredTo: string | null = null;

function installFakeDom() {
  appended = [];
  removed = [];
  execArg = null;
  focusRestoredTo = null;

  const activeElement = {
    name: "原本聚焦的输入框",
    focus() {
      focusRestoredTo = this.name;
    },
  };

  defineGlobal("document", {
    activeElement,
    createElement: (): FakeEl => ({
      value: "",
      style: {} as Record<string, string>,
      setAttribute: () => {},
      select: () => {},
      setSelectionRange: () => {},
    }),
    body: {
      appendChild: (el: FakeEl) => appended.push(el),
      removeChild: (el: FakeEl) => removed.push(el),
    },
    execCommand: (cmd: string) => {
      execArg = cmd;
      return execResult;
    },
  });
}

function defineGlobal(name: string, value: unknown) {
  // 不能直接赋值：Node 22 起 globalThis.navigator 是只读 getter，
  // 在 ESM（严格模式）下赋值会抛 TypeError。
  Object.defineProperty(globalThis, name, {
    value,
    configurable: true,
    writable: true,
  });
}

function setContext(opts: { secure: boolean; clipboard?: any }) {
  defineGlobal("window", { isSecureContext: opts.secure });
  defineGlobal("navigator", opts.clipboard ? { clipboard: opts.clipboard } : {});
}

afterEach(() => {
  delete (globalThis as any).document;
  delete (globalThis as any).window;
  delete (globalThis as any).navigator;
  execResult = true;
});

// ── 首选路径 ──

test("https 下走 Clipboard API", async () => {
  installFakeDom();
  let written: string | null = null;
  setContext({
    secure: true,
    clipboard: {
      writeText: async (t: string) => {
        written = t;
      },
    },
  });

  assert.equal(await copyText("AI 的回答"), true);
  assert.equal(written, "AI 的回答");
  assert.equal(appended.length, 0, "首选路径不该创建 textarea");
});

// ── 客户内网那条路（本次的真正理由）──

test("http 内网：navigator.clipboard 不存在 → 兜底仍然复制成功", async () => {
  installFakeDom();
  setContext({ secure: false }); // 无 clipboard，模拟 http://192.168.80.3:3001

  assert.equal(await copyText("AI 的回答"), true);
  assert.equal(execArg, "copy", "没有走兜底——在 http 部署下这个按钮等于没用");
  assert.equal(appended[0]?.value, "AI 的回答");
});

test("http 内网：即便浏览器保留了 clipboard 对象也不该调它", async () => {
  installFakeDom();
  // 某些浏览器在非安全上下文里留着 clipboard 对象，但调用必定 reject。
  //
  // 这里必须断言"**没被调用**"，而不只是"最终复制成功了"：去掉
  // isSecureContext 判断后，代码会先调 writeText、被拒、再落兜底 ——
  // 结果一样，但每次复制都白白产生一个被拒的 Promise 和一条控制台报错。
  // 初版只断言结果，这条变异就活了下来。
  let writeTextCalls = 0;
  setContext({
    secure: false,
    clipboard: {
      writeText: async () => {
        writeTextCalls += 1;
        throw new Error("非安全上下文必被拒");
      },
    },
  });

  assert.equal(await copyText("x"), true);
  assert.equal(writeTextCalls, 0, "非安全上下文下仍然调了 Clipboard API");
  assert.equal(execArg, "copy");
});

test("Clipboard API 被拒（无权限/文档失焦）→ 落到兜底", async () => {
  installFakeDom();
  setContext({
    secure: true,
    clipboard: {
      writeText: async () => {
        throw new Error("NotAllowedError");
      },
    },
  });

  assert.equal(await copyText("x"), true);
  assert.equal(execArg, "copy");
});

// ── 失败必须如实返回 ──

test("兜底也失败时返回 false，让调用方能报错", async () => {
  installFakeDom();
  setContext({ secure: false });
  execResult = false;

  assert.equal(await copyText("x"), false,
    "静默返回成功会让用户以为复制到了，粘贴出来才发现是旧内容");
});

test("空内容不复制", async () => {
  installFakeDom();
  setContext({ secure: false });
  assert.equal(await copyText(""), false);
  assert.equal(appended.length, 0);
});

// ── 兜底不能留下副作用 ──

test("兜底失败也要移除 textarea", async () => {
  installFakeDom();
  setContext({ secure: false });
  execResult = false;

  await copyText("x");
  assert.equal(appended.length, 1);
  assert.equal(removed.length, 1, "textarea 泄漏在 DOM 里，复制多次会越堆越多");
});

test("兜底后还原焦点", async () => {
  installFakeDom();
  setContext({ secure: false });

  await copyText("x");
  assert.equal(focusRestoredTo, "原本聚焦的输入框",
    "不还原焦点的话，用户正在打字的输入框会失焦、光标位置丢失");
});

test("textarea 移出视口而不是 display:none", async () => {
  installFakeDom();
  setContext({ secure: false });

  await copyText("x");
  const style = appended[0]?.style ?? {};
  assert.equal(style.display, undefined, "display:none 的元素选不中，复制会静默失败");
  assert.equal(style.position, "fixed");
  assert.ok(style.left?.startsWith("-"), "没有移出视口，复制时页面会跳动");
});

// ── SSR ──

test("服务端渲染时不炸（window/navigator 都不存在）", async () => {
  installFakeDom();
  delete (globalThis as any).window;
  delete (globalThis as any).navigator;

  // 取 window.isSecureContext 前不做 typeof 判的话，这里是 ReferenceError
  assert.equal(await copyText("x"), true);
});
