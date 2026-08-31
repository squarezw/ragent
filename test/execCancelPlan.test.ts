/**
 * 取消可执行的动作规划（2026-08-31）。
 *
 * 两个 stage 的后果截然不同：撤草稿要等重新发布才生效，撤线上是立刻停。
 * 把「删哪个」的判断从组件里拎出来，是因为这里错一次的表现是
 * 「界面报已取消，线上照跑」——一个不会报错的错误。
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { isExecCancelNoop, planExecCancel } from "../lib/skillAssets.ts";

test("草稿可执行、线上没有：只撤草稿，不发线上那一枪", () => {
  const plan = planExecCancel({ hasDraftExec: true, hasLiveExec: false, alsoStopLive: false });
  assert.deepEqual(plan, { deleteDraft: true, deleteLive: false, offerChoice: false });
});

test("草稿和线上都在：默认只撤草稿，线上要用户明确勾选", () => {
  const plan = planExecCancel({ hasDraftExec: true, hasLiveExec: true, alsoStopLive: false });
  assert.equal(plan.deleteDraft, true);
  assert.equal(plan.deleteLive, false, "没勾就停线上 = 悄悄改变线上行为");
  assert.equal(plan.offerChoice, true, "这是唯一该给勾选框的情形");
});

test("勾了「同时停线上」：两个 stage 一起删", () => {
  const plan = planExecCancel({ hasDraftExec: true, hasLiveExec: true, alsoStopLive: true });
  assert.deepEqual(plan, { deleteDraft: true, deleteLive: true, offerChoice: true });
});

test("草稿已不可执行、只剩线上：停线上是全部内容，不给选择", () => {
  const plan = planExecCancel({ hasDraftExec: false, hasLiveExec: true, alsoStopLive: false });
  assert.equal(plan.deleteDraft, false, "草稿本就没有配置，不该发删除请求");
  assert.equal(plan.deleteLive, true, "此时不停线上，这个按钮就什么也不做");
  assert.equal(plan.offerChoice, false, "能取消勾选的话按钮就成了空操作");
});

test("只剩线上时，勾选与否结果相同——用户没有能力把它变成空操作", () => {
  const off = planExecCancel({ hasDraftExec: false, hasLiveExec: true, alsoStopLive: false });
  const on = planExecCancel({ hasDraftExec: false, hasLiveExec: true, alsoStopLive: true });
  assert.deepEqual(off, on);
});

test("两边都没有：整个操作是空的，按钮本就不该出现", () => {
  const plan = planExecCancel({ hasDraftExec: false, hasLiveExec: false, alsoStopLive: true });
  assert.deepEqual(plan, { deleteDraft: false, deleteLive: false, offerChoice: false });
  assert.equal(isExecCancelNoop(plan), true);
});

test("任何一边要删，就不是空操作", () => {
  for (const [d, l] of [[true, false], [false, true], [true, true]] as const) {
    const plan = planExecCancel({ hasDraftExec: d, hasLiveExec: l, alsoStopLive: true });
    assert.equal(isExecCancelNoop(plan), false, `hasDraft=${d} hasLive=${l}`);
  }
});
