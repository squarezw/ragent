import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import test from "node:test";
import ts from "typescript";

function harness(initialScope: "workspace" | "platform" = "workspace") {
  const slots: any[] = [], effects: (() => void)[] = [], gets: any[] = [], posts: any[] = [];
  let cursor = 0, scope = initialScope, result: any;
  const changed = (a: any[], b?: any[]) => !b || a.some((v, i) => !Object.is(v, b[i]));
  const react: any = {
    useState(value: any) { const i = cursor++; if (!(i in slots)) slots[i] = value; return [slots[i], (next: any) => { slots[i] = next; }]; },
    useRef(value: any) { const i = cursor++; return slots[i] ??= { current: value }; },
    useCallback(fn: any, deps: any[]) { const i = cursor++; if (!slots[i] || changed(deps, slots[i].deps)) slots[i] = { fn, deps }; return slots[i].fn; },
    useEffect(fn: any, deps: any[]) { const i = cursor++; if (!slots[i] || changed(deps, slots[i].deps)) { const prior = slots[i]; slots[i] = { deps }; effects.push(() => { prior?.cleanup?.(); slots[i].cleanup = fn(); }); } },
  };
  const module = { exports: {} as any };
  vm.runInNewContext(ts.transpileModule(fs.readFileSync("hooks/useBilling.ts", "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, esModuleInterop: true },
  }).outputText, { module, exports: module.exports, URLSearchParams, require(name: string) {
    if (name === "react") return react;
    if (name === "@/lib/axios") return { __esModule: true, default: {
      get: (url: string) => new Promise((resolve, reject) => gets.push({ url, resolve, reject })),
      post: async (url: string, body: any) => { posts.push({ url, body }); return { data: { amount: 5, balance: 25, duplicate: false } }; },
    }};
    if (name === "swr") return { default: () => ({}) };
    if (name === "@/hooks/useCurrentUser") return { useCurrentUser: () => ({ user: null }) };
    throw Error(name);
  }});
  const render = () => { cursor = 0; result = module.exports.useCreditAccounts(undefined, scope); while (effects.length) effects.shift()!(); return result; };
  return { gets, posts, render, switch(next: typeof scope) { scope = next; return render(); } };
}
const flush = async () => { await Promise.resolve(); await Promise.resolve(); };

test("personal billing retains workspace scope by default", async () => {
  const h = harness(); h.render();
  assert.equal(h.gets[0].url, "/api/v1/billing/accounts");
  h.gets[0].resolve({ data: { items: [{ tenant_id: 1, balance: 0 }], total_balance: 0 } });
  await flush(); assert.equal(h.render().accounts[0].balance, 0);
});
test("platform organization accounts and recharge preserve target and idempotency", async () => {
  const h = harness("platform"); const api = h.render();
  assert.equal(h.gets[0].url, "/api/v1/billing/accounts?scope=platform");
  h.gets[0].resolve({ data: { items: [{ tenant_id: 1, balance: 10 }, { tenant_id: 2, balance: 20 }] } });
  await flush(); assert.equal(h.render().accounts.length, 2);
  const pending = api.recharge(2, 5, "note", "stable-idempotency");
  await flush();
  assert.equal(h.posts[0].url, "/api/v1/billing/recharge?scope=platform");
  assert.deepEqual(JSON.parse(JSON.stringify(h.posts[0].body)), { tenant_id: 2, amount: 5, note: "note", idempotency_key: "stable-idempotency" });
  h.gets[1].resolve({ data: { items: [{ tenant_id: 2, balance: 25 }] } });
  await pending; assert.equal(h.render().accounts[0].balance, 25);
});
test("scope changes discard stale account responses and failures stay unknown", async () => {
  const h = harness(); h.render(); h.switch("platform");
  h.gets[1].resolve({ data: { items: [{ tenant_id: 2, balance: 20 }] } }); await flush();
  h.gets[0].resolve({ data: { items: [{ tenant_id: 1, balance: 99 }] } }); await flush();
  assert.equal(h.render().accounts[0].tenant_id, 2);
  const pending = h.render().reload(); h.gets[2].reject(Error("denied")); await pending;
  assert.equal(h.render().accounts.length, 0);
});
test("billing proxies allow only the explicit platform query and keep backend authority", async () => {
  for (const [file, allow, passQuery] of [
    ["accounts", ["GET"], ["tenant_id", "scope"]],
    ["recharge", ["POST"], ["scope"]],
  ] as const) {
    let options: any;
    const module = { exports: {} as any };
    vm.runInNewContext(ts.transpileModule(fs.readFileSync(`pages/api/v1/billing/${file}.ts`, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText,
      { module, exports: module.exports, require: () => ({ proxySkillsApi: (_req: any, _res: any, value: any) => { options = value; } }) });
    await module.exports.default({}, {});
    assert.deepEqual(JSON.parse(JSON.stringify(options)), { path: `/api/v1/billing/${file}`, allow: [...allow], passQuery: [...passQuery] });
  }
});

test("completed recharge cannot reload a previous billing scope", async () => {
  const h = harness("platform"); const api = h.render();
  const pending = api.recharge(2, 5, "note", "stable-idempotency");
  h.switch("workspace");
  await pending;
  assert.equal(h.gets.length, 2);
  assert.equal(h.gets[1].url, "/api/v1/billing/accounts");
});
