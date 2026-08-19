import assert from "node:assert/strict";
import { test } from "node:test";
import { structuralWarnings } from "../lib/skillImportWarnings.ts";

/**
 * 判错的后果是**同一件事在同一屏出现两次** —— 不会报错，只会让人以为
 * 是两个不同的问题。所以值得单测。
 */

test("被结构化区块覆盖的 warning 不再重复显示", () => {
  const r = { warnings: [
    "检测到需要配置的凭证：KIE_API_KEY。将生成 .env.example，导入后在「个人环境变量」里填写真值。",
    "该 skill 需要访问外部网络（SKILL.md 里有 curl / http 调用）。导入后请到「运行配置」里打开「允许出网」。",
    "检测到可执行内容，将自动创建运行配置（镜像 ragent-skill-general:latest，超时 120 秒）。",
  ]};
  assert.deepEqual(structuralWarnings(r), []);
});

test("未被覆盖的 warning 照常显示", () => {
  // 这条不属于那三件事 —— 过滤掉它等于把一个真提示藏起来
  const r = { warnings: ["SKILL.md 正文为空 —— 模型将只能看到 description"] };
  assert.equal(structuralWarnings(r).length, 1);
});

test("混合时只滤掉被覆盖的那些", () => {
  const r = { warnings: [
    "SKILL.md 正文为空 —— 模型将只能看到 description",
    "检测到需要配置的凭证：X_TOKEN。将生成 .env.example。",
  ]};
  const out = structuralWarnings(r);
  assert.equal(out.length, 1);
  assert.match(out[0], /正文为空/);
});

test("英文 warning 同样被识别", () => {
  const r = { warnings: ["This skill needs network access; grant egress under run config."] };
  assert.deepEqual(structuralWarnings(r), []);
});

test("空数组安全", () => {
  assert.deepEqual(structuralWarnings({ warnings: [] }), []);
});
