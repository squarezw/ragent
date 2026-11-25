import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

const source = readFileSync(new URL("../app/knowledge/components/DocumentName.tsx", import.meta.url), "utf8");
const exports = {} as { fitDocumentName(name: string, width: number, measure: (s: string) => number): string };
vm.runInNewContext(ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 },
}).outputText, { exports, require: createRequire(import.meta.url), Intl });

const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });
const width = (text: string) => [...segmenter.segment(text)].length;
test("names that fit retain every character", () => {
  for (const name of ["", "例子.pdf", "a b.pdf", "cafe\u0301.txt"]) {
    assert.equal(exports.fitDocumentName(name, width(name), width), name);
  }
});
test("abbreviation responds to available width and retains intact graphemes on each end", () => {
  const name = "你👨‍👩‍👧‍👦甲乙丙丁戊己庚辛好";
  assert.equal(exports.fitDocumentName(name, 7, width), "你👨‍👩‍👧‍👦...辛好");
  assert.equal(exports.fitDocumentName(name, 5, width), "你...好");
  assert.equal(exports.fitDocumentName(name, width(name), width), name);
});
