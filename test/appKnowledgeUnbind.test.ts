import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

const source = ts.createSourceFile(
  "page.tsx",
  readFileSync(new URL("../app/apps/[id]/page.tsx", import.meta.url), "utf8"),
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
  return module.exports as (...args: unknown[]) => Promise<void>;
}
function harness(overrides: Record<string, unknown> = {}) {
  const calls: unknown[][] = [];
  const errors: string[] = [];
  let refreshed = 0;
  let target: unknown = { dataset_id: "kb/中文 ?", name: "Knowledge" };
  let busy = false;
  const context = {
    datasetUnbindTarget: target,
    datasetUnbindBusy: { current: false },
    canEditThisApp: true,
    appId: 60,
    setDatasetUnbinding(value: boolean) {
      busy = value;
    },
    setDatasetUnbindTarget(value: unknown) {
      target = value;
    },
    loadAppInfo: async () => {
      refreshed++;
    },
    axios: {
      delete: async (...args: unknown[]) => {
        calls.push(args);
      },
    },
    t: (key: string) => key,
    toast: {
      success() {},
      error(message: string) {
        errors.push(message);
      },
    },
    ...overrides,
  };
  return {
    context,
    calls,
    errors,
    refreshed: () => refreshed,
    target: () => target,
    busy: () => busy,
  };
}

test("confirmation deletes only the exact target with no body and refreshes", async () => {
  const h = harness();
  let prevented = false;
  await callback(
    "handleDatasetUnbind",
    h.context
  )({
    preventDefault() {
      prevented = true;
    },
  });
  assert.equal(prevented, true);
  assert.deepEqual(h.calls, [["/api/v1/apps/60/datasets/kb%2F%E4%B8%AD%E6%96%87%20%3F"]]);
  assert.equal(h.refreshed(), 1);
  assert.equal(h.target(), null);
  assert.equal(h.busy(), false);
});

test("cancel only closes confirmation, and busy confirmation cannot close or duplicate", async () => {
  const canceled = harness();
  await callback("handleDatasetUnbindOpenChange", canceled.context)(false);
  assert.equal(canceled.target(), null);
  assert.equal(canceled.calls.length, 0);
  let resolve: () => void = () => {};
  let requests = 0;
  const h = harness({
    axios: {
      delete: () => {
        requests++;
        return new Promise<void>((done) => {
          resolve = done;
        });
      },
    },
  });
  const confirm = callback("handleDatasetUnbind", h.context);
  const first = confirm();
  await confirm();
  await callback("handleDatasetUnbindOpenChange", h.context)(false);
  assert.equal(requests, 1);
  assert.notEqual(h.target(), null);
  resolve();
  await first;
  assert.equal(h.target(), null);
});

test("failure retains target and reports error; missing target or read-only cannot delete", async () => {
  const h = harness({
    axios: {
      delete: async () => {
        throw new Error("failed");
      },
    },
  });
  await callback("handleDatasetUnbind", h.context)();
  assert.equal(h.refreshed(), 0);
  assert.notEqual(h.target(), null);
  assert.deepEqual(h.errors, ["knowledgeUnbindFailed"]);
  assert.equal(h.busy(), false);
  for (const overrides of [
    { datasetUnbindTarget: null },
    { canEditThisApp: false },
    { datasetUnbindBusy: { current: true } },
  ]) {
    const guarded = harness(overrides);
    await callback("handleDatasetUnbind", guarded.context)();
    assert.equal(guarded.calls.length, 0);
  }
});

test("exact DELETE proxy preserves request and encodes the target only", async () => {
  let forwarded: { req: unknown; options: { path: string; allow: string[] } } | undefined;
  const module = { exports: {} as { default?: (req: unknown, res: unknown) => Promise<void> } };
  vm.runInNewContext(
    ts.transpileModule(
      readFileSync(
        new URL("../pages/api/v1/apps/[id]/datasets/[datasetId].ts", import.meta.url),
        "utf8"
      ),
      { compilerOptions: { module: ts.ModuleKind.CommonJS } }
    ).outputText,
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
    query: { id: "60", datasetId: "kb/中文 ?" },
    method: "DELETE",
    headers: { "x-workspace-tenant-id": "8" },
  };
  assert.ok(module.exports.default);
  await module.exports.default(req, {});
  assert.ok(forwarded);
  assert.equal(forwarded.req, req);
  assert.equal(forwarded.options.path, "/api/v1/apps/60/datasets/kb%2F%E4%B8%AD%E6%96%87%20%3F");
  assert.deepEqual(Array.from(forwarded.options.allow), ["DELETE"]);
});

test("Custom and Chat share the reachable unbind dialog, and row action stays outside its link", () => {
  let sharedReturn = "";
  let rowActions = 0;
  function visit(node: ts.Node) {
    if (
      ts.isReturnStatement(node) &&
      node.expression?.getText(source).includes("<CustomViewRenderer")
    )
      sharedReturn = node.expression.getText(source);
    if (
      ts.isJsxElement(node) &&
      node.openingElement.tagName.getText(source) === "Button" &&
      node.openingElement.getText(source).includes('aria-label={t("unbindKnowledge")}')
    ) {
      rowActions++;
      assert.match(node.openingElement.getText(source), /shrink-0/);
      let parent = node.parent;
      while (parent && !ts.isReturnStatement(parent)) {
        if (ts.isJsxElement(parent))
          assert.notEqual(parent.openingElement.tagName.getText(source), "Link");
        parent = parent.parent;
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
  assert.equal(rowActions, 1);
  assert.match(
    sharedReturn,
    /appInfo.app_type === "Custom" && \(canEditThisApp \|\| !!appInfo.dataset_bindings\?\.length\) && knowledgeBindingsCard/
  );
  assert.match(
    sharedReturn,
    /<AlertDialog open=\{datasetUnbindTarget !== null\} onOpenChange=\{handleDatasetUnbindOpenChange\}/
  );
});
