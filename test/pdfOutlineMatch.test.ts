import assert from "node:assert/strict";
import { test } from "node:test";
import { matchHeadings, type PdfLine } from "../lib/pdfOutlineMatch.ts";

// 构造 PdfLine 的小助手：默认放在正文页（pageIndex=18），与真实文档对齐
const line = (text: string, y: number, pageIndex = 18): PdfLine => ({ pageIndex, y, text });

// 真实回归样本：ZSH-P-15-L3-015 内控考核条例 7.3 节。
// 7.3.2 是整句当标题，PDF 里行宽放不下被折成两行 —— 旧逻辑（单行 includes）漏掉了它。
const H = {
  s1: { level: 3, text: "7.3.1 罚款的金额在当月工资中予以结算及重复发生的KPI考核。" },
  s2: {
    level: 3,
    text: "7.3.2 处罚以书面告知当事人，并由处罚人做好记录，记录的内容必须包括：被处罚或被奖励人姓名、时间、适用的奖惩细则、具体内容。",
  },
  s3: {
    level: 3,
    text: "7.3.3 奖惩记录周期同薪资结算周期，财务部发现案例，当即在OA内开具奖罚单。",
  },
};

test("折行标题：跨两行的长标题应被定位（7.3.2 回归）", () => {
  const lines = [
    line("7.3.1罚款的金额在当月工资中予以结算及重复发生的KPI考核。", 236),
    line("7.3.2处罚以书面告知当事人，并由处罚人做好记录，记录的内容必须包括：被处罚或被", 214),
    line("奖励人姓名、时间、适用的奖惩细则、具体内容。", 198),
    line("7.3.3奖惩记录周期同薪资结算周期，财务部发现案例，当即在OA内开具奖罚单。", 177),
  ];

  const { located, missing } = matchHeadings(lines, [H.s1, H.s2, H.s3]);

  assert.equal(missing.length, 0, "三条标题都应命中");
  assert.equal(located.length, 3);

  const s2 = located[1];
  // 跳转坐标取折行的首行 y，而不是末行
  assert.equal(s2.pageIndex, 18);
  assert.equal(s2.y, 214);
  // 书签标题是两行拼接后的完整文字
  assert.equal(
    s2.title,
    "7.3.2处罚以书面告知当事人，并由处罚人做好记录，记录的内容必须包括：被处罚或被奖励人姓名、时间、适用的奖惩细则、具体内容。"
  );
});

test("短标题：单行命中走原路径", () => {
  const lines = [line("1文件目的", 700), line("2适用范围", 650)];
  const { located, missing } = matchHeadings(lines, [
    { level: 1, text: "1 文件目的" },
    { level: 1, text: "2 适用范围" },
  ]);
  assert.equal(missing.length, 0);
  assert.deepEqual(
    located.map((l) => l.title),
    ["1文件目的", "2适用范围"]
  );
});

test("排除目录：单调游标先在正文命中，目录页（点引导符+页码）被跳过", () => {
  const lines = [
    // 目录页：每条都是 点引导符 + 尾随页码
    line(
      "7.3.1罚款的金额在当月工资中予以结算及重复发生的KPI考核。............40",
      169,
      /* page */ 2
    ),
    line("7.3.3奖惩记录周期同薪资结算周期，财务部发现案例，当即在OA内开具奖罚单。......40", 150, 2),
    // 正文页
    line("7.3.1罚款的金额在当月工资中予以结算及重复发生的KPI考核。", 236),
    line("7.3.3奖惩记录周期同薪资结算周期，财务部发现案例，当即在OA内开具奖罚单。", 177),
  ];
  const { located, missing } = matchHeadings(lines, [H.s1, H.s3]);
  assert.equal(missing.length, 0);
  // 命中的是正文页（18）而不是目录页（2）
  assert.deepEqual(
    located.map((l) => l.pageIndex),
    [18, 18]
  );
});

test("超长正文引用：仅在比标题长很多的整行里出现的标题，不当作标题命中", () => {
  const lines = [
    line(
      "如7.3.1罚款的金额在当月工资中予以结算及重复发生的KPI考核。所述，相关人员还需另行说明情况并提交书面材料以备审查与归档，本行明显长于标题本身。",
      500
    ),
  ];
  const { located, missing } = matchHeadings(lines, [H.s1]);
  assert.equal(located.length, 0);
  assert.deepEqual(missing, [H.s1.text]);
});

test("缺失标题：PDF 里找不到对应文本则进 missing", () => {
  const lines = [line("7.3.1罚款的金额在当月工资中予以结算及重复发生的KPI考核。", 236)];
  const { located, missing } = matchHeadings(lines, [H.s1, H.s2]);
  assert.equal(located.length, 1);
  assert.deepEqual(missing, [H.s2.text]);
});

test("重复标题：单调游标让相同标题文本依次落到先后两处", () => {
  const dup = { level: 2, text: "小结" };
  const lines = [line("小结", 600, 1), line("小结", 600, 5)];
  const { located } = matchHeadings(lines, [dup, dup]);
  assert.equal(located.length, 2);
  assert.deepEqual(
    located.map((l) => l.pageIndex),
    [1, 5]
  );
});
