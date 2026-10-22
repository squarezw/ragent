import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";

test("normal cancellation stays rejected without a global toast; real failures still notify", async () => {
  let reject: (error: any) => Promise<never>;
  const messages: string[] = [];
  const instance = { interceptors: { request: { use() {} }, response: { use(_ok: unknown, fail: typeof reject) { reject = fail; } } } };
  const mocks: Record<string, unknown> = {
    axios: { default: { create: () => instance, isCancel: (e: any) => e.__CANCEL__ === true } },
    sonner: { toast: { error: (message: string) => messages.push(message) } },
    "./apiError": { getApiErrorMessage: () => "server unavailable" },
    "./authUtils": { clearChatSelectionCache() {}, clearSwrCache() {} },
    "./sessionRenewal": { SessionRenewalError: class extends Error {} },
    "./browserAuthMode": { isCookieAuthMode: () => false },
  };
  const module = { exports: {} };
  vm.runInNewContext(ts.transpileModule(readFileSync(new URL("../lib/axios.ts", import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS },
  }).outputText, { module, exports: module.exports, require: (id: string) => mocks[id], window: {} });
  for (const error of [{ code: "ERR_CANCELED", message: "canceled" }, { __CANCEL__: true }]) {
    await assert.rejects(reject!(error), (actual) => actual === error);
    assert.deepEqual(messages, []);
  }
  const failure = { response: { status: 500 } };
  await assert.rejects(reject!(failure), (actual) => actual === failure);
  assert.deepEqual(messages, ["server unavailable"]);
});
