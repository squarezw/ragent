import test from "node:test";
import assert from "node:assert/strict";
import ts from "typescript";
import vm from "node:vm";
import { readFileSync } from "node:fs";
import { canReplacePackage } from "../lib/skillPackageReplacement.ts";
function harness() {
  const state: any[] = [],
    effects: any[] = [],
    calls: any[] = [];
  let cursor = 0,
    dirty = false,
    fail = false,
    actor = 7,
    workspace = 1;
  const preview: any = {
    skill_id: 9,
    package_sha256: "hash",
    expected_version: "v",
    validation_token: "signed",
    expires_at: new Date(Date.now() + 60000).toISOString(),
    can_apply: true,
    warnings: [{ code: "NAME_MISMATCH", message: "slug unchanged", confirmation_required: true }],
    files: [{ path: "scripts/new.py", kind: "script", size: 1, sha256: "h", change: "added" }],
    removed_paths: ["scripts/old.py"],
    counts: { added: 1, modified: 0, unchanged: 0, removed: 1, total_files: 1, total_bytes: 1 },
    preserved_fields: ["name", "exec"],
    published_unchanged: true,
  };
  const jsx = (type: any, props: any, key: any) => ({ type, props, key });
  const module = { exports: {} as any };
  const source = readFileSync(
    new URL("../app/skills/components/SkillPackageReplacement.tsx", import.meta.url),
    "utf8"
  ).replace("function ReplacementDialog(", "export function ReplacementDialog(");
  const request = {
    post: async (path: string, body: any) => {
      calls.push({ path, body });
      if (fail && !path.endsWith("validate")) throw Error("network");
      return {
        data: path.endsWith("validate")
          ? preview
          : { skill: { id: 9 }, replacement: { published_unchanged: true } },
      };
    },
  };
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
      document: { querySelector: () => (dirty ? {} : null) },
      window: { location: { reload: () => calls.push({ reload: true }) } },
      FormData: class {
        fields = new Map();
        append(key: any, value: any) {
          this.fields.set(key, value);
        }
      },
      require: (name: string) => {
        if (name === "react/jsx-runtime") return { jsx, jsxs: jsx, Fragment: "fragment" };
        if (name === "react")
          return {
            useState: (initial: any) => {
              const index = cursor++;
              if (!(index in state))
                state[index] = typeof initial === "function" ? initial() : initial;
              return [
                state[index],
                (v: any) => (state[index] = typeof v === "function" ? v(state[index]) : v),
              ];
            },
            useRef: (value: any) => {
              const index = cursor++;
              return state[index] ?? (state[index] = { current: value });
            },
            useEffect: (fn: any) => {
              const index = cursor++;
              if (!(index in state)) {
                state[index] = true;
                effects.push(fn());
              }
            },
          };
        if (name === "next-intl") return { useTranslations: () => (key: string) => key };
        if (name === "swr")
          return { useSWRConfig: () => ({ mutate: async () => calls.push({ invalidate: true }) }) };
        if (name.includes("useCurrentUser"))
          return { useCurrentUser: () => ({ user: { id: actor }, loading: false }) };
        if (name.includes("WorkspaceProvider"))
          return {
            useWorkspace: () => ({ ready: true, enabled: true, tenant: { id: workspace } }),
          };
        if (name === "axios") return { isAxiosError: () => false };
        if (name === "@/lib/axios") return { default: request };
        if (name.includes("skillPackageReplacement")) return { canReplacePackage };
        return new Proxy({}, { get: (_, key) => String(key) });
      },
    }
  );
  return {
    calls,
    preview,
    dirty: (value: boolean) => (dirty = value),
    fail: () => (fail = true),
    unmount: () => effects.forEach((fn) => fn?.()),
    scope: (a: number, w: number) => {
      actor = a;
      workspace = w;
    },
    outer: (enabled = true) => module.exports.default({ skillId: 9, enabled, onRefresh: () => {} }),
    render: () => {
      cursor = 0;
      return module.exports.ReplacementDialog({
        skillId: 9,
        onRefresh: () => calls.push({ refresh: true }),
      });
    },
  };
}
function nodes(tree: any): any[] {
  if (!tree) return [];
  if (Array.isArray(tree)) return tree.flatMap(nodes);
  if (typeof tree !== "object") return [];
  return [tree, ...nodes(tree.props?.children)];
}
const button = (tree: any, key: string) =>
  nodes(tree).find((node) => node.type === "Button" && node.props.children === key);
