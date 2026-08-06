import assert from "node:assert/strict";
import { test } from "node:test";
import {
  ATTACHMENT_ACCEPT,
  ATTACHMENT_EXTENSIONS,
  isAllowedAttachment,
} from "../lib/chatAttachments.ts";

// ---------------------------------------------------------------------------
// CSV —— 本次修复的目标
//
// CSV 的 file.type 因操作系统而异，逐个都要能过。只按 MIME 判会得到
// 「我这能传、同事那不能传」这种查不出原因的故障。
// ---------------------------------------------------------------------------

const CSV_MIMES: Array<[string, string | undefined]> = [
  ["macOS / 多数浏览器", "text/csv"],
  ["装了 Excel 的 Windows", "application/vnd.ms-excel"],
  ["部分 Linux 环境", "application/csv"],
  ["认不出类型时", ""],
  ["字段缺失时", undefined],
];

for (const [label, mime] of CSV_MIMES) {
  test(`CSV 可上传 —— ${label}（MIME=${JSON.stringify(mime)}）`, () => {
    assert.equal(isAllowedAttachment("data.csv", mime), true);
  });
}

test("CSV 大写扩展名同样放行", () => {
  assert.equal(isAllowedAttachment("REPORT.CSV", ""), true);
});

// ---------------------------------------------------------------------------
// 扩展名优先于 MIME
// ---------------------------------------------------------------------------

test("扩展名认得出就放行，不看 MIME", () => {
  assert.equal(isAllowedAttachment("图纸.ai", "application/octet-stream"), true);
  assert.equal(isAllowedAttachment("合同.pdf", ""), true);
});

test("没有扩展名时用 MIME 兜底（拖拽粘贴的截图）", () => {
  assert.equal(isAllowedAttachment("blob", "image/png"), true);
});

test("扩展名和 MIME 都认不出才拒绝", () => {
  assert.equal(isAllowedAttachment("setup.exe", "application/x-msdownload"), false);
  assert.equal(isAllowedAttachment("archive.zip", "application/zip"), false);
  assert.equal(isAllowedAttachment("", ""), false);
});

test("扩展名只匹配结尾，不匹配中间", () => {
  // "note.csv.exe" 是可执行文件，不是 CSV
  assert.equal(isAllowedAttachment("note.csv.exe", ""), false);
});

// ---------------------------------------------------------------------------
// accept 与校验同源
//
// 这个 bug 的成因：accept 属性和校验白名单是两份各写各的清单，.csv 两边都漏了。
// 只要还是两份，就会再次分叉——所以这里断言它们同源。
// ---------------------------------------------------------------------------

test("accept 由扩展名清单生成", () => {
  assert.equal(ATTACHMENT_ACCEPT, ATTACHMENT_EXTENSIONS.join(","));
});

test("accept 里的每一项都真的能通过校验", () => {
  for (const ext of ATTACHMENT_ACCEPT.split(",")) {
    assert.equal(isAllowedAttachment(`file${ext}`, ""), true, `${ext} 选得中却传不上`);
  }
});
