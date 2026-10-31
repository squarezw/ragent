import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import vm from "node:vm";
import test from "node:test";
import { appSelectionKey, chooseTenantApp } from "../lib/tenantDefaultApp.ts";
const require = createRequire(import.meta.url);
const ts = require("typescript");
const app = (id: number, tenant: number, extra = {}) => ({
  id,
  owner_tenant_id: tenant,
  name: `app${id}`,
  dataset_ids: [],
  is_default: true,
  status: "published",
  visibility: "tenant",
  app_type: "Chat",
  platform: "Web",
  ...extra,
});
function harness(
  initialUser = { id: 1, tenant_id: 10 },
  saved: Record<string, string> = {},
  workspace = { enabled: false, tenant: null as { id: number } | null }
) {
  let user: typeof initialUser | null = initialUser;
  let cursor = 0,
    dirty = false,
    result: any;
  const slots: any[] = [],
    effects: (() => void)[] = [],
    requests: any[] = [];
  const storage = new Map(Object.entries(saved));
  const depsChanged = (a: any[], b: any[]) => !b || a.some((v, i) => !Object.is(v, b[i]));
  const hooks = {
    useState(initial: any) {
      const i = cursor++;
      if (!(i in slots)) slots[i] = typeof initial === "function" ? initial() : initial;
      return [
        slots[i],
        (value: any) => {
          const next = typeof value === "function" ? value(slots[i]) : value;
          if (!Object.is(next, slots[i])) {
            slots[i] = next;
            dirty = true;
          }
        },
      ];
    },
    useRef(initial: any) {
      const i = cursor++;
      if (!(i in slots)) slots[i] = { current: initial };
      return slots[i];
    },
    useMemo(fn: () => any, deps: any[]) {
      const i = cursor++;
      if (!slots[i] || depsChanged(deps, slots[i].deps)) slots[i] = { value: fn(), deps };
      return slots[i].value;
    },
    useCallback(fn: any, deps: any[]) {
      return hooks.useMemo(() => fn, deps);
    },
    useEffect(fn: () => any, deps: any[]) {
      const i = cursor++;
      const previous = slots[i];
      if (!previous || depsChanged(deps, previous.deps)) {
        slots[i] = { deps, cleanup: previous?.cleanup };
        effects.push(() => {
          slots[i].cleanup?.();
          slots[i].cleanup = fn();
        });
      }
    },
  };
  const module = { exports: {} as any };
  const mocks: Record<string, unknown> = {
    react: hooks,
    "@/app/components/WorkspaceProvider": { useWorkspace: () => workspace },
    "@/hooks/useCurrentUser": { useCurrentUser: () => ({ user }) },
    "@/lib/tenantDefaultApp": { appSelectionKey, chooseTenantApp },
    "@/lib/axios": {
      default: {
        get: (path: string) =>
          new Promise((resolve, reject) => requests.push({ path, resolve, reject })),
      },
    },
  };
  vm.runInNewContext(
    ts.transpileModule(
      readFileSync(new URL("../app/chat/hooks/useAppDatasets.ts", import.meta.url), "utf8"),
      { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }
    ).outputText,
    {
      module,
      exports: module.exports,
      require: (id: string) => {
        assert.ok(id in mocks);
        return mocks[id];
      },
      localStorage: {
        getItem: (key: string) => storage.get(key) || null,
        setItem: (key: string, value: string) => storage.set(key, value),
        removeItem: (key: string) => storage.delete(key),
      },
      console,
    }
  );
  function render() {
    let rounds = 0;
    do {
      dirty = false;
      cursor = 0;
      // biome-ignore lint/correctness/useHookAtTopLevel: deterministic hook runtime renders the actual hook in a controlled loop.
      result = module.exports.useAppDatasets();
      for (const effect of effects.splice(0)) effect();
      assert.ok(++rounds < 25, "hook render loop");
    } while (dirty);
  }
  render();
  return {
    get result() {
      return result;
    },
    requests,
    storage,
    user(next: typeof initialUser | null) {
      user = next;
      render();
    },
    select(id: string) {
      result.handleAppSelect(id);
      render();
    },
    async resolve(index: number, data: any) {
      const request = requests.splice(index, 1)[0];
      assert.ok(request);
      request.resolve({ data });
      await new Promise((r) => setImmediate(r));
      render();
    },
  };
}

test("invalid scoped selection falls back to own tenant and ignores old global hints", async () => {
  const key = appSelectionKey(1, 10);
  const h = harness(undefined, { [key]: "999", ragent_selected_app_id: "2" });
  await h.resolve(0, { items: [app(2, 20, { visibility: "public" }), app(1, 10)] });
  assert.equal(h.result.selectedAppId, "1");
  assert.equal(h.storage.get(key), "1");
  h.select("unauthorized");
  assert.equal(h.result.selectedAppId, "1");
  h.select("2");
  assert.equal(h.result.selectedAppId, "2", "explicit public selection is preserved");
});

test("late account A lists cannot replace account B choices or optional datasets", async () => {
  const h = harness();
  h.user({ id: 2, tenant_id: 20 });
  assert.equal(h.result.apps.length, 0);
  assert.equal(h.result.selectedAppId, "");
  await h.resolve(2, { items: [app(2, 20)] });
  assert.equal(h.result.selectedAppId, "2");
  await h.resolve(0, { items: [app(1, 10)] });
  assert.equal(h.result.selectedAppId, "2");
  await h.resolve(0, [{ id: "old", name: "old" }]);
  assert.equal(h.result.selectedDatasetIds.length, 0);
  h.user(null);
  assert.equal(h.result.apps.length, 0);
  assert.equal(h.result.selectedAppId, "");
});

test("saved selections restore only from current scope and optional datasets are permission filtered", async () => {
  const key = appSelectionKey(1, 10);
  const h = harness(undefined, {
    [key]: "2",
    [`${key}:optional_datasets`]: JSON.stringify(["allowed", "forbidden"]),
  });
  await h.resolve(0, { items: [app(1, 10), app(2, 20, { visibility: "public" })] });
  assert.equal(h.result.selectedAppId, "2");
  await h.resolve(0, [{ id: "allowed", name: "allowed" }]);
  assert.deepEqual(Array.from(h.result.optionalDatasetSelections), ["allowed"]);
  h.user({ id: 1, tenant_id: 20 });
  assert.equal(h.result.optionalDatasetSelections.size, 0);
  await h.resolve(0, { items: [app(3, 20)] });
  assert.equal(h.result.selectedAppId, "3");
});

test("workspace selection uses operation tenant without changing account identity", async () => {
  const key = appSelectionKey(1, 20);
  const h = harness({ id: 1, tenant_id: 10 }, {}, { enabled: true, tenant: { id: 20 } });
  await h.resolve(0, { items: [app(2, 20)] });
  assert.equal(h.result.selectedAppId, "2");
  assert.equal(h.storage.get(key), "2");
  assert.equal(h.storage.has(appSelectionKey(1, 10)), false);
});
