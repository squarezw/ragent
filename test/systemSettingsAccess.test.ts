import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

function settingsLoad(userLoading: boolean, isSuperAdmin: boolean) {
  const source = ts.createSourceFile(
    "page.tsx",
    readFileSync(new URL("../app/system-settings/page.tsx", import.meta.url), "utf8"),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX
  );
  let callback = "";
  function visit(node: ts.Node) {
    if (ts.isCallExpression(node) && node.expression.getText(source) === "useEffect")
      callback = node.arguments[0].getText(source);
    ts.forEachChild(node, visit);
  }
  visit(source);
  assert.ok(callback);
  let requests = 0,
    updates = 0;
  let resolve: (value: unknown) => void = () => {};
  const response = new Promise((done) => {
    resolve = done;
  });
  const module = { exports: null as unknown };
  vm.runInNewContext(
    ts.transpileModule(`module.exports = ${callback};`, {
      compilerOptions: { target: ts.ScriptTarget.ES2020 },
    }).outputText,
    {
      module,
      userLoading,
      workspace: { enabled: false },
      platformPage: false,
      setSavedSystemSettings() {},
      setSavedSmtpSettings() {},
      isSuperAdmin,
      axios: {
        get: () => {
          requests++;
          return response;
        },
      },
      setSystemSettings: () => {
        updates++;
      },
      setSmtpSettings: () => {
        updates++;
      },
      setSystemError: () => {
        updates++;
      },
      console: { error() {} },
      t: (key: string) => key,
    }
  );
  const cleanup = (module.exports as () => (() => void) | undefined)();
  return {
    cleanup,
    resolve,
    get requests() {
      return requests;
    },
    get updates() {
      return updates;
    },
  };
}

test("actual privileged settings effect makes no full-data request for non-superadmin or pending user", () => {
  for (const [loading, superAdmin] of [
    [false, false],
    [true, false],
    [true, true],
  ]) {
    const h = settingsLoad(loading, superAdmin);
    assert.equal(h.requests, 0);
  }
});

test("actual administrator settings effect loads once but ignores response after access cleanup", async () => {
  const active = settingsLoad(false, true);
  assert.equal(active.requests, 1);
  active.resolve({ data: { platform_name: "Fixture" } });
  await new Promise((done) => setImmediate(done));
  assert.equal(active.updates, 1);
  const revoked = settingsLoad(false, true);
  revoked.cleanup?.();
  revoked.resolve({ data: { platform_name: "Fixture" } });
  await new Promise((done) => setImmediate(done));
  assert.equal(revoked.updates, 0);
});
