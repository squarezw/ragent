import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import {
  BUILTIN_AVATARS,
  avatarFallbackText,
  isBuiltinAvatar,
  uniqueAvatarFilename,
} from "../lib/appAvatar.ts";

test("内置头像清单里的每个文件都真实存在", () => {
  // 清单是手写的，文件在另一个目录：改名/删文件不会有任何编译期报错，
  // 只会让选择器里出现一格裂图。这条把两边钉在一起。
  for (const url of BUILTIN_AVATARS) {
    const file = path.join(process.cwd(), "public", url.replace(/^\//, ""));
    assert.ok(fs.existsSync(file), `清单里有 ${url} 但 public 下没有这个文件`);
  }
});

test("public/avatars 下的 svg 都进了清单", () => {
  // 反方向：加了图却忘了登记，用户永远选不到它
  const dir = path.join(process.cwd(), "public", "avatars");
  const onDisk = fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".svg"))
    .map((f) => `/avatars/${f}`);
  for (const url of onDisk) {
    assert.ok(
      (BUILTIN_AVATARS as readonly string[]).includes(url),
      `${url} 在磁盘上但没登记进 BUILTIN_AVATARS`
    );
  }
});

test("占位文字取首字符", () => {
  assert.equal(avatarFallbackText("财经助理"), "财");
  assert.equal(avatarFallbackText("resume agent"), "R");
});

test("占位文字：空名称不崩，代理对不切半个字", () => {
  assert.equal(avatarFallbackText(""), "?");
  assert.equal(avatarFallbackText(null), "?");
  assert.equal(avatarFallbackText("   "), "?");
  // "🤖" 是代理对，按 UTF-16 下标取会拿到半个字符渲染成乱码方块
  assert.equal(avatarFallbackText("🤖 助手"), "🤖");
});

test("内置头像必须自带颜色，否则就是一格看不见的空白", () => {
  // 它们经 <img> 加载——拿不到页面的 CSS 变量，也没法被组件上色。颜色必须写在
  // 文件里：底色 <rect> + 字形 stroke。谁把颜色抽走（比如想改成跟主题走）都不会
  // 报错，只会让选择器里出现一格白板，而这种"看不见"最容易在自测时被当成没渲染。
  const dir = path.join(process.cwd(), "public", "avatars");
  const files = fs.readdirSync(dir).filter((x) => x.endsWith(".svg"));
  assert.ok(files.length > 0, "public/avatars 下一个 svg 都没有");
  for (const f of files) {
    const svg = fs.readFileSync(path.join(dir, f), "utf8");
    assert.match(svg, /<rect[^>]*fill="#[0-9a-f]{3,6}"/i, `${f} 没有底色`);
    assert.match(svg, /stroke="#[0-9a-f]{3,6}"/i, `${f} 字形没有颜色`);
    assert.ok(!svg.includes("currentColor"), `${f} 用了 currentColor，经 <img> 加载时取不到颜色`);
  }
});

test("认得出内置头像与上传头像", () => {
  assert.equal(isBuiltinAvatar("/avatars/bot.svg"), true);
  assert.equal(isBuiltinAvatar("/api/oss/app-avatars/202608/x.png"), false);
  assert.equal(isBuiltinAvatar(null), false);
  assert.equal(isBuiltinAvatar(""), false);
});

test("上传文件名唯一化：保留扩展名、两次不重", () => {
  // OSS 的 key 直接拿文件名拼，服务端不去重（实测同名两次 presign 同一个 key）。
  // 大家的头像都叫 avatar.png，不改名就是互相覆盖。
  const a = uniqueAvatarFilename("avatar.png");
  const b = uniqueAvatarFilename("avatar.png");
  assert.notEqual(a, b);
  assert.ok(a.endsWith(".png"), a);
});

test("上传文件名唯一化：奇怪的名字不崩", () => {
  assert.ok(uniqueAvatarFilename("头像.JPEG").endsWith(".jpeg"));   // 中文名 + 大写后缀
  assert.ok(!uniqueAvatarFilename("noext").includes("."));         // 没后缀就不给后缀
  assert.ok(uniqueAvatarFilename("").length > 0);                  // 空名也要给得出名字
  // 「点很多」和「后缀超长」都不该被当成扩展名切出来
  assert.ok(uniqueAvatarFilename("a.b.c.png").endsWith(".png"));
  assert.ok(!uniqueAvatarFilename("x.thisisnotanextension").includes("."));
});
