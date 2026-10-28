import assert from "node:assert/strict";
import { test } from "node:test";
// @ts-expect-error Node strip-types requires the explicit TypeScript extension.
import { uniqueFileReferences } from "../lib/fileReferences.ts";

test("session 2496: ten search references become two file chips in first-seen order", () => {
  const a = { id: 939, originalname: "checklist.xlsx", path: "uploads/a.xlsx" };
  const b = { id: 940, originalname: "rules.xlsx", path: "uploads/b.xlsx" };
  const references = Array.from({ length: 5 }, () => [a, b]).flat();
  assert.deepEqual(uniqueFileReferences(references), [a, b]);
  assert.equal(references.length, 10);
  assert.equal(uniqueFileReferences(references)[0], a);
});

test("same display name never merges different uploaded files", () => {
  const references = [
    { id: 1, originalname: "rules.xlsx" },
    { id: 2, originalname: "rules.xlsx" },
    { originalname: "rules.xlsx" },
    { originalname: "rules.xlsx" },
  ];
  assert.deepEqual(uniqueFileReferences(references), references);
});

test("legacy file identities use paths or storage filenames; numeric and string IDs agree", () => {
  const references = [
    { id: 939 },
    { id: "939" },
    { path: "uploads/a.xlsx" },
    { path: "uploads/a.xlsx" },
    { filename: "unique-b.xlsx" },
    { filename: "unique-b.xlsx" },
    { path: "uploads/c.xlsx" },
  ];
  assert.deepEqual(uniqueFileReferences(references), [
    references[0],
    references[2],
    references[4],
    references[6],
  ]);
  assert.deepEqual(uniqueFileReferences([]), []);
});

test("actual reference component shows two files while retaining all 25 segment citations", async () => {
  const { readFileSync } = await import("node:fs");
  const { createRequire } = await import("node:module");
  const { runInNewContext } = await import("node:vm");
  const ts = (await import("typescript")).default;
  const React = await import("react");
  const { renderToStaticMarkup } = await import("react-dom/server");
  const require = createRequire(import.meta.url);
  const exports: Record<string, any> = {};
  const source = readFileSync(
    new URL("../app/chat/components/ReferencesDisplay.tsx", import.meta.url),
    "utf8"
  );
  const icon = () => null;
  const imports: Record<string, unknown> = {
    "next-intl": {
      useTranslations: () => (key: string, values?: { count: number }) =>
        values ? `${key}:${values.count}` : key,
    },
    "lucide-react": { FileSpreadsheet: icon, FileText: icon, FileType: icon },
    "@/lib/fileReferences": { uniqueFileReferences },
    "react/jsx-runtime": require("react/jsx-runtime"),
  };
  runInNewContext(
    ts.transpileModule(source, {
      compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
    }).outputText,
    {
      exports,
      require: (name: string) => {
        assert.ok(name in imports, name);
        return imports[name];
      },
    }
  );
  const reference = Array.from({ length: 5 }, () => [
    { id: 939, originalname: "checklist.xlsx" },
    { id: 940, originalname: "rules.xlsx" },
  ]).flat();
  const segmentIds = Array.from({ length: 25 }, (_, index) => index % 7);
  const html = renderToStaticMarkup(
    React.createElement(exports.default, {
      reference,
      segmentIds,
      messageIndex: 0,
      segmentsLoading: {},
      onOpenReferencesDialog() {},
      onPreviewFile() {},
    })
  );
  assert.equal(html.split("checklist.xlsx").length - 1, 1);
  assert.equal(html.split("rules.xlsx").length - 1, 1);
  assert.ok(html.includes("viewReferences:25"));
  assert.equal(reference.length, 10);
  assert.equal(segmentIds.length, 25);
});
