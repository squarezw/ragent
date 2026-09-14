import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const panel = readFileSync("app/chat/components/ResourcePreviewPanel.tsx", "utf-8");
const zhChat = JSON.parse(readFileSync("messages/zh-CN/chat.json", "utf-8"));
const enChat = JSON.parse(readFileSync("messages/en/chat.json", "utf-8"));

test("resource preview puts the external-open action in the accessible header toolbar", () => {
  assert.match(panel, /TooltipProvider/, "the header action should provide a visible tooltip");
  assert.match(
    panel,
    /aria-label=\{t\("openInNewTab"\)\}/,
    "the external link needs a localized accessible name"
  );
  assert.match(
    panel,
    /href=\{resource\.url\} rel="noopener noreferrer" target="_blank"/,
    "the external link must retain safe new-tab handling"
  );
  assert.match(panel, /<ExternalLink/, "the external link should use an icon");
  assert.match(
    panel,
    /<TooltipContent>\{t\("openInNewTab"\)\}<\/TooltipContent>/,
    "the external link tooltip should use its localized label"
  );
  assert.doesNotMatch(
    panel,
    /className="w-full"/,
    "the former full-width footer action should be removed"
  );
});

test("DXF previews expose an original-file download without using the preview proxy", () => {
  assert.match(
    panel,
    /resource\.kind === "dxf"/,
    "download action should only render for DXF resources"
  );
  assert.match(
    panel,
    /aria-label=\{t\("downloadOriginalDrawing"\)\}/,
    "the download action needs a localized accessible name"
  );
  assert.match(
    panel,
    /<a download href=\{resource\.url\}>/,
    "the download should use the original resource URL"
  );
  assert.match(panel, /<Download/, "the download should use an icon");
  assert.match(
    panel,
    /<TooltipContent>\{t\("downloadOriginalDrawing"\)\}<\/TooltipContent>/,
    "the download tooltip should use its localized label"
  );
  assert.doesNotMatch(
    panel,
    /download href=\{`\/api\/chat\/preview-dxf/,
    "the download must not use the DXF preview proxy"
  );
});

test("resource preview action translations stay in sync", () => {
  for (const key of ["openInNewTab", "downloadOriginalDrawing"]) {
    assert.equal(typeof zhChat[key], "string", `missing Chinese ${key} translation`);
    assert.ok(zhChat[key].trim(), `Chinese ${key} translation is empty`);
    assert.equal(typeof enChat[key], "string", `missing English ${key} translation`);
    assert.ok(enChat[key].trim(), `English ${key} translation is empty`);
  }
});
