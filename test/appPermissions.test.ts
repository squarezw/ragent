import assert from "node:assert/strict";
import { test } from "node:test";
import { canEditApp } from "../lib/appPermissions.ts";

test("owner 能改自己的应用", () => {
  assert.equal(canEditApp({ user_id: 7 }, { id: 7 }, false), true);
});

test("超管能改别人的应用", () => {
  assert.equal(canEditApp({ user_id: 7 }, { id: 999 }, true), true);
});

test("其他人不能改", () => {
  assert.equal(canEditApp({ user_id: 7 }, { id: 999 }, false), false);
});

test("id 缺失时按无权限处理", () => {
  // 关键一条：两边都空时不能相等。`undefined === undefined` 为 true，
  // 未登录用户会看起来像每个无主应用的 owner —— 按钮全亮，点下去才吃 403。
  assert.equal(canEditApp({ user_id: null }, { id: null }, false), false);
  assert.equal(canEditApp({}, {}, false), false);
  assert.equal(canEditApp(null, null, false), false);
  assert.equal(canEditApp(undefined, undefined, false), false);
});

test("超管即便没有可比的 id 也能改", () => {
  // 超管判定不依赖 owner 是谁；无主应用（user_id 为空）也得能管
  assert.equal(canEditApp({ user_id: null }, { id: null }, true), true);
});
