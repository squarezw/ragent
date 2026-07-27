import assert from "node:assert/strict";
import { test } from "node:test";
import {
  charSimilarity,
  diffChars,
  diffHunkStarts,
  diffTexts,
  groupDiffRows,
  MAX_LINE_DIFF_CELLS,
  toGraphemes,
  type DiffRow,
  type DiffSegment,
} from "../lib/textDiff.ts";

function leftRender(row: DiffRow): string {
  if (!row.segments) return row.leftText ?? "";
  return row.segments
    .filter((s) => s.type !== "add")
    .map((s) => s.text)
    .join("");
}

function rightRender(row: DiffRow): string {
  if (!row.segments) return row.rightText ?? "";
  return row.segments
    .filter((s) => s.type !== "remove")
    .map((s) => s.text)
    .join("");
}

function changedText(segments: DiffSegment[], type: "add" | "remove"): string {
  return segments
    .filter((s) => s.type === type)
    .map((s) => s.text)
    .join("");
}

function hasLoneSurrogate(text: string): boolean {
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = text.charCodeAt(i + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return true;
      i++;
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      return true;
    }
  }
  return false;
}

// --- 用户上报的真实场景：中文行里删掉一个句号 ---------------------------------

test("单个中文句号的删除被标成行内片段", () => {
  const published = "## 输出要求\n不向用户提及任何工具名。\n保持简洁";
  const draft = "## 输出要求\n不向用户提及任何工具名\n保持简洁";
  const { rows, stats } = diffTexts(published, draft);

  assert.equal(rows.length, 3);
  assert.deepEqual(
    rows.map((r) => r.type),
    ["equal", "modify", "equal"]
  );
  assert.deepEqual(stats, {
    added: 0,
    removed: 0,
    modified: 1,
    unchanged: 2,
    hasChanges: true,
  });

  const modified = rows[1];
  assert.equal(modified.leftLineNo, 2);
  assert.equal(modified.rightLineNo, 2);
  assert.deepEqual(modified.segments, [
    { type: "equal", text: "不向用户提及任何工具名" },
    { type: "remove", text: "。" },
  ]);
  // 左右两栏用同一份片段渲染，过滤后必须还原成原文
  assert.equal(leftRender(modified), "不向用户提及任何工具名。");
  assert.equal(rightRender(modified), "不向用户提及任何工具名");
});

test("中文句中改字只标出变化的那几个字", () => {
  const { rows } = diffTexts("请用中文回答问题。", "请用英文回答问题！");
  assert.equal(rows.length, 1);
  const segments = rows[0].segments ?? [];
  assert.equal(changedText(segments, "remove"), "中。");
  assert.equal(changedText(segments, "add"), "英！");
});

// --- 行级形态 -----------------------------------------------------------------

test("纯新增行", () => {
  const { rows, stats } = diffTexts("a\nb", "a\nnew\nb");
  assert.deepEqual(
    rows.map((r) => r.type),
    ["equal", "add", "equal"]
  );
  assert.equal(stats.added, 1);
  assert.equal(stats.removed, 0);
  assert.equal(stats.modified, 0);
  assert.equal(rows[1].leftLineNo, null);
  assert.equal(rows[1].leftText, null);
  assert.equal(rows[1].rightLineNo, 2);
  assert.equal(rows[2].leftLineNo, 2);
  assert.equal(rows[2].rightLineNo, 3);
});

test("纯删除行", () => {
  const { rows, stats } = diffTexts("a\ngone\nb", "a\nb");
  assert.deepEqual(
    rows.map((r) => r.type),
    ["equal", "remove", "equal"]
  );
  assert.equal(stats.removed, 1);
  assert.equal(rows[1].rightLineNo, null);
  assert.equal(rows[1].rightText, null);
  assert.equal(rows[1].leftText, "gone");
});

test("行序调整不会被硬凑成 modify", () => {
  const { rows, stats } = diffTexts("alpha\nbeta\ngamma", "beta\nalpha\ngamma");
  assert.equal(stats.modified, 0);
  assert.equal(stats.added, 1);
  assert.equal(stats.removed, 1);
  assert.equal(rows.filter((r) => r.type === "equal").length, 2);
});

test("相似度不足的相邻增删保持独立两行", () => {
  const { rows, stats } = diffTexts("完全无关的一句话", "another sentence entirely");
  assert.equal(stats.modified, 0);
  assert.equal(stats.removed, 1);
  assert.equal(stats.added, 1);
  assert.deepEqual(
    rows.map((r) => r.type),
    ["remove", "add"]
  );
});

test("相似度过阈值的相邻增删配对成 modify", () => {
  const { rows, stats } = diffTexts("费用合计 1200 元", "费用合计 1300 元");
  assert.equal(stats.modified, 1);
  assert.equal(rows.length, 1);
  assert.equal(changedText(rows[0].segments ?? [], "remove"), "2");
  assert.equal(changedText(rows[0].segments ?? [], "add"), "3");
});

