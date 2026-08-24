import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { isSkillBodyPath, partitionStagedUploads, splitSkillMd } from "../lib/skillAssets.ts";

const PANEL = fs.readFileSync(
  path.join(import.meta.dirname, "../app/skills/components/SkillAssetsPanel.tsx"),
  "utf8"
);

test("只有根目录的 SKILL.md 是正文", () => {
  assert.equal(isSkillBodyPath("SKILL.md"), true);
  assert.equal(isSkillBodyPath("./SKILL.md"), true); // 规范化后同一个
  // references/SKILL.md 是一份正当的参考文档，不能当成正文
  assert.equal(isSkillBodyPath("references/SKILL.md"), false);
  assert.equal(isSkillBodyPath("scripts/SKILL.md"), false);
  // 大小写不同名就是不同文件，别自作聪明
  assert.equal(isSkillBodyPath("skill.md"), false);
});

test("待上传队列切成正文与资产两摊", () => {
  const { body, assets } = partitionStagedUploads([
    { path: "SKILL.md" },
    { path: "scripts/a.py" },
    { path: "agents/openai.yaml" },
  ]);
  assert.deepEqual(body, { path: "SKILL.md" });
  assert.deepEqual(assets, [{ path: "scripts/a.py" }, { path: "agents/openai.yaml" }]);
});

test("没有 SKILL.md 时 body 为 null，资产原样", () => {
  const { body, assets } = partitionStagedUploads([{ path: "scripts/a.py" }]);
  assert.equal(body, null);
  assert.deepEqual(assets, [{ path: "scripts/a.py" }]);
});

test("同一路径加了两次取后加的", () => {
  const { body } = partitionStagedUploads([
    { path: "SKILL.md", id: 1 },
    { path: "SKILL.md", id: 2 },
  ]);
  assert.equal(body?.id, 2);
});

test("切出正文，frontmatter 不进正文", () => {
  const { body, error } = splitSkillMd(
    "---\nname: foo\ndescription: bar\n---\n# 标题\n\n正文内容\n"
  );
  assert.equal(error, null);
  assert.equal(body, "# 标题\n\n正文内容\n");
  assert.ok(!body.includes("description:"), "frontmatter 漏进正文会被整段注入模型提示词");
});

test("CRLF 也能切", () => {
  // Windows 上生成的 SKILL.md 很常见，后端为此踩过一次
  const { body, error } = splitSkillMd("---\r\nname: foo\r\n---\r\n正文\r\n");
  assert.equal(error, null);
  assert.equal(body, "正文\n");
});

test("折叠标量的续行留在 frontmatter 里，不漏进正文", () => {
  const { body, error } = splitSkillMd(
    "---\ndescription: >-\n  第一行\n  第二行\nname: foo\n---\n真正的正文\n"
  );
  assert.equal(error, null);
  assert.equal(body, "真正的正文\n");
});

test("没有 frontmatter 时报错，且文案与后端一致", () => {
  const r = splitSkillMd("# 直接就是正文\n");
  assert.equal(r.hasFrontmatter, false);
  assert.equal(r.error, "SKILL.md 必须以 `---` 开头的 frontmatter 起始");
  assert.equal(r.body, "");
});

test("frontmatter 没闭合时报错，且指向正确的问题", () => {
  const r = splitSkillMd("---\nname: foo\n没有闭合\n");
  assert.equal(r.hasFrontmatter, true);
  assert.equal(r.error, "SKILL.md 的 frontmatter 没有闭合的 `---`");
});

test("正文里出现 --- 分隔线不会被误当成 frontmatter 结尾之后的东西丢掉", () => {
  const { body, error } = splitSkillMd("---\nname: foo\n---\n正文开头\n\n---\n\n正文结尾\n");
  assert.equal(error, null);
  assert.equal(body, "正文开头\n\n---\n\n正文结尾\n");
});

test("空正文（只有 frontmatter）不报错", () => {
  const { body, error } = splitSkillMd("---\nname: foo\n---\n");
  assert.equal(error, null);
  assert.equal(body, "");
});

/**
 * 下面锁接线。2026-08-24 已经栽过一次：stripRedundantRoot 写好了、纯函数测试
 * 全绿，但按钮的 onChange 根本没调它 —— 表现是"功能做了但没生效"。
 */
test("上传流程必须把正文与资产分开走", () => {
  assert.match(
    PANEL,
    /partitionStagedUploads\(staged\)/,
    "runUpload/plan 没有把 SKILL.md 从资产里分出来，它会被当资产传上去"
  );
  assert.match(
    PANEL,
    /splitSkillMd\(/,
    "没有切 frontmatter，整份 SKILL.md 会连 frontmatter 一起进 content"
  );
});

test("资产上传的入参必须来自分离后的资产列表，不是整个 staged", () => {
  // 这是最容易写回去的一行：planUploads(items, staged.map(...)) 会让 SKILL.md
  // 重新变成一条资产记录，而其余部分看起来都正常。
  assert.doesNotMatch(
    PANEL,
    /planUploads\(\s*items,\s*staged\.map/,
    "planUploads 收的是整个 staged，SKILL.md 会被当资产"
  );
});
