import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { test } from "node:test";
import ts from "typescript";
function compile(file: string, require: (name: string) => any = () => { throw Error("Unexpected import"); }) {
  const api: any = {};
  runInNewContext(ts.transpileModule(readFileSync(new URL(file, import.meta.url), "utf8"), {
    compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022},
  }).outputText, {exports: api, require, AbortController, TextDecoder, console,
    fetch: async () => new Response(new ReadableStream({start(controller) {
      const warning = 'event: workspace_warning\ndata: {"code":"WORKSPACE_BINDINGS_SKIPPED","skipped":{"skills":1,"tools":0,"datasets":1}}\n\n';
      const text = warning + warning + 'data: {"v":"conversion continues"}\n\ndata: [DONE]\n\n';
      // Deliberately split both JSON and named event lines across network chunks.
      const bytes = new TextEncoder().encode(text);
      for (let i = 0; i < bytes.length; i += 7) controller.enqueue(bytes.slice(i, i + 7));
      controller.close();
    }})),
  });
  return api;
}
test("skipped-binding warning fires once and split SSE still delivers the answer", {timeout: 3000}, async () => {
  const sse = compile("../lib/chatSse.ts");
  const api = compile("../hooks/useChatSession.ts", (name) => {
    if (name === "@/lib/chatSse") return sse;
    if (name === "react") return {useState: (value: unknown) => [value, () => {}], useCallback: (fn: unknown) => fn};
    if (name === "@/lib/sessionRenewal") return {ensureSessionCurrent: async () => {}, renewSession: async () => {}};
    if (name === "@/lib/axios") return {};
    if (name === "@/types/token-usage") return {normalizeTurnUsage: (v: unknown) => v};
    throw Error(name);
  });
  const warnings: unknown[] = [];
  let answer = "";
  const completed = new Promise<void>((resolve, reject) => {
    api.useChatSession().askStream("convert", [], {}, {
      onWorkspaceWarning: (warning: unknown) => warnings.push(warning),
      onChunk: (chunk: string) => {answer += chunk;},
      onComplete: () => resolve(), onError: reject,
    });
  });
  await completed;
  assert.equal(warnings.length, 1);
  assert.equal(answer, "conversion continues");
  assert.equal(JSON.stringify(warnings).includes("PRIVATE"), false);
});
