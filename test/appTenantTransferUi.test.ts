import test from "node:test";
import assert from "node:assert/strict";
import ts from "typescript";
import vm from "node:vm";
import { readFileSync } from "node:fs";
import { canConfirmTransfer, transferPayload } from "../lib/appTenantTransfer.ts";
function harness(cap: unknown = true) {
  const states: any[] = [];
  let index = 0;
  const effects: (() => void)[] = [];
  const calls: any[] = [];
  const storage = new Map();
  let owner = 1;
  let failCommit = false;
  let transfer: any = null;
  const preview = {
    app_id: 9,
    source: { tenant_id: 1, tenant_name: "A" },
    target: { tenant_id: 2, tenant_name: "B" },
    expected_version: "v",
    preflight_token: "signed",
    expires_at: new Date(Date.now() + 60000).toISOString(),
    can_apply: true,
    warnings: [],
    blockers: [],
    checks: [{ code: "fence", status: "passed" }],
    bindings: [],
  };
  const workspace = {
    ready: true,
    enabled: true,
    tenant: { id: 1 },
    tenants: [
      { id: 1, name: "A" },
      { id: 2, name: "B" },
    ],
  };
  const post = async (path: string, body: any) => {
    calls.push({ path, body });
    if (failCommit && !path.endsWith("preflight")) throw Error("network");
    return {
      data: path.endsWith("preflight")
        ? preview
        : { app_id: 9, from_tenant_id: 1, to_tenant_id: 2 },
    };
  };
  const jsx = (type: any, props: any, key: any) => ({ type, props, key });
  const module = { exports: {} as any };
  const source = readFileSync(
    new URL("../app/apps/components/AppTenantTransfer.tsx", import.meta.url),
    "utf8"
  ).replace("function ScopedTransfer(", "export function ScopedTransfer(");
  vm.runInNewContext(
    ts.transpileModule(source, {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        jsx: ts.JsxEmit.ReactJSX,
        target: ts.ScriptTarget.ES2022,
      },
    }).outputText,
    {
      module,
      exports: module.exports,
      Date,
      crypto: { randomUUID: () => "request-id" },
      sessionStorage: {
        getItem: (key: string) => storage.get(key) || null,
        setItem: (key: string, value: string) => storage.set(key, value),
        removeItem: (key: string) => storage.delete(key),
      },
      require: (name: string) => {
        if (name === "react/jsx-runtime") return { jsx, jsxs: jsx, Fragment: "fragment" };
        if (name === "react")
          return {
            useState: (initial: any) => {
              const i = index++;
              if (!(i in states)) states[i] = typeof initial === "function" ? initial() : initial;
              return [
                states[i],
                (v: any) => (states[i] = typeof v === "function" ? v(states[i]) : v),
              ];
            },
            useRef: (v: any) => {
              const i = index++;
              return states[i] ?? (states[i] = { current: v });
            },
            useEffect: (effect: () => () => void) => {
              const i = index++;
              if (!(i in states)) {
                states[i] = true;
                effects.push(effect());
              }
            },
          };
        if (name === "next-intl") return { useTranslations: () => (key: string) => key };
        if (name === "next/navigation") return { useRouter: () => ({ push: () => {} }) };
        if (name === "swr")
          return { useSWRConfig: () => ({ mutate: async () => calls.push({ invalidate: true }) }) };
        if (name.includes("useCurrentUser"))
          return { useCurrentUser: () => ({ user: { id: 7 }, loading: false }) };
        if (name.includes("WorkspaceProvider")) return { useWorkspace: () => workspace };
        if (name === "@/lib/axios")
          return {
            default: {
              post,
              get: async (path: string) => {
                calls.push({ path });
                return { data: { app_id: 9, to_tenant_id: 2 } };
              },
            },
          };
        if (name === "axios") return { isAxiosError: () => false };
        if (name.includes("appTenantTransfer")) return { canConfirmTransfer, transferPayload };
        return new Proxy({}, { get: (_target, key) => String(key) });
      },
    }
  );
  const app = () => ({
    id: 9,
    owner_tenant_id: owner,
    can_transfer_tenant: cap === "missing" ? undefined : cap,
    tenant_transfer: transfer,
  });
  return {
    calls,
    preview,
    workspace,
    storage,
    setFailure: () => (failCommit = true),
    setTransfer: () => (transfer = { transfer_id: "event-id", rollback_eligible: true }),
    unmount: () => effects.forEach((fn) => fn?.()),
    outer: () => module.exports.default({ app: app() }),
    render: () => {
      index = 0;
      return module.exports.ScopedTransfer({ app: app(), actorId: 7 });
    },
    setOwner: (value: number) => (owner = value),
  };
}
function nodes(tree: any): any[] {
  if (!tree) return [];
  if (Array.isArray(tree)) return tree.flatMap(nodes);
  if (typeof tree !== "object") return [];
  return [tree, ...nodes(tree.props?.children)];
}
function button(tree: any, key: string) {
  return nodes(tree).find((node) => node.type === "Button" && node.props.children === key);
}
async function ready(h: ReturnType<typeof harness>) {
  let tree = h.render();
  nodes(tree)
    .find((node) => node.type === "Select")
    .props.onValueChange("2");
  tree = h.render();
  await button(tree, "transferPreview").props.onClick();
  tree = h.render();
  nodes(tree)
    .find((node) => node.type === "Textarea")
    .props.onChange({ target: { value: "audited reason" } });
  return h.render();
}
test("transfer entry requires explicit capability, ready source workspace and loaded actor", () => {
  for (const cap of [false, "missing", null]) assert.equal(harness(cap).outer(), null);
  const h = harness();
  assert.ok(h.outer());
  h.workspace.tenant.id = 2;
  assert.equal(h.outer(), null);
});
test("actual UI preflight then safe CAS commit invalidates caches; no workspace switch", async () => {
  const h = harness();
  const tree = await ready(h);
  assert.equal(button(tree, "transferConfirm").props.disabled, false);
  await button(tree, "transferConfirm").props.onClick();
  assert.equal(h.calls.length, 3);
  assert.equal(h.calls[1].path, "/api/v1/apps/9/tenant-transfer");
  assert.equal(h.calls[1].body.expected_version, "v");
  assert.equal(h.calls[1].body.target_tenant_id, 2);
  assert.equal(h.calls[2].invalidate, true);
  assert.equal(h.workspace.tenant.id, 1);
});
test("hard blocked actual UI cannot issue mutation even via callback", async () => {
  const h = harness();
  h.preview.blockers = [{ code: "active", message: "task" }] as any;
  const tree = await ready(h);
  assert.equal(button(tree, "transferConfirm").props.disabled, true);
  await button(tree, "transferConfirm").props.onClick();
  assert.equal(h.calls.length, 1);
});
test("scope key changes with workspace and no stale source entry remains", () => {
  const h = harness();
  const before = h.outer();
  h.workspace.tenant.id = 2;
  h.setOwner(2);
  const after = h.outer();
  assert.notEqual(before.key, after.key);
  h.unmount();
});

