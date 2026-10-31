import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { test } from "node:test";
import ts from "typescript";
const compiled = ts.transpileModule(readFileSync(new URL("../lib/apiError.ts", import.meta.url), "utf8"), {
  compilerOptions: {module: ts.ModuleKind.CommonJS},
}).outputText;
const api: any = {};
runInNewContext(compiled, {exports: api});
test("tool migration conflicts display the server explanation, never an object", () => {
  assert.equal(api.getApiErrorMessage({response: {data: {detail: {
    code: "TOOL_TENANT_BINDINGS_CONFLICT", message: "Remove 2 conflicting bindings first", affected_app_count: 2,
  }}}}), "Remove 2 conflicting bindings first");
});
test("legacy detail strings and empty error fallbacks remain usable", () => {
  assert.equal(api.getApiErrorMessage({response: {data: {detail: "No access"}}}), "No access");
  assert.equal(api.getApiErrorMessage({}, "Unable to save"), "Unable to save");
});