test("多行块内逐位配对，剩余的按纯增删补齐", () => {
  const { stats } = diffTexts("line one\nline two", "line onex\nline twox\nline three");
  assert.equal(stats.modified, 2);
  assert.equal(stats.added, 1);
  assert.equal(stats.removed, 0);
});

// --- 边界 ---------------------------------------------------------------------

test("两边完全相同 → 无差异", () => {
  const text = "# Skill\n\n步骤一\n步骤二\n";
  const { rows, stats } = diffTexts(text, text);
  assert.equal(stats.hasChanges, false);
  assert.equal(stats.added + stats.removed + stats.modified, 0);
  assert.equal(
    rows.every((r) => r.type === "equal"),
    true
  );
});

test("双空 → 零行零差异", () => {
  const { rows, stats } = diffTexts("", "");
  assert.deepEqual(rows, []);
  assert.equal(stats.hasChanges, false);
});

test("空的已发布 vs 有内容的草稿 → 全新增", () => {
  const { rows, stats } = diffTexts("", "第一行\n第二行");
  assert.deepEqual(
    rows.map((r) => r.type),
    ["add", "add"]
  );
  assert.equal(stats.added, 2);
  assert.equal(rows[0].rightLineNo, 1);
  assert.equal(rows[1].rightLineNo, 2);
});

test("有内容 vs 清空 → 全删除", () => {
  const { stats } = diffTexts("第一行\n第二行", "");
  assert.equal(stats.removed, 2);
  assert.equal(stats.added, 0);
});

test("仅尾部换行差异也会被标出来", () => {
  const { rows, stats } = diffTexts("正文", "正文\n");
  assert.equal(stats.hasChanges, true);
  assert.deepEqual(
    rows.map((r) => r.type),
    ["equal", "add"]
  );
  assert.equal(rows[1].rightText, "");
});

test("CRLF 与 LF 不算差异", () => {
  const { stats } = diffTexts("a\r\nb\r\nc", "a\nb\nc");
  assert.equal(stats.hasChanges, false);
});

test("空行的增删有行号占位", () => {
  const { rows } = diffTexts("a\n\nb", "a\nb");
  const removed = rows.find((r) => r.type === "remove");
  assert.ok(removed);
  assert.equal(removed.leftText, "");
  assert.equal(removed.leftLineNo, 2);
  assert.equal(removed.rightLineNo, null);
});

// --- Unicode ------------------------------------------------------------------

test("emoji 代理对不被切坏", () => {
  const segments = diffChars("进度 👍 完成", "进度 🎉 完成");
  assert.equal(changedText(segments, "remove"), "👍");
  assert.equal(changedText(segments, "add"), "🎉");
  for (const segment of segments) {
    assert.equal(hasLoneSurrogate(segment.text), false, `lone surrogate in ${segment.text}`);
  }
});

test("ZWJ emoji 序列按整体处理", () => {
  const family = "👨‍👩‍👧";
  const segments = diffChars(`家庭 ${family}`, "家庭 👤");
  assert.equal(changedText(segments, "remove"), family);
  assert.equal(changedText(segments, "add"), "👤");
});

test("组合字符不被拆成裸重音符", () => {
  const combining = "café";
  const segments = diffChars(combining, "cafe");
  for (const segment of segments) {
    assert.notEqual(segment.text, "́");
  }
  assert.equal(
    segments
      .filter((s) => s.type !== "add")
      .map((s) => s.text)
      .join(""),
    combining
  );
});

test("toGraphemes 不产生半个字符", () => {
  const graphemes = toGraphemes("a👍中́");
  assert.equal(graphemes.join(""), "a👍中́");
  for (const g of graphemes) {
    assert.equal(hasLoneSurrogate(g), false);
  }
});

test("charSimilarity 边界", () => {
  assert.equal(charSimilarity("abc", "abc"), 1);
  assert.equal(charSimilarity("", "abc"), 0);
  assert.equal(charSimilarity("abc", ""), 0);
  assert.ok(charSimilarity("不向用户提及任何工具名。", "不向用户提及任何工具名") > 0.9);
  assert.ok(charSimilarity("完全无关的一句话", "another sentence entirely") < 0.3);
});

test("diffChars 对相同串返回单段 equal", () => {
  assert.deepEqual(diffChars("same", "same"), [{ type: "equal", text: "same" }]);
  assert.deepEqual(diffChars("", ""), []);
});

// --- 折叠与导航 ---------------------------------------------------------------

function buildLines(count: number, prefix = "line"): string[] {
  return Array.from({ length: count }, (_, i) => `${prefix} ${i + 1}`);
}

