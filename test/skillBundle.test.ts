import assert from "node:assert/strict";
import { test } from "node:test";
import { normalizePath, precheck, toBase64, toPayload, isZipFile, isMarkdownFile,
         BUNDLE_MAX_TOTAL_BYTES } from "../lib/skillBundle.ts";

test("normalizePath 统一成 POSIX 相对路径", () => {
  assert.equal(normalizePath("./scripts/run.py"), "scripts/run.py");
  assert.equal(normalizePath("/scripts/run.py"), "scripts/run.py");
  assert.equal(normalizePath("scripts\\run.py"), "scripts/run.py");
  assert.equal(normalizePath("  SKILL.md  "), "SKILL.md");
});

test("toBase64 对大数组不炸栈", () => {
  // 整包 String.fromCharCode(...bytes) 会在这个尺寸上抛
  // "Maximum call stack size exceeded"，而小文件完全测不出来 ——
  // 偏偏在用户导入一个真实规模的 skill 时才炸。
  const big = new Uint8Array(300_000).fill(65);
  const out = toBase64(big);
  assert.equal(typeof out, "string");
  assert.equal(Buffer.from(out, "base64").length, 300_000);
});

test("toBase64 与 Buffer 编码逐字节一致", () => {
  const bytes = new Uint8Array(256);
  for (let i = 0; i < 256; i++) bytes[i] = i;
  assert.equal(toBase64(bytes), Buffer.from(bytes).toString("base64"));
});

test("toPayload 保留路径并编码内容", () => {
  const payload = toPayload([
    { path: "SKILL.md", size: 3, bytes: new Uint8Array([97, 98, 99]) },
  ]);
  assert.equal(payload.files[0].path, "SKILL.md");
  assert.equal(Buffer.from(payload.files[0].content_base64, "base64").toString(), "abc");
});

test("precheck 拦住空包", () => {
  assert.match(precheck([]) ?? "", /没有读到/);
});

test("precheck 拦住超大包", () => {
  const files = [{
    path: "big.bin",
    size: BUNDLE_MAX_TOTAL_BYTES + 1,
    bytes: new Uint8Array(0),
  }];
  const msg = precheck(files) ?? "";
  assert.match(msg, /超过上限/);
  assert.match(msg, /MB/, "要说清多大、上限多少，不能只说太大了");
});

test("precheck 放行正常包", () => {
  assert.equal(precheck([
    { path: "SKILL.md", size: 100, bytes: new Uint8Array(0) },
  ]), null);
});

test("isZipFile 认扩展名与 MIME", () => {
  assert.ok(isZipFile({ name: "a.ZIP", type: "" } as File));
  assert.ok(isZipFile({ name: "a", type: "application/zip" } as File));
  assert.ok(isZipFile({ name: "a", type: "application/x-zip-compressed" } as File));
  assert.equal(isZipFile({ name: "a.tar.gz", type: "" } as File), false);
});


test("isMarkdownFile 认扩展名与 MIME", () => {
  assert.ok(isMarkdownFile({ name: "SKILL.md", type: "" } as File));
  assert.ok(isMarkdownFile({ name: "skill-x.MD", type: "" } as File));
  assert.ok(isMarkdownFile({ name: "notes", type: "text/markdown" } as File));
  assert.equal(isMarkdownFile({ name: "a.txt", type: "text/plain" } as File), false);
  assert.equal(isMarkdownFile({ name: "a.zip", type: "" } as File), false);
});

test("单个 .md 一律当作 SKILL.md，不看原文件名", () => {
  // 用户手上那个文件很可能叫 skill-x.md 或 SKILL(1).md —— 从别处另存时改了名。
  // 按原名传，后端会报"根目录缺少 SKILL.md"，而那个文件明明就在眼前，
  // 报错指向了错误的位置。单文件导入时文件名不携带信息，内容才是。
  const payload = toPayload([
    { path: "SKILL.md", size: 3, bytes: new Uint8Array([97, 98, 99]) },
  ]);
  assert.equal(payload.files[0].path, "SKILL.md");
});
