import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";

const REPO = path.resolve(import.meta.dirname, "..");
const read = (rel: string) => fs.readFileSync(path.join(REPO, rel), "utf8");

/**
 * 一轮对话的工具调用列表（2026-08-30）。
 *
 * 此前每来一帧 `tool_status` 就把指示器整个替换掉：一轮调了五个工具只看得到
 * 第五个，前四个不留痕迹。**帧一直都在，是界面把它们丢了** —— 所以这次改动
 * 不需要动后端。
 */

test("步骤是累积的，不是替换", () => {
  const src = read("app/chat/page.tsx");
  assert.ok(!src.includes("setToolStatus"), "还残留着替换式的 setToolStatus");
  const seg = src.slice(src.indexOf('status.phase === "started"'));
  assert.match(seg.slice(0, 300), /setToolSteps\(\(prev\) => \[\s*\n?\s*\.\.\.prev,/,
    "started 应当往列表里追加");
});

test("finished 从后往前找同名步骤", () => {
  // 这些帧不带 tool_call_id，只能按名字回填。同一个工具会被连调多次
  // （模型轮询就是这样）—— 从前往后找会把新的 finished 记到早已结束的那条上，
  // 表现是「有的步骤永远转圈」。
  const src = read("app/chat/page.tsx");
  const seg = src.slice(src.indexOf("finished：结掉"));
  assert.match(seg.slice(0, 500), /lastIndexOf\(label\)/, "必须从后往前找");
  assert.match(seg.slice(0, 500), /prev\[i\]\.ok !== undefined/, "不能重复结掉已完成的步骤");
});

test("每轮开始时清空", () => {
  // 不清的话上一轮的步骤会跟着这一轮显示。
  const src = read("app/chat/page.tsx");
  assert.ok(src.includes("setToolSteps([]);"), "缺清空");
});

test("执行中展开、完成后折叠", () => {
  const src = read("app/chat/components/ToolActivity.tsx");
  assert.match(src, /useState\(true\)/, "执行中应默认展开");
  assert.match(src, /if \(!running\) setExpanded\(false\)/, "完成后应折叠");
  assert.match(src, /setExpanded\(\(v\) => !v\)/, "缺手动折叠开关");
});

test("计时器只在执行中走", () => {
  // 完成后还在跑定时器，等于每秒重渲染一次已经不动的内容。
  const src = read("app/chat/components/ToolActivity.tsx");
  const seg = src.slice(src.indexOf("useEffect(() => {"));
  assert.match(seg.slice(0, 250), /if \(!running\) return;/);
  assert.match(seg.slice(0, 250), /clearInterval/, "没有清理定时器");
});

test("空列表不渲染任何东西", () => {
  // 没有工具调用的普通问答不该多出一个空框。
  const src = read("app/chat/components/ToolActivity.tsx");
  assert.match(src, /if \(steps\.length === 0\) return null;/);
  const ml = read("app/chat/components/MessageList.tsx");
  assert.match(ml, /toolSteps && toolSteps\.length > 0 \?/);
});

test("步骤有稳定的 key", () => {
  // 用 label 作 key 的话，同名工具连调两次会被 React 当成同一行。
  const src = read("app/chat/components/ToolActivity.tsx");
  assert.match(src, /key=\{s\.id\}/, "应当用 id 而不是 label 或 index");
  assert.match(read("app/chat/page.tsx"), /id: prev\.length/,
    "id 应在追加时按序生成");
});

test("三种步骤状态各有其形", () => {
  const src = read("app/chat/components/ToolActivity.tsx");
  assert.match(src, /s\.ok === undefined \?/, "缺执行中状态");
  assert.match(src, /animate-spin/, "执行中缺转圈");
  assert.match(src, /text-emerald-600/, "成功缺配色");
  assert.match(src, /text-destructive/, "失败缺配色");
});

test("中英文案齐全", () => {
  const zh = JSON.parse(read("messages/zh-CN/chat.json"));
  const en = JSON.parse(read("messages/en/chat.json"));
  for (const k of ["activityRunning", "activityDone"]) {
    assert.ok(k in zh && k in en, `缺文案 ${k}`);
  }
  assert.deepEqual(Object.keys(zh).sort(), Object.keys(en).sort());
});
