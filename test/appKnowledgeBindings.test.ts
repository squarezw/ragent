import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import { submitFromPage } from "./appCreateTenant.test.ts";

const source = ts.createSourceFile(
  "editor.tsx",
  readFileSync(
    new URL("../app/apps/components/AppKnowledgeBindingsEditor.tsx", import.meta.url),
    "utf8"
  ),
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TSX
);
function callback(name: string, context: Record<string, unknown>) {
  let code = "";
  function visit(node: ts.Node) {
    if (ts.isVariableDeclaration(node) && node.name.getText(source) === name && node.initializer)
      code = node.initializer.getText(source);
    ts.forEachChild(node, visit);
  }
  visit(source);
  assert.ok(code);
  const module = { exports: null as unknown };
  vm.runInNewContext(
    ts.transpileModule(`module.exports = ${code}`, {
      compilerOptions: { target: ts.ScriptTarget.ES2020 },
    }).outputText,
    { ...context, module }
  );
  return module.exports as () => Promise<void>;
}

test("ordinary editing omits dataset_ids and preserves stored/absent knowledge settings", async () => {
  for (const settings of [
    { unrelated: 3 },
    { auto_select_datasets: true, unrelated: 3 },
    { auto_select_datasets: false },
  ]) {
    const result = await submitFromPage(true, "8", true, { settings });
    assert.equal("dataset_ids" in result.calls[0].payload, false);
    assert.deepEqual(result.calls[0].payload.settings, settings);
  }
  const created = await submitFromPage(true, "8");
  assert.deepEqual(Array.from(created.calls[0].payload.dataset_ids as string[]), []);
  assert.equal(
    (created.calls[0].payload.settings as Record<string, unknown>).auto_select_datasets,
    false
  );
});

test("opening inherited settings never infers auto/manual or writes", async () => {
  for (const datasetIds of [[], ["old"]]) {
    let mode: unknown = "unset";
    let selected: unknown;
    let dirty: unknown = true;
    await callback("begin", {
      settings: {},
      datasetIds,
      setMode(value: unknown) {
        mode = value;
      },
      setSelected(value: unknown) {
        selected = value;
      },
      setDirty(value: unknown) {
        dirty = value;
      },
      setOpen() {},
    })();
    assert.equal(mode, null);
    assert.deepEqual(Array.from(selected as string[]), datasetIds);
    assert.equal(dirty, false);
  }
});

test("binding save writes only dedicated fields, and guards inherited/unchanged/failed state", async () => {
  for (const mode of [true, false]) {
    const calls: { path: string; body: Record<string, unknown> }[] = [];
    const context = {
      dirty: true,
      mode,
      loading: false,
      failed: false,
      saving: false,
      missing: [],
      selected: ["kb"],
      appId: 60,
      active: { current: true },
      setSaving() {},
      setOpen() {},
      onSaved: async () => {},
      toast: { success() {}, error() {} },
      t: (key: string) => key,
      axios: {
        put: async (path: string, body: Record<string, unknown>) => {
          calls.push({ path, body });
        },
      },
    };
    await callback("save", context)();
    assert.equal(calls[0].path, "/api/v1/apps/60/datasets");
    assert.equal(calls[0].body.auto_select_datasets, mode);
    assert.deepEqual(Array.from(calls[0].body.dataset_ids as string[]), mode ? [] : ["kb"]);
    assert.deepEqual(Object.keys(calls[0].body).sort(), ["auto_select_datasets", "dataset_ids"]);
    for (const blocked of [
      { dirty: false },
      { mode: null },
      { loading: true },
      { failed: true },
      { saving: true },
      ...(!mode ? [{ missing: ["unavailable"] }] : []),
    ]) {
      calls.length = 0;
      await callback("save", { ...context, ...blocked })();
      assert.equal(calls.length, 0);
    }
  }
});

test("dimension compatibility preserves the prior selector rule", () => {
  const blocked = callback("dimensionBlocked", {
    selectedDimension: 1536,
    selected: ["old"],
  }) as unknown as (dataset: { id: string; dimension?: number }) => boolean;
  assert.equal(blocked({ id: "new", dimension: 768 }), true);
  assert.equal(blocked({ id: "old", dimension: 768 }), false);
  assert.equal(blocked({ id: "new", dimension: 1536 }), false);
  assert.equal(blocked({ id: "new" }), false);
});

