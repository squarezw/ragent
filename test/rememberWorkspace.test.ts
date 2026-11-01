import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import test from "node:test";
import ts from "typescript";

function harness(
  options: { user?: any; origin?: string; storage?: Map<string, string>; denied?: boolean } = {}
) {
  let user = options.user || { id: 1, tenant_id: 10, workspace_enabled: true, super: true };
  const origin = options.origin || "https://app.example";
  const storage = options.storage || new Map<string, string>();
  const state: any[] = [];
  const effects: any[] = [];
  const requests: any[] = [];
  let cursor = 0,
    dirty = false,
    tree: any;
  let snapshot: any = {};
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
        const index = cursor++,
          prior = state[index];
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
    "@/lib/axios": {
      default: { get: () => new Promise((resolve, reject) => requests.push({ resolve, reject })) },
    },
    "@/hooks/useCurrentUser": { useCurrentUser: () => ({ user, loading: false }) },
    "@/lib/clientPermissions": { checkSuperAdmin: () => user.super === true },
    "@/lib/workspaceBrowser": {
      installWorkspaceFetch() {},
      workspaceBusy: () => false,
      setWorkspaceOperation: (enabled: boolean, actorId: number, tenantId: number | null) =>
        (snapshot = { enabled, actorId, tenantId }),
    },
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
      window: { location: { origin } },
      localStorage: {
        getItem: (key: string) => {
          if (options.denied) throw Error("SecurityError");
          return storage.get(key) || null;
        },
        setItem: (key: string, value: string) => {
          if (options.denied) throw Error("SecurityError");
          storage.set(key, value);
        },
      },
    }
  );
  function render() {
    for (let round = 0; round < 10; round++) {
      dirty = false;
      cursor = 0;
      tree = exports.WorkspaceProvider({ children: "view" });
      effects.splice(0).forEach((fn) => fn());
      if (!dirty) return tree.props.value;
    }
    throw Error("render loop");
  }
  return {
    storage,
    requests,
    render,
    snapshot: () => snapshot,
    switchUser: (next: any) => (user = next),
    async resolve(tenants: any[], request = requests.length - 1) {
      requests[request].resolve({ data: { tenants } });
      await new Promise((done) => setImmediate(done));
      return render();
    },
    async reject() {
      requests.at(-1).reject(Error("Forbidden"));
      await new Promise((done) => setImmediate(done));
      return render();
    },
  };
}
const catalog = [
  { id: 10, name: "Own" },
  { id: 20, name: "Other" },
];
const key = "ragent:workspace:https://app.example:1";
test("super restores persistent preference only after current server validation", async () => {
  const h = harness({ storage: new Map([[key, "20"]]) });
  assert.equal(h.render().ready, false);
  assert.equal(h.snapshot().tenantId, null);
  const value = await h.resolve(catalog);
  assert.equal(value.ready, true);
  assert.equal(value.tenant.id, 20);
});
test("first login and invalid/inactive hint default to accessible own tenant", async () => {
  for (const stored of [undefined, "999", "malformed"]) {
    const h = harness({ storage: new Map(stored ? [[key, stored]] : []) });
    h.render();
    assert.equal((await h.resolve(catalog)).tenant.id, 10);
  }
});
test("no accessible own tenant and no valid hint retains picker, never first tenant", async () => {
  const h = harness();
  h.render();
  const value = await h.resolve([catalog[1]]);
  assert.equal(value.ready, true);
  assert.equal(value.tenant, null);
});
test("ordinary user ignores saved cross-tenant preference", async () => {
  const h = harness({
    user: { id: 1, tenant_id: 10, workspace_enabled: true, super: false },
    storage: new Map([[key, "20"]]),
  });
  h.render();
  const value = await h.resolve(catalog);
  assert.equal(value.tenant.id, 10);
  assert.equal(value.selectTenant(catalog[1]), false);
});
test("storage denial cannot prevent readiness, fallback or explicit selection", async () => {
  const h = harness({ denied: true });
  h.render();
  const value = await h.resolve(catalog);
  assert.equal(value.tenant.id, 10);
  assert.equal(value.selectTenant(catalog[1]), true);
  assert.equal(h.render().tenant.id, 20);
});
test("explicit selection persists across provider/login/SSO initialization without changing account tenant", async () => {
  const storage = new Map();
  const h = harness({ storage });
  h.render();
  const value = await h.resolve(catalog);
  assert.equal(value.selectTenant(catalog[1]), true);
  assert.equal(storage.get(key), "20");
  const nextLogin = harness({ storage });
  nextLogin.render();
  assert.equal((await nextLogin.resolve(catalog)).tenant.id, 20);
});
test("different account and host/authority cannot reuse another preference", async () => {
  const storage = new Map([[key, "20"]]);
  for (const options of [
    { user: { id: 2, tenant_id: 10, workspace_enabled: true, super: true } },
    { origin: "https://another.example" },
  ]) {
    const h = harness({ storage, ...options });
    h.render();
    assert.equal((await h.resolve(catalog)).tenant.id, 10);
  }
});
test("disabled workspace performs no context request or restoration", () => {
  const h = harness({
    user: { id: 1, tenant_id: 10, workspace_enabled: false, super: true },
    storage: new Map([[key, "20"]]),
  });
  const value = h.render();
  assert.equal(value.ready, true);
  assert.equal(value.tenant, null);
  assert.equal(h.requests.length, 0);
});
test("server rejection (inactive/no access) does not restore saved preference", async () => {
  const h = harness({ storage: new Map([[key, "20"]]) });
  h.render();
  const value = await h.reject();
  assert.equal(value.ready, true);
  assert.equal(value.tenant, null);
  assert.equal(value.tenants.length, 0);
});
test("identity race ignores old context response and its remembered selection", async () => {
  const h = harness({ storage: new Map([[key, "20"]]) });
  h.render();
  h.switchUser({ id: 2, tenant_id: 30, workspace_enabled: true, super: true });
  assert.equal(h.render().ready, false);
  assert.equal((await h.resolve([{ id: 30, name: "New" }], 1)).tenant.id, 30);
  assert.equal((await h.resolve(catalog, 0)).tenant.id, 30);
  assert.equal(h.snapshot().actorId, 2);
});

test("another tab updating preference does not switch an already active workspace", async () => {
  const storage = new Map<string, string>();
  const h = harness({ storage });
  h.render();
  assert.equal((await h.resolve(catalog)).tenant.id, 10);
  storage.set(key, "20");
  assert.equal(h.render().tenant.id, 10);
});

test("role downgrade ignores remembered admin workspace and waits for new server catalog", async () => {
  const h = harness({ storage: new Map([[key, "20"]]) });
  h.render();
  assert.equal((await h.resolve(catalog)).tenant.id, 20);
  h.switchUser({ id: 1, tenant_id: 10, workspace_enabled: true, super: false });
  assert.equal(h.render().ready, false);
  assert.equal((await h.resolve([catalog[0]])).tenant.id, 10);
});
