import assert from "node:assert/strict";
import { test } from "node:test";
import { buildTree, countByStatus, formatSize, worseStatus,
         type ImportFileVerdict } from "../lib/skillImportTree.ts";

const f = (path: string, status: ImportFileVerdict["status"] = "ok",
           extra: Partial<ImportFileVerdict> = {}): ImportFileVerdict =>
  ({ path, size: 10, status, ...extra });

test("扁平清单折成目录树", () => {
  const tree = buildTree([
    f("SKILL.md", "skipped"),
    f("scripts/run.py"),
    f("references/a.md"),
  ]);
  const names = tree.map((n) => n.name);
  // 目录排前
  assert.deepEqual(names, ["references", "scripts", "SKILL.md"]);
  const scripts = tree.find((n) => n.name === "scripts")!;
  assert.ok(scripts.isDir);
  assert.deepEqual(scripts.children.map((c) => c.name), ["run.py"]);
});

test("深层目录被逐级建出来", () => {
  const tree = buildTree([f("a/b/c/deep.py")]);
  assert.equal(tree[0].name, "a");
  assert.equal(tree[0].children[0].name, "b");
  assert.equal(tree[0].children[0].children[0].name, "c");
  assert.equal(tree[0].children[0].children[0].children[0].name, "deep.py");
});

test("目录状态由子孙上卷 —— 深层出错，顶层目录也要红", () => {
  // 树默认折叠时，用户只看得见顶层。上卷不生效的话，红标就藏在折叠层里，
  // 等于没标。
  const tree = buildTree([f("a/b/c/bad.py", "error")]);
  assert.equal(tree[0].status, "error", "顶层目录没有继承后代的 error");
  assert.equal(tree[0].children[0].status, "error");
});

test("error 压过 warning 压过 ok 压过 skipped", () => {
  assert.equal(worseStatus("ok", "error"), "error");
  assert.equal(worseStatus("warning", "ok"), "warning");
  assert.equal(worseStatus("skipped", "ok"), "ok");
  const tree = buildTree([
    f("d/ok.py", "ok"), f("d/warn.py", "warning"), f("d/bad.py", "error"),
  ]);
  assert.equal(tree[0].status, "error");
});

test("全跳过的目录不误报成 ok", () => {
  const tree = buildTree([f(".git/config", "skipped"), f(".git/HEAD", "skipped")]);
  assert.equal(tree[0].status, "skipped");
});

test("目录 size 是子孙之和", () => {
  const tree = buildTree([
    { path: "d/a", size: 100, status: "ok" },
    { path: "d/b", size: 250, status: "ok" },
  ]);
  assert.equal(tree[0].size, 350);
});

test("countByStatus 统计四类", () => {
  const c = countByStatus([f("a"), f("b", "error"), f("c", "skipped"), f("d", "skipped")]);
  assert.deepEqual(c, { ok: 1, error: 1, warning: 0, skipped: 2 });
});

test("formatSize 可读", () => {
  assert.equal(formatSize(512), "512 B");
  assert.equal(formatSize(2048), "2.0 KB");
  assert.equal(formatSize(3 * 1024 * 1024), "3.0 MB");
});