test("unknown network outcome retains scope-bound request ID and cannot repeat POST", async () => {
  const h = harness();
  h.setFailure();
  let tree = await ready(h);
  await button(tree, "transferConfirm").props.onClick();
  tree = h.render();
  assert.equal(button(tree, "transferConfirm").props.disabled, true);
  assert.equal(h.storage.get("app-transfer:7:1:9"), "request-id");
  await button(tree, "transferConfirm").props.onClick();
  assert.equal(h.calls.filter((call) => call.path.endsWith("/tenant-transfer")).length, 1);
  await button(tree, "transferRecover").props.onClick();
  assert.ok(
    h.calls.some((call) => call.path === "/api/v1/app-tenant-transfer-requests/request-id")
  );
  assert.equal(h.storage.has("app-transfer:7:1:9"), false);
});
test("foreign source metadata is not displayed or submitted", async () => {
  const h = harness();
  h.preview.source.tenant_id = 3;
  const tree = await ready(h).catch(() => h.render());
  assert.equal(button(tree, "transferConfirm"), undefined);
  assert.equal(h.calls.length, 1);
});
test("rollback uses dedicated preflight and mutation with CAS and no target override", async () => {
  const h = harness();
  h.setTransfer();
  let tree = h.render();
  button(tree, "transferRollback").props.onClick();
  tree = h.render();
  await button(tree, "transferPreview").props.onClick();
  tree = h.render();
  nodes(tree)
    .find((node) => node.type === "Textarea")
    .props.onChange({ target: { value: "rollback reason" } });
  tree = h.render();
  await button(tree, "transferRollbackConfirm").props.onClick();
  assert.equal(h.calls[0].path, "/api/v1/apps/9/tenant-transfer/event-id/rollback-preflight");
  assert.equal(h.calls[1].path, "/api/v1/apps/9/tenant-transfer/event-id/rollback");
  assert.equal("target_tenant_id" in h.calls[1].body, false);
  assert.equal(h.calls[1].body.expected_version, "v");
});

test("old scope response cannot invalidate new identity caches or clear recovery key", async () => {
  const h = harness();
  const tree = await ready(h);
  const pending = button(tree, "transferConfirm").props.onClick();
  h.unmount();
  await pending;
  assert.equal(
    h.calls.some((call) => call.invalidate),
    false
  );
  assert.equal(h.storage.get("app-transfer:7:1:9"), "request-id");
});
