import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import * as receipts from "../lib/chatTurnArtifacts.ts";
import * as preview from "../lib/chatResourcePreview.ts";

const require = createRequire(import.meta.url);
const dependencies = {
  "@/lib/chatTurnArtifacts": receipts,
  "@/lib/chatResourcePreview": preview,
  "@/lib/workspaceBrowser": { workspaceUrl: x => x },
  "next-intl": { useTranslations: () => key => key },
};
function load(file) {
  const mod = { exports: {} };
  const source = readFileSync(new URL(file, import.meta.url), "utf8");
  const { outputText } = ts.transpileModule(source, { compilerOptions: {
    jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true,
  } });
  vm.runInNewContext(outputText, { exports: mod.exports, module: mod, require: name => dependencies[name] ?? require(name) });
  return mod.exports.default;
}
const Cards = load("../app/chat/components/ChatArtifactCards.tsx");
const Markdown = load("../components/MarkdownRenderer.tsx");
const files = receipts.turnArtifacts(7, [
  { id: "00000000-0000-4000-8000-000000000001", filename: "lark-qr.png" },
  { id: "00000000-0000-4000-8000-000000000002", filename: "reports/报价单.xlsx" },
]);

test("attachment cards display compact file icons and names with no assistant text", () => {
  const html = renderToStaticMarkup(createElement(Cards, { artifacts: files, onPreviewResource() {} }));
  assert.doesNotMatch(html, /<img\b/);
  assert.ok(html.includes("lark-qr.png"));
  assert.ok(html.includes("<button"));
  assert.ok(html.includes(`href="${files[1].url}"`));
  assert.ok(html.includes('download="报价单.xlsx"'));
  assert.equal(renderToStaticMarkup(createElement(Cards, { artifacts: [] })), "");
});

test("Markdown and sanitized HTML relative files resolve only against this message's receipts", () => {
  for (const content of ['<img alt="QR" src="lark-qr.png">', '![QR](./lark-qr.png)']) {
    const html = renderToStaticMarkup(createElement(Markdown, { content, artifacts: files }));
    assert.ok(html.includes(`src="${files[0].url}"`));
    const old = renderToStaticMarkup(createElement(Markdown, { content, artifacts: [] }));
    assert.ok(!old.includes("<img"));
  }
  const html = renderToStaticMarkup(createElement(Markdown, { content: "[报价](reports/报价单.xlsx)", artifacts: files }));
  assert.ok(html.includes(`href="${files[1].url}"`));
});
