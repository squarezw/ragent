import assert from "node:assert/strict";
import { test } from "node:test";
import { assetExtname, isPreviewableAsset } from "../lib/skillAssets.ts";

test("CRP 真实资产全部可预览", () => {
  const real = [
    ".env.example", "scripts/annotate.py", "scripts/requirements.txt",
    "skills/crp-review-judge/SKILL.md", "skills/crp-knowledge-builder/rules.md",
    "skills/crp-review-judge/prompts/assessor.md",
  ];
  for (const p of real) assert.equal(isPreviewableAsset(p), true, p);
});

test("office 与图片给按钮", () => {
  for (const p of ["a/b.docx", "x.pdf", "img/logo.png"])
    assert.equal(isPreviewableAsset(p), true, p);
});

test("纯二进制不给按钮", () => {
  for (const p of ["dist/pkg.zip", "lib/native.so", "x.pyc", "m.mp4"])
    assert.equal(isPreviewableAsset(p), false, p);
});

test("无扩展名按文本试", () => {
  assert.equal(isPreviewableAsset("LICENSE"), true);
  assert.equal(assetExtname("LICENSE"), "");
  assert.equal(assetExtname("a/b/c.tar.gz"), ".gz");
});