test("candidate loading filters tenants, ignores stale responses, and reports failure", async () => {
  let code = "";
  function visit(node: ts.Node) {
    if (
      ts.isCallExpression(node) &&
      node.expression.getText(source) === "useEffect" &&
      node.arguments[0]?.getText(source).includes('"/api/datasets"')
    )
      code = node.arguments[0].getText(source);
    ts.forEachChild(node, visit);
  }
  visit(source);
  assert.ok(code);
  const pending: { resolve: (value: unknown) => void; reject: (reason: unknown) => void }[] = [];
  const updates: { id: string }[][] = [];
  let failed = false;
  const module = { exports: null as unknown };
  vm.runInNewContext(
    ts.transpileModule(`module.exports = ${code}`, {
      compilerOptions: { target: ts.ScriptTarget.ES2020 },
    }).outputText,
    {
      module,
      open: true,
      ownerTenantId: 8,
      setLoading() {},
      setFailed(value: boolean) {
        failed = value;
      },
      setDatasets(value: { id: string }[]) {
        updates.push(value);
      },
      axios: { get: () => new Promise((resolve, reject) => pending.push({ resolve, reject })) },
    }
  );
  const load = module.exports as () => () => void;
  const cleanup = load();
  cleanup();
  pending[0].resolve({ data: [{ id: "stale", owner_tenant_id: 8 }] });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(updates.length, 1);
  load();
  pending[1].resolve({
    data: [
      { id: "same", owner_tenant_id: 8 },
      { id: "other", owner_tenant_id: 9 },
      { id: "public", visibility: "public", owner_tenant_id: 9 },
    ],
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(
    Array.from(updates.at(-1) || [], (item) => item.id),
    ["same", "public"]
  );
  load();
  pending[2].reject(new Error("unavailable"));
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(failed, true);
});

test("knowledge binding proxy uses the existing authenticated forwarding contract", async () => {
  const file = readFileSync(
    new URL("../pages/api/v1/apps/[id]/datasets/index.ts", import.meta.url),
    "utf8"
  );
  let forwarded: { req: unknown; options: { path: string; allow: string[] } } | undefined;
  const module = { exports: {} as { default?: (req: unknown, res: unknown) => Promise<void> } };
  vm.runInNewContext(
    ts.transpileModule(file, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText,
    {
      module,
      exports: module.exports,
      require: () => ({
        queryStr: (id: string) => id,
        proxySkillsApi: async (
          req: unknown,
          _res: unknown,
          options: { path: string; allow: string[] }
        ) => {
          forwarded = { req, options };
        },
      }),
    }
  );
  const req = {
    query: { id: "60" },
    method: "PUT",
    headers: { "x-workspace-tenant-id": "8" },
    body: { auto_select_datasets: false, dataset_ids: [] },
  };
  assert.ok(module.exports.default);
  await module.exports.default(req, {});
  assert.ok(forwarded);
  assert.equal(forwarded.req, req);
  assert.equal(forwarded.options.path, "/api/v1/apps/60/datasets");
  assert.deepEqual(Array.from(forwarded.options.allow), ["PUT"]);
});

test("ordinary editor removes the role shortcut without submitting persona content", async () => {
  const page = readFileSync(new URL("../app/apps/page.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(page, /ts\("agentMdMode"\)|ts\("editAgentMd"\)|ts\("agentMdModeDesc"\)/);
  const detail = readFileSync(new URL("../app/apps/[id]/page.tsx", import.meta.url), "utf8");
  assert.match(detail, /<AgentMdEditor/);
  const result = await submitFromPage(true, "8", true, {
    settings: { view_key: "existing", unrelated: "preserved" },
  });
  assert.equal("agent_md" in result.calls[0].payload, false);
  assert.equal("content" in result.calls[0].payload, false);
  assert.equal("system_prompt" in result.calls[0].payload, false);
  assert.deepEqual(result.calls[0].payload.settings, {
    view_key: "existing",
    unrelated: "preserved",
  });
});
