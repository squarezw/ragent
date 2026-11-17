import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import { createRequire } from "node:module";
import ts from "typescript";
import * as policy from "../lib/workspaceRoutePolicy.ts";
import * as logout from "../lib/localLogout.ts";
import * as locale from "../i18n/config.ts";

const draft = {
  base_url: " http://fixture:8086/v1 ",
  api_model: " model ",
  auth_mode: "none",
  api_key: "",
  display_name: "unsaved",
  clear_api_key: false,
};
function harness(overrides: Record<string, unknown> = {}) {
  const source = ts.createSourceFile(
    "manager.tsx",
    readFileSync(new URL("../components/TenantModelsManager.tsx", import.meta.url), "utf8"),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX
  );
  let code = "";
  function visit(node: ts.Node) {
    if (
      ts.isVariableDeclaration(node) &&
      node.name.getText(source) === "testConnection" &&
      node.initializer
    )
      code = node.initializer.getText(source);
    ts.forEachChild(node, visit);
  }
  visit(source);
  assert.ok(code);
  const calls: { path: string; body: Record<string, unknown> }[] = [];
  const results: unknown[] = [];
  const context = {
    draft,
    tenantId: "8",
    busy: false,
    testBusy: { current: false },
    currentDraft: { current: { draft, tenantId: "8" } },
    editing: null,
    setBusy() {},
    setTesting() {},
    setTestResult(value: unknown) {
      results.push(value);
    },
    t: (key: string) => key,
    axios: {
      post: async (path: string, body: Record<string, unknown>) => {
        calls.push({ path, body });
        return { data: { ok: true, test_prompt: "Repeat nonce-123", reply: "nonce-123" } };
      },
    },
    ...overrides,
  };
  const module = { exports: null as unknown };
  vm.runInNewContext(
    ts.transpileModule(`module.exports = ${code}`, {
      compilerOptions: { target: ts.ScriptTarget.ES2020 },
    }).outputText,
    { ...context, module }
  );
  return { context, calls, results, invoke: module.exports as () => Promise<void> };
}

test("test uses the unsaved connection draft without saving or sending history/tool data", async () => {
  const h = harness();
  await h.invoke();
  assert.equal(h.calls[0].path, "/api/v1/llm-models/custom/test");
  assert.deepEqual(Object.keys(h.calls[0].body).sort(), [
    "api_model",
    "auth_mode",
    "base_url",
    "owner_tenant_id",
  ]);
  assert.equal(h.calls[0].body.base_url, "http://fixture:8086/v1");
  assert.equal(h.calls[0].body.api_model, "model");
  assert.equal((h.results.at(-1) as { reply: string }).reply, "nonce-123");
  assert.equal((h.results.at(-1) as { test_prompt: string }).test_prompt, "Repeat nonce-123");
});

test("new bearer needs a key; stored key is reused by code; typed keys override; none omits key", async () => {
  for (const key of ["", "******", "••••"]) {
    const h = harness({ draft: { ...draft, auth_mode: "bearer", api_key: key } });
    await h.invoke();
    assert.equal(h.calls.length, 0);
  }
  for (const key of ["", "new-key"]) {
    const edited = { ...draft, auth_mode: "bearer", api_key: key };
    const h = harness({
      draft: edited,
      currentDraft: { current: { draft: edited, tenantId: "8" } },
      editing: { code: "custom-1", has_api_key: true },
    });
    await h.invoke();
    assert.equal(h.calls[0].body.model_code, "custom-1");
    assert.equal(h.calls[0].body.api_key, key || undefined);
  }
  const none = harness({ draft: { ...draft, api_key: "stale-key" } });
  await none.invoke();
  assert.equal("api_key" in none.calls[0].body, false);
});

