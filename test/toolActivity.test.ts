import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { mount, run } from "./helpers/chatRunPageHarness.ts";

const REPO = path.resolve(import.meta.dirname, "..");
const read = (rel: string) => fs.readFileSync(path.join(REPO, rel), "utf8");

/**
 * 一轮对话的工具调用列表（2026-08-30）。
 *
 * 此前每来一帧 `tool_status` 就把指示器整个替换掉：一轮调了五个工具只看得到
 * 第五个，前四个不留痕迹。**帧一直都在，是界面把它们丢了** —— 所以这次改动
 * 不需要动后端。
 */

test("步骤是累积的，不是替换", async () => {
  const page = mount({
    active: [run({ tool_steps: [{ name: "one", tool_call_id: "a", phase: "started" }] })],
  });
  await page.settle();
  page.emit(
    run({
      cursor: 2,
      tool_steps: [
        { name: "one", tool_call_id: "a", phase: "finished", ok: true },
        { name: "two", tool_call_id: "b", phase: "started" },
      ],
    })
  );
  const steps = page.find("MessageList")?.props.toolSteps;
  assert.equal(steps.length, 2);
  assert.equal(steps[0].ok, true);
  assert.equal(steps[1].label, "two");
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

test("步骤有稳定的 key", async () => {
  const src = read("app/chat/components/ToolActivity.tsx");
  assert.match(src, /key=\{s\.id\}/);
  const page = mount({
    active: [
      run({
        tool_steps: [
          { name: "same", tool_call_id: "a", phase: "started" },
          { name: "same", tool_call_id: "b", phase: "started" },
        ],
      }),
    ],
  });
  await page.settle();
  const ids = page.find("MessageList")?.props.toolSteps.map((step: { id: string }) => step.id);
  assert.deepEqual(JSON.parse(JSON.stringify(ids)), ["a", "b"]);
  page.emit(
    run({
      cursor: 2,
      tool_steps: [
        { name: "same", tool_call_id: "b", phase: "finished" },
        { name: "same", tool_call_id: "a", phase: "started" },
      ],
    })
  );
  assert.equal(page.find("MessageList")?.props.toolSteps[0].id, "b");
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
