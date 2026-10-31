import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import test from "node:test";
import ts from "typescript";

test("actor switch clears old selector immediately and ignores delayed previous actor context", async () => {
  const browser = await import(new URL("../lib/workspaceBrowser.ts", import.meta.url).href);
  let user = { id: 1, tenant_id: 10, workspace_enabled: true };
  const state: any[] = [];
  const effects: any[] = [];
  const requests: any[] = [];
  let cursor = 0;
  let dirty = false;
  let tree: any;
  const imports: Record<string, any> = {
    react: {
      createContext: () => ({ Provider: "provider" }),
      useContext: () => null,
      useState(initial: any) {
        const index = cursor++;
        if (!(index in state)) state[index] = initial;
        return [
          state[index],
          (next: any) => {
            state[index] = typeof next === "function" ? next(state[index]) : next;
            dirty = true;
          },
        ];
      },
      useLayoutEffect(fn: any, deps: any[]) {
        const index = cursor++;
        const prior = state[index];
        if (!prior || deps.some((value, i) => value !== prior.deps[i])) {
          state[index] = { deps, cleanup: prior?.cleanup };
          effects.push(() => {
            prior?.cleanup?.();
            state[index].cleanup = fn();
          });
        }
      },
    },
    "react/jsx-runtime": {
      jsx: (type: any, props: any) => ({ type, props }),
      jsxs: (type: any, props: any) => ({ type, props }),
    },
    swr: { SWRConfig: "swr" },
    "@/lib/axios": { default: { get: () => new Promise((resolve) => requests.push(resolve)) } },
    "@/hooks/useCurrentUser": { useCurrentUser: () => ({ user, loading: false }) },
    "@/lib/clientPermissions": { checkSuperAdmin: () => false },
    "@/lib/workspaceBrowser": browser,
  };
  const exports: any = {};
  runInNewContext(
    ts.transpileModule(
      readFileSync(new URL("../app/components/WorkspaceProvider.tsx", import.meta.url), "utf8"),
      {
        compilerOptions: {
          module: ts.ModuleKind.CommonJS,
          target: ts.ScriptTarget.ES2020,
          jsx: ts.JsxEmit.ReactJSX,
        },
      }
    ).outputText,
    {
      exports,
      require: (name: string) => {
        assert.ok(name in imports, name);
        return imports[name];
      },
      sessionStorage: { getItem: () => null, setItem() {} },
    }
  );
  const render = () => {
    for (let rounds = 0; rounds < 10; rounds++) {
      dirty = false;
      cursor = 0;
      tree = exports.WorkspaceProvider({ children: "view" });
      effects.splice(0).forEach((fn) => fn());
      if (!dirty) return;
    }
    throw new Error("render loop");
  };
  render();
  const previousRequest = browser.beginWorkspaceRequest();
  user = { id: 2, tenant_id: 20, workspace_enabled: true };
  render();
  assert.equal(previousRequest.signal.aborted, true);
  assert.equal(browser.getWorkspaceSnapshot().actorId, 2);
  assert.equal(browser.getWorkspaceSnapshot().tenantId, null);
  assert.equal(tree.props.value.ready, false);
  requests[1]({ data: { tenants: [{ id: 20, name: "B" }] } });
  await new Promise((done) => setImmediate(done));
  render();
  assert.equal(tree.props.value.tenant.id, 20);
  requests[0]({ data: { tenants: [{ id: 10, name: "A" }] } });
  await new Promise((done) => setImmediate(done));
  render();
  assert.equal(tree.props.value.tenant.id, 20);
  assert.equal(browser.getWorkspaceSnapshot().tenantId, 20);
  previousRequest.finish();
});
