import assert from "node:assert/strict";
import { test } from "node:test";
import { attachmentPreviewResource } from "../lib/chatResourcePreview.ts";

test("Office and other attachments retain the original preview flow", () => {
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
