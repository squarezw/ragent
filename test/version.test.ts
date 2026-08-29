import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";

const REPO = path.resolve(import.meta.dirname, "..");
const read = (rel: string) => fs.readFileSync(path.join(REPO, rel), "utf8");

/**
 * 版本号只能有一个真源。
 *
 * 界面徽标原本写死 `v0.5.0`，与 package.json 各存一份。发版时改一处忘另一处
 * 不会报任何错 —— 只会让用户看到一个已经不对的版本号，而这种错没人会去核对。
 */

test("界面徽标读 package.json，不写死版本号", () => {
  const src = read("app/components/DynamicTitle.tsx");
  assert.match(src, /import pkg from "\.\.\/\.\.\/package\.json"/);
  assert.match(src, /v\{pkg\.version\}/);
  // 只查 JSX 里渲染出来的内容 —— 注释里提到「原本写死 v0.5.0」是在解释历史，
  // 把注释也算进去的话，写这条注释本身就会让测试红。
  const rendered = src
    .replace(/\/\/.*$/gm, "")
    .replace(/\/\*[\s\S]*?\*\//g, "");
  assert.ok(!/>\s*v\d+\.\d+\.\d+/.test(rendered),
    "徽标里不该渲染写死的版本号");
});

test("发布说明的最新条目与 package.json 一致", () => {
  const version = JSON.parse(read("package.json")).version as string;
  const notes = read("docs/RELEASE_NOTES.md");
  const first = notes.match(/^## (\d+\.\d+\.\d+)/m);
  assert.ok(first, "发布说明里找不到版本条目");
  assert.equal(first[1], version,
    `bump 了 package.json 却没写发布说明（或反过来）：包是 ${version}，说明里最新是 ${first[1]}`);
});

test("发布说明按版本倒序，且没有重复条目", () => {
  const notes = read("docs/RELEASE_NOTES.md");
  const versions = [...notes.matchAll(/^## v?(\d+\.\d+\.\d+)/gm)].map((m) => m[1]);
  assert.ok(versions.length > 1);
  assert.equal(new Set(versions).size, versions.length, `有重复的版本条目：${versions}`);

  const cmp = (a: string, b: string) => {
    const [x, y] = [a.split(".").map(Number), b.split(".").map(Number)];
    for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return y[i] - x[i];
    return 0;
  };
  assert.deepEqual(versions, [...versions].sort(cmp), "发布说明没有按版本倒序");
});