async function ready(h: ReturnType<typeof harness>) {
  let tree = h.render();
  button(tree, "replacePackageTitle").props.onClick();
  tree = h.render();
  nodes(tree)
    .find((node) => node.type === "input")
    .props.onChange({ target: { files: [{ name: "test.zip", size: 10 }] } });
  tree = h.render();
  await button(tree, "replacePackagePreview").props.onClick();
  return h.render();
}
function acknowledge(h: ReturnType<typeof harness>, tree: any) {
  for (const node of nodes(tree).filter((node) => node.type === "Checkbox"))
    node.props.onCheckedChange(true);
  return h.render();
}
test("replacement entry denies missing permission and scopes actor/workspace/skill", () => {
  const h = harness();
  assert.equal(h.outer(false), null);
  const first = h.outer();
  h.scope(8, 2);
  assert.notEqual(h.outer().key, first.key);
});
test("actual preview and full replacement use one CAS multipart apply, no per-file delete/save/publish", async () => {
  const h = harness();
  let tree = await ready(h);
  assert.equal(button(tree, "replacePackageApply").props.disabled, true);
  tree = acknowledge(h, tree);
  assert.equal(button(tree, "replacePackageApply").props.disabled, false);
  await button(tree, "replacePackageApply").props.onClick();
  assert.equal(h.calls[0].path, "/api/v1/skills/9/package-replacement/validate");
  assert.equal(h.calls[1].path, "/api/v1/skills/9/package-replacement");
  assert.equal(h.calls[1].body.fields.get("validation_token"), "signed");
  assert.equal(h.calls[1].body.fields.get("expected_version"), "v");
  assert.equal(h.calls[1].body.fields.get("confirmed_warning_codes"), '["NAME_MISMATCH"]');
  assert.deepEqual(
    [...h.calls[1].body.fields.keys()],
    ["file", "expected_version", "validation_token", "confirmed_warning_codes"]
  );
  assert.equal(h.calls.filter((call) => call.path).length, 2);
  assert.equal(
    h.calls.some((call) => call.refresh),
    true
  );
});
test("unsaved body/config blocks opening and committing", async () => {
  const h = harness();
  h.dirty(true);
  let tree = h.render();
  button(tree, "replacePackageTitle").props.onClick();
  assert.equal(nodes(h.render()).find((node) => node.type === "Dialog").props.open, false);
  h.dirty(false);
  tree = acknowledge(h, await ready(h));
  h.dirty(true);
  await button(tree, "replacePackageApply").props.onClick();
  assert.equal(h.calls.filter((call) => call.path).length, 1);
});
test("unacknowledged slug warning or deletion prevents actual handler write", async () => {
  const h = harness();
  const tree = await ready(h);
  await button(tree, "replacePackageApply").props.onClick();
  assert.equal(h.calls.length, 1);
});
test("changing selected ZIP invalidates preview and acknowledgements", async () => {
  const h = harness();
  let tree = acknowledge(h, await ready(h));
  nodes(tree)
    .find((node) => node.type === "input")
    .props.onChange({ target: { files: [{ name: "other.zip", size: 1 }] } });
  tree = h.render();
  assert.equal(button(tree, "replacePackageApply"), undefined);
});
test("foreign skill preview cannot expose manifest or produce apply", async () => {
  const h = harness();
  h.preview.skill_id = 10;
  const tree = await ready(h);
  assert.equal(button(tree, "replacePackageApply"), undefined);
});
test("unknown failure keeps draft view unchanged and disables retries until explicit read", async () => {
  const h = harness();
  h.fail();
  let tree = acknowledge(h, await ready(h));
  await button(tree, "replacePackageApply").props.onClick();
  tree = h.render();
  assert.equal(button(tree, "replacePackageApply").props.disabled, true);
  await button(tree, "replacePackageApply").props.onClick();
  assert.equal(h.calls.filter((call) => call.path).length, 2);
  assert.equal(
    h.calls.some((call) => call.refresh),
    false
  );
  button(tree, "replacePackageReadDraft").props.onClick();
  assert.equal(
    h.calls.some((call) => call.reload),
    true
  );
});
test("old identity completion cannot invalidate or refresh new identity", async () => {
  const h = harness();
  const tree = acknowledge(h, await ready(h));
  const pending = button(tree, "replacePackageApply").props.onClick();
  h.unmount();
  await pending;
  assert.equal(
    h.calls.some((call) => call.refresh || call.invalidate),
    false
  );
});
