import assert from "node:assert/strict";
import { test } from "node:test";
import { attachmentPreviewResource } from "../lib/chatResourcePreview.ts";

test("Office and other attachments are excluded from side preview", () => {
  for (const filename of ["a.doc", "a.docx", "a.xls", "a.xlsx", "a.pdf", "a.dwg"]) {
    assert.equal(attachmentPreviewResource({ filename, url: "https://example.com/a" }), null);
  }
});
test("chat drawing, HTML and image attachments use the side panel", () => {
  for (const [filename, kind] of [["a.dxf", "dxf"], ["a.html", "url"], ["a.png", "image"]]) {
    assert.equal(attachmentPreviewResource({ filename, url: "/api/oss/chat/file" })?.kind, kind);
  }
  assert.equal(attachmentPreviewResource({ filename: "a.dxf" }), null);
  assert.equal(attachmentPreviewResource({ filename: "a.html", url: "javascript:alert(1)" }), null);
});

test("Only HTML, images and DXF are previewable in chat", async () => {
  const { isChatDownloadOnly } = await import("../lib/chatResourcePreview.ts");
  for (const name of ["a.xlsx", "a.XLS", "a.xlsm", "a.xlsb", "a.md", "https://example.com/a.xlsx?signature=x"]) {
    assert.equal(isChatDownloadOnly(name), true);
  }
  assert.equal(isChatDownloadOnly("file", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"), true);
  assert.equal(isChatDownloadOnly("a.docx"), true);
  assert.equal(isChatDownloadOnly("a.zip"), true);
  assert.equal(isChatDownloadOnly("a.pdf"), true);
  assert.equal(isChatDownloadOnly("a.html"), false);
});