test("长段未变内容被折叠，改动两侧各留 3 行上下文", () => {
  const lines = buildLines(30);
  const changed = [...lines];
  changed[14] = "line 15 changed";
  const { rows } = diffTexts(lines.join("\n"), changed.join("\n"));
  const groups = groupDiffRows(rows);

  assert.deepEqual(
    groups.map((g) => g.type),
    ["collapsed", "visible", "collapsed"]
  );
  // 首段无上文：只保留改动前 3 行；尾段无下文：只保留改动后 3 行
  assert.equal(groups[0].rows.length, 11);
  assert.deepEqual(
    groups[1].rows.map((r) => r.type),
    ["equal", "equal", "equal", "modify", "equal", "equal", "equal"]
  );
  assert.equal(groups[2].rows.length, 12);
  assert.equal(groups[0].startIndex, 0);
  assert.equal(groups[1].startIndex, 11);
  assert.equal(
    groups.reduce((sum, g) => sum + g.rows.length, 0),
    rows.length
  );
});

test("短的未变段不折叠", () => {
  const { rows } = diffTexts("x\na\nb\nc\nd\ne\nf\ny", "X\na\nb\nc\nd\ne\nf\nY");
  const groups = groupDiffRows(rows);
  assert.deepEqual(
    groups.map((g) => g.type),
    ["visible"]
  );
});

test("折叠阈值与上下文行数可配", () => {
  const lines = buildLines(20);
  const changed = [...lines];
  changed[0] = "line 1 changed";
  const { rows } = diffTexts(lines.join("\n"), changed.join("\n"));
  const groups = groupDiffRows(rows, { contextLines: 1, minCollapsedRun: 2 });
  assert.deepEqual(
    groups.map((g) => g.type),
    ["visible", "collapsed"]
  );
  assert.equal(groups[0].rows.length, 2);
});

test("diffHunkStarts 按连续改动分段", () => {
  const { rows } = diffTexts("head\nbbbb\ncccc\nkeep\neeee", "head\nbbbX\ncccX\nkeep\needX");
  assert.deepEqual(
    rows.map((r) => r.type),
    ["equal", "modify", "modify", "equal", "modify"]
  );
  assert.deepEqual(diffHunkStarts(rows), [1, 4]);
  assert.deepEqual(diffHunkStarts([]), []);
});

test("无差异时没有可导航的改动", () => {
  const { rows } = diffTexts("a\nb", "a\nb");
  assert.deepEqual(diffHunkStarts(rows), []);
});

// --- 性能兜底 -----------------------------------------------------------------

test("2000 行局部改动走完整 LCS 且不超时", () => {
  const lines = buildLines(2000);
  const changed = lines.map((line, i) => (i % 10 === 0 ? `${line} edited` : line));
  const started = Date.now();
  const { stats, degraded } = diffTexts(lines.join("\n"), changed.join("\n"));
  const elapsed = Date.now() - started;

  assert.equal(degraded, false);
  assert.equal(stats.modified, 200);
  assert.equal(stats.unchanged, 1800);
  assert.ok(elapsed < 5000, `2000 行 diff 耗时 ${elapsed}ms`);
});

test("超过 DP 上限时降级为逐行比对且不出行内片段", () => {
  const size = 3000;
  assert.ok(size * size > MAX_LINE_DIFF_CELLS);
  const left = buildLines(size, "old").join("\n");
  const right = buildLines(size, "new").join("\n");
  const started = Date.now();
  const { rows, stats, degraded } = diffTexts(left, right);
  const elapsed = Date.now() - started;

  assert.equal(degraded, true);
  assert.equal(rows.length, size);
  assert.equal(stats.modified, size);
  assert.equal(
    rows.every((r) => r.segments === undefined),
    true
  );
  assert.ok(elapsed < 3000, `降级路径耗时 ${elapsed}ms`);
});

test("降级路径仍能识别同位未变行与长度差", () => {
  const size = 2100;
  const left = buildLines(size, "row");
  const right = [...left, "tail a", "tail b"];
  right[5] = "row 6 changed";
  const { stats, degraded } = diffTexts(left.join("\n"), right.join("\n"));
  assert.equal(degraded, true);
  assert.equal(stats.modified, 1);
  assert.equal(stats.added, 2);
  assert.equal(stats.unchanged, size - 1);
});

test("超长单行降级为整段替换但仍保留公共首尾", () => {
  const head = "前缀".repeat(10);
  const tail = "后缀".repeat(10);
  const segments = diffChars(
    `${head}${"甲".repeat(900)}${tail}`,
    `${head}${"乙".repeat(900)}${tail}`
  );
  assert.deepEqual(
    segments.map((s) => s.type),
    ["equal", "remove", "add", "equal"]
  );
  assert.equal(segments[0].text, head);
  assert.equal(segments[3].text, tail);
});
