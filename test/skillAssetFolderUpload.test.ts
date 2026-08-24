import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { inferAssetKind, stripRedundantRoot } from "../lib/skillAssets.ts";

const PANEL = fs.readFileSync(
  path.join(import.meta.dirname, "../app/skills/components/SkillAssetsPanel.tsx"),
  "utf8"
);

test("选中 skill 根目录时剥掉那一层", () => {
  const { paths, stripped } = stripRedundantRoot([
    "drawing-tolerance-extractor-draft/SKILL.md",
    "drawing-tolerance-extractor-draft/scripts/extract_drawing_mvp.py",
    "drawing-tolerance-extractor-draft/agents/openai.yaml",
  ]);
  assert.equal(stripped, "drawing-tolerance-extractor-draft");
  assert.deepEqual(paths, ["SKILL.md", "scripts/extract_drawing_mvp.py", "agents/openai.yaml"]);
});

test("直接选 scripts 文件夹时**不剥**，否则脚本会被静默改判成参考", () => {
  // 这是这条规则存在的理由。剥掉 scripts/ 只剩 a.py、b.py，而 kind 是按顶层
  // 目录推断的：根级 .py 落到扩展名分流 → reference。上传照样成功、列表照样
  // 显示，只是它此后不再作为脚本被执行，且没有任何报错。
  const { paths, stripped } = stripRedundantRoot(["scripts/a.py", "scripts/b.py"]);
  assert.equal(stripped, null);
  assert.deepEqual(paths, ["scripts/a.py", "scripts/b.py"]);

  assert.equal(inferAssetKind("scripts/a.py"), "script");
  assert.equal(inferAssetKind("a.py"), "reference"); // ← 剥了就会变成这个
});

test("剥完仍有目录层级才剥（只有一个子目录也算）", () => {
  const { paths, stripped } = stripRedundantRoot([
    "my-skill/scripts/run.py",
    "my-skill/scripts/util.py",
  ]);
  assert.equal(stripped, "my-skill");
  assert.deepEqual(paths, ["scripts/run.py", "scripts/util.py"]);
});

test("同时选多个文件夹时不剥——顶层不唯一，无法判断哪层多余", () => {
  const { paths, stripped } = stripRedundantRoot(["a/scripts/x.py", "b/scripts/y.py"]);
  assert.equal(stripped, null);
  assert.deepEqual(paths, ["a/scripts/x.py", "b/scripts/y.py"]);
});

test("最外层有散文件时不剥", () => {
  // 这不是"多包了一层"的形态：README.md 就在最外层，剥无从下手
  const { stripped } = stripRedundantRoot(["README.md", "scripts/x.py"]);
  assert.equal(stripped, null);
});

test("整批只有散文件（选的是文件不是文件夹）时不剥", () => {
  const { paths, stripped } = stripRedundantRoot(["a.py", "b.md"]);
  assert.equal(stripped, null);
  assert.deepEqual(paths, ["a.py", "b.md"]);
});

test("空输入不炸", () => {
  const { paths, stripped } = stripRedundantRoot([]);
  assert.equal(stripped, null);
  assert.deepEqual(paths, []);
});

test("路径先规范化再判断", () => {
  // 拖放与手填会产出 ./ 前缀、重复斜杠、反斜杠等写法；不先归一化会把
  // "./x/a.py" 的顶层看成 "."，于是所有批次都"顶层唯一"而被错剥。
  const { paths, stripped } = stripRedundantRoot([
    "./my-skill/scripts/a.py",
    "my-skill//refs/b.md",
  ]);
  assert.equal(stripped, "my-skill");
  assert.deepEqual(paths, ["scripts/a.py", "refs/b.md"]);
});

test("只剥一层，不递归", () => {
  // 用户选的那个文件夹是第一段，剥它就够了。多剥一层就是替用户重排目录结构。
  const { paths, stripped } = stripRedundantRoot([
    "outer/inner/scripts/a.py",
    "outer/inner/SKILL.md",
  ]);
  assert.equal(stripped, "outer");
  assert.deepEqual(paths, ["inner/scripts/a.py", "inner/SKILL.md"]);
});

test("条目本身就是那个目录时不剥", () => {
  // "my-skill/" 规范化后不含斜杠，被"最外层不能有散文件"那条拦下
  const { stripped } = stripRedundantRoot(["my-skill/", "my-skill/scripts/a.py"]);
  assert.equal(stripped, null);
});

test("有个文件跟顶层目录同名时不剥", () => {
  // 首段都是 "scripts"，唯一性检查放不出它 —— 只有"最外层不能有散文件"这条能拦。
  // 剥了会把那个叫 scripts 的**文件**原样留下，同时把 scripts/a.py 剥成 a.py，
  // 得到一份自相矛盾的清单。
  const { paths, stripped } = stripRedundantRoot(["scripts", "scripts/a.py"]);
  assert.equal(stripped, null);
  assert.deepEqual(paths, ["scripts", "scripts/a.py"]);
});

test("单个文件不剥（首段就是它自己）", () => {
  const { paths, stripped } = stripRedundantRoot(["a.py"]);
  assert.equal(stripped, null);
  assert.deepEqual(paths, ["a.py"]);
});

/**
 * 下面两条锁的是**接线**，不是逻辑。
 *
 * 2026-08-24 踩的：stripRedundantRoot 写好了、12 条断言全绿，但「选择文件夹」
 * 按钮的 onChange 还调着 addFiles —— 函数根本没被调用。纯函数测试对此一言不发，
 * 而表现是"功能看起来做了但没生效"，最容易被当成缓存或没部署。
 */
test("「选择文件夹」按钮必须走 addFolderFiles", () => {
  const m = PANEL.match(/ref=\{folderInput\}[\s\S]{0,400}?onChange=\{\(e\) => \{\s*(\w+)\(/);
  assert.ok(m, "找不到 folderInput 的 onChange");
  assert.equal(
    m[1],
    "addFolderFiles",
    `folderInput 的 onChange 调的是 ${m[1]}，剥顶层目录那步会被跳过`
  );
});

test("拖放也必须走 addFolderFiles", () => {
  // 拖进来的文件夹和点按钮选的文件夹是同一件事，两条路不能一条剥一条不剥
  assert.match(
    PANEL,
    /handleDrop[\s\S]{0,300}?addFolderFiles\(await collectDroppedFiles/,
    "handleDrop 没走 addFolderFiles"
  );
});

test("「选择文件」按钮**不**走 addFolderFiles", () => {
  // 选的就是文件本身，不存在多包一层的问题；对它剥会把 a/b.py 剥成 b.py
  const m = PANEL.match(/ref=\{fileInput\}[\s\S]{0,400}?onChange=\{\(e\) => \{\s*(\w+)\(/);
  assert.ok(m, "找不到 fileInput 的 onChange");
  assert.equal(m[1], "addFiles");
});
