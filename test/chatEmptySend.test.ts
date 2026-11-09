import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import test from "node:test";
import ts from "typescript";

function callback(path: string, name: string, context: Record<string, unknown>) {
  const source = ts.createSourceFile(path, readFileSync(new URL(path, import.meta.url), "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let expression = "";
  function visit(node: ts.Node) {
    if (ts.isVariableDeclaration(node) && node.name.getText(source) === name && node.initializer)
      expression = node.initializer.getText(source);
    ts.forEachChild(node, visit);
  }
  visit(source);
  assert.ok(expression);
  const module = { exports: undefined as any };
  runInNewContext(ts.transpileModule(`module.exports = ${expression}`, {
    compilerOptions: { target: ts.ScriptTarget.ES2020 },
  }).outputText, { module, useCallback: (fn: unknown) => fn, ...context });
  return module.exports;
}

for (const input of ["", " ", "\n\t"]) {
  test(`Enter with attachment and blank input ${JSON.stringify(input)} does not submit`, () => {
    let sends = 0;
    let prevented = false;
    const handler = callback("../app/chat/components/ChatInputComposite.tsx", "handleKeyDown", {
      input, canSend: callback("../app/chat/components/ChatInputComposite.tsx", "canSend", {
        input, attachments: [{ filename: "report.pdf" }],
      }), attachments: [{ filename: "report.pdf" }],
      loading: false, isStreaming: false, uploading: false, onSend: () => sends++,
    });
    handler({ key: "Enter", preventDefault() { prevented = true; } });
    assert.equal(sends, 0);
    assert.equal(prevented, true);
  });
  test(`send handler preserves attachment and draft when input ${JSON.stringify(input)} is blank`, async () => {
    // No state setters are supplied: attempting any mutation fails this regression.
    const handler = callback("../app/chat/page.tsx", "handleSend", {
      input, attachments: [{ filename: "report.pdf" }], loading: false,
      uploading: false, loadingHistorySession: false,
    });
    await handler();
  });
}

test("text Enter sends once; busy states and modified Enter do not send", () => {
  for (const options of [{}, { loading: true }, { uploading: true }, { isStreaming: true }, { shiftKey: true }, { ctrlKey: true }, { metaKey: true }, { altKey: true }]) {
    let sends = 0;
    const handler = callback("../app/chat/components/ChatInputComposite.tsx", "handleKeyDown", {
      input: "question", canSend: true, loading: false, isStreaming: false, uploading: false,
      onSend: () => sends++, ...options,
    });
    handler({ key: "Enter", preventDefault() {}, ...options });
    assert.equal(sends, Object.keys(options).length ? 0 : 1);
  }
});
