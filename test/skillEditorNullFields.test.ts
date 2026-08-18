import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";

/**
 * SkillEditor 回填表单时，每个可空字段都必须兜底成 ""。
 *
 * 2026-08-18 踩的：导入的 skill 一打开详情页就整页白屏 ——
 *
 *     TypeError: Cannot read properties of null (reading 'trim')
 *       at SkillEditor.useMemo[payload]
 *
 * `useState` 的初始值本来就写了 `|| ""`，但 skill 异步加载完成后的那次回填
 * （`useEffect` 里的 setXxx）没有，null 直接进了 state，随后 `name.trim()` 炸。
 *
 * 为什么一直没被发现：手工创建的 skill，那几栏存的是**空串**。第一个真的存
 * NULL 的来源是导入功能（SKILL.md 没写 display_name 时有意留空），它一上线就
 * 把这个缺陷暴露了出来。
 *
 * 这里用源码断言而不是渲染测试：本仓没有 jsdom，而这条规则本身是"每个 setter
 * 都要有兜底"，正适合逐个核对。
 */

const SRC = fs.readFileSync(
  path.join(import.meta.dirname, "..", "app", "skills", "components", "SkillEditor.tsx"),
  "utf8"
);

/** 取回填表单那段 useEffect 的函数体 */
function backfillBlock(): string {
  const start = SRC.indexOf("skill 异步加载完成后回填表单");
  assert.ok(start > 0, "找不到回填表单的 useEffect —— 组件结构变了，本测试需同步更新");
  const end = SRC.indexOf("}, [skill]);", start);
  assert.ok(end > start);
  return SRC.slice(start, end);
}

test("回填表单时每个字符串字段都有 null 兜底", () => {
  const block = backfillBlock();
  // 这几个字段在库里都可空，而 state 之后会被当字符串用
  for (const setter of ["setName", "setDisplayName", "setDescription", "setContent"]) {
    const line = block
      .split("\n")
      .find((l) => l.includes(`${setter}(`));
    assert.ok(line, `回填块里找不到 ${setter}`);
    assert.match(
      line!,
      /\?\?\s*""|\|\|\s*""/,
      `${setter} 没有兜底：值为 null 时会一路进 state，` +
        `随后 .trim() / .length 抛 TypeError，整页白屏`
    );
  }
});

test("useState 初始值同样有兜底", () => {
  // 两处都要有。只修其中一处的话，另一条路径照样炸 ——
  // 而它们分别对应"直接进详情页"与"列表点进去"两种进入方式。
  for (const field of ["name", "display_name", "description"]) {
    const re = new RegExp(`useState\\(skill\\??\\.?${field}[^)]*\\)`);
    const m = SRC.match(re);
    assert.ok(m, `找不到 ${field} 的 useState`);
    assert.match(m![0], /\?\?|\|\|/, `${field} 的 useState 初始值没有兜底`);
  }
});