test("test locks same-tick duplicate clicks and ignores replaced drafts", async () => {
  let resolve: (value: unknown) => void = () => {};
  let requests = 0;
  const h = harness({
    axios: {
      post: () => {
        requests++;
        return new Promise((done) => {
          resolve = done;
        });
      },
    },
  });
  const first = h.invoke();
  await h.invoke();
  assert.equal(requests, 1);
  h.context.currentDraft.current = { draft: { ...draft, api_model: "changed" }, tenantId: "8" };
  resolve({ data: { ok: true, reply: "old result" } });
  await first;
  assert.deepEqual(h.results, [null]);
  assert.equal(h.context.testBusy.current, false);
});

test("safe backend failure text is preserved without raw response fallback", async () => {
  const message = "safe model failure";
  const h = harness({
    axios: {
      post: async () => {
        throw {
          response: {
            data: { detail: { code: "MODEL_TEST_FAILED", message }, raw_body: "private" },
          },
        };
      },
    },
  });
  await h.invoke();
  assert.equal((h.results.at(-1) as { message: string }).message, message);
});

test("model test proxy forwards only its exact POST route", async () => {
  let options: { path: string; allow: string[] } | undefined;
  const module = { exports: {} as { default?: (req: unknown, res: unknown) => Promise<void> } };
  vm.runInNewContext(
    ts.transpileModule(
      readFileSync(new URL("../pages/api/v1/llm-models/custom/test.ts", import.meta.url), "utf8"),
      { compilerOptions: { module: ts.ModuleKind.CommonJS } }
    ).outputText,
    {
      module,
      exports: module.exports,
      require: () => ({
        proxySkillsApi: async (_req: unknown, _res: unknown, value: typeof options) => {
          options = value;
        },
      }),
    }
  );
  assert.ok(module.exports.default);
  await module.exports.default({}, {});
  assert.equal(options?.path, "/api/v1/llm-models/custom/test");
  assert.deepEqual(Array.from(options?.allow || []), ["POST"]);
});

test("actual middleware requires workspace, allows scoped test, and blocks unknown child", async () => {
  const next = createRequire(import.meta.url)("next/server");
  const module = { exports: {} as { middleware?: (request: unknown) => Response } };
  vm.runInNewContext(
    ts.transpileModule(readFileSync(new URL("../middleware.ts", import.meta.url), "utf8"), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
    }).outputText,
    {
      module,
      exports: module.exports,
      Headers,
      process,
      require: (name: string) =>
        name === "next/server"
          ? next
          : name.includes("workspaceRoutePolicy")
            ? policy
            : name.includes("localLogout")
              ? logout
              : locale,
    }
  );
  assert.ok(module.exports.middleware);
  const response = module.exports.middleware(
    new next.NextRequest("https://example.test/api/v1/llm-models/custom/test", { method: "POST" })
  );
  assert.equal(response.status, 409);
  const scoped = module.exports.middleware(
    new next.NextRequest("https://example.test/api/v1/llm-models/custom/test", {
      method: "POST",
      headers: { "x-workspace-tenant-id": "8" },
    })
  );
  assert.equal(scoped.headers.get("x-middleware-next"), "1");
  const unknown = module.exports.middleware(
    new next.NextRequest("https://example.test/api/v1/llm-models/custom/test/unknown", {
      method: "POST",
      headers: { "x-workspace-tenant-id": "8" },
    })
  );
  assert.equal(unknown.status, 501);
});

test("returned text remains actual plain reply and empty replies never appear successful", async () => {
  for (const reply of ["", "   ", undefined]) {
    const h = harness({ axios: { post: async () => ({ data: { ok: true, reply } }) } });
    await h.invoke();
    const result = h.results.at(-1) as { ok: boolean; message: string; reply: string };
    assert.equal(result.ok, false);
    assert.equal(result.message, "tenantModelsTestEmptyReply");
    assert.equal(result.reply, reply || "");
  }
  const reply = "  actual response\nfrom model  ";
  const h = harness({ axios: { post: async () => ({ data: { ok: true, reply } }) } });
  await h.invoke();
  const result = h.results.at(-1) as { ok: boolean; message: string; reply: string };
  assert.equal(result.ok, true);
  assert.equal(result.message, "tenantModelsTestSuccess");
  assert.equal(result.reply, reply);
});
