import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import vm from "node:vm";
import ts from "typescript";

function load(file: string, imports: Record<string, unknown> = {}) {
  const exports: Record<string, (...args: unknown[]) => unknown> = {};
  vm.runInNewContext(
    ts.transpileModule(readFileSync(file, "utf8"), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText,
    {
      exports,
      console: { log() {}, error() {} },
      process,
      require(name: string) {
        assert.ok(name in imports, name);
        return imports[name];
      },
    }
  );
  return exports;
}
const helpers = load("lib/qaBusinessError.ts");

for (const [code, expected] of [
  ["USER_CREDIT_ACCOUNT_BUSY", "user_credit_account_busy"],
  ["USER_CREDIT_RECONCILIATION_REQUIRED", "user_credit_reconciliation_required"],
]) {
  test(`structured ${code} preserves a readable message and business code`, () => {
    const error = helpers.makeQaBackendError(
      409,
      JSON.stringify({ detail: { code, message: "Wait for credit review" } })
    ) as Error;
    assert.equal(error.message, "Wait for credit review");
    assert.equal(helpers.creditChatCode(error), expected);
    assert.equal(
      helpers.creditChatCode({ response: { status: 409, data: { detail: { code } } } }),
      expected
    );
  });
  for (const stream of [false, true]) {
    test(`actual QA route forwards ${code} for stream=${stream} without fault logging`, async () => {
      let faults = 0;
      const error = helpers.makeQaBackendError(409, {
        detail: { code, message: "Wait for credit review" },
      });
      const signal = new AbortController().signal;
      const route = load("pages/api/chat/qa.ts", {
        "@/lib/auth": { requireAuth: () => true },
        "@/lib/qaCore": {
          runQA: async () => {
            throw error;
          },
        },
        "@/lib/qaBusinessError": helpers,
        "@/lib/qaCancellation": { watchQaDisconnect: () => ({ signal, dispose() {} }) },
        "@/lib/logError": {
          logError: () => {
            faults++;
          },
        },
      });
      const res = {
        statusCode: 200,
        body: null as Record<string, unknown> | null,
        frames: "",
        destroyed: false,
        writableEnded: false,
        setHeader() {},
        flushHeaders() {},
        status(status: number) {
          this.statusCode = status;
          return this;
        },
        json(body: Record<string, unknown>) {
          this.body = body;
          return this;
        },
        write(frame: string) {
          this.frames += frame;
        },
        end() {
          this.writableEnded = true;
        },
      };
      await route.default({ method: "POST", body: { question: "fixture", stream } }, res);
      if (stream) assert.ok(res.frames.includes(`"code":"${expected}"`));
      else {
        assert.equal(res.statusCode, 409);
        assert.equal(res.body?.code, expected);
      }
      assert.equal(faults, 0);
    });
  }
}

test("unknown conflicts do not become known credit states; 402 stays insufficient balance", () => {
  assert.equal(helpers.creditChatCode({ statusCode: 409, code: "OTHER_CONFLICT" }), undefined);
  assert.equal(helpers.creditChatCode({ statusCode: 402 }), "insufficient_balance");
  const error = helpers.makeQaBackendError(503, "<html>gateway</html>") as Error;
  assert.equal(error.message, "External service error (503)");
});
