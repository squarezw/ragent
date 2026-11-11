import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import * as helpers from "../lib/skillAssets.ts";

interface ElementNode {
  type: unknown;
  props: Record<string, unknown>;
}
function mount(config: unknown, environments: unknown[] = [environment], error = false) {
  const values: unknown[] = [];
  const dependencies: unknown[][] = [];
  let cursor = 0;
  let effectCursor = 0;
  let effects: (() => void)[] = [];
  const payloads: unknown[] = [];
  const jsx = (type: unknown, props: Record<string, unknown>) => ({ type, props });
  const react = {
    useState: (initial: unknown) => {
      const index = cursor++;
      if (!(index in values)) values[index] = initial;
      return [
        values[index],
        (value: unknown) => {
          values[index] = value;
        },
      ];
    },
    useMemo: (factory: () => unknown) => factory(),
    useEffect: (effect: () => void, deps: unknown[]) => {
      const index = effectCursor++;
      if (!dependencies[index] || deps.some((value, i) => value !== dependencies[index][i])) {
        effects.push(effect);
        dependencies[index] = deps;
      }
    },
  };
  const module = { exports: {} as { default: (props: Record<string, unknown>) => ElementNode } };
  vm.runInNewContext(
    ts.transpileModule(
      readFileSync(
        new URL("../app/skills/components/SkillExecConfigForm.tsx", import.meta.url),
        "utf8"
      ),
      {
        compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
      }
    ).outputText,
    {
      module,
      exports: module.exports,
      require: (name: string) => {
        if (name === "react") return react;
        if (name === "react/jsx-runtime") return { jsx, jsxs: jsx };
        if (name === "next-intl") return { useTranslations: () => (key: string) => key };
        if (name === "@/lib/skillAssets") return helpers;
        return new Proxy({}, { get: (_target, property) => String(property) });
      },
    }
  );
  let tree: ElementNode;
  const render = (): ElementNode => {
    cursor = 0;
    effectCursor = 0;
    effects = [];
    tree = module.exports.default({
      config,
      images: [],
      imagesUnavailable: true,
      saving: false,
      remoteEnvironments: environments,
      remoteEnvironmentsLoading: false,
      remoteEnvironmentsError: error,
      onSave: (payload: unknown) => payloads.push(payload),
    });
    if (effects.length) {
      for (const effect of effects) effect();
      return render();
    }
    return tree;
  };
  render();
  function nodes(node: unknown): ElementNode[] {
    if (Array.isArray(node)) return node.flatMap((entry) => nodes(entry));
    if (!node || typeof node !== "object" || !("props" in node)) return [];
    const element = node as ElementNode;
    return [element, ...nodes(element.props.children)];
  }
  const get = (predicate: (node: ElementNode) => boolean) => {
    const found = nodes(tree).find(predicate);
    assert.ok(found);
    return found;
  };
  const change = (id: string, value: string) => {
    (get((node) => node.props.id === id).props.onChange as (event: unknown) => void)({
      target: { value },
    });
    render();
  };
  const mode = (value: string) => {
    (
      get((node) => node.type === "input" && node.props.value === value).props
        .onChange as () => void
    )();
    render();
  };
  return { render, get, change, mode, payloads };
}
const environment = {
  id: "browser-v1",
  name: "Browser",
  revision: "v1",
  enabled: true,
  max_timeout_sec: 300,
  description: "Browser ready",
  network_description: "Internet enabled",
};
const local = {
  image: "local:latest",
  timeout_sec: 120,
  writable_subdirs: [".state"],
  needs_network: true,
  warm_pool: true,
  artifact_exclude: ["*.tmp"],
};

test("actual form keeps local and remote drafts separate and sends only selected branch", () => {
  const form = mount({ ...local, writable_subdirs: [] });
  form.change("exec-timeout", "240");
  form.mode("remote");
  assert.equal(form.get((node) => node.props.id === "exec-remote-exclude").props.value, "*.tmp");
  (
    form.get((node) => node.type === "Select" && typeof node.props.onValueChange === "function")
      .props.onValueChange as (value: string) => void
  )("browser-v1");
  form.render();
  form.change("exec-remote-timeout", "180");
  form.mode("local");
  assert.equal(form.get((node) => node.props.id === "exec-timeout").props.value, "240");
  form.mode("remote");
  assert.equal(form.get((node) => node.props.id === "exec-remote-timeout").props.value, "180");
  const button = form.get((node) => node.type === "Button");
  assert.equal(button.props.disabled, false);
  (button.props.onClick as () => void)();
  assert.deepEqual(JSON.parse(JSON.stringify(form.payloads)), [
    {
      backend: "remote",
      remote_environment_id: "browser-v1",
      timeout_sec: 180,
      artifact_exclude: ["*.tmp"],
    },
  ]);
});

test("actual form requires acknowledgement before removing local persistent settings", () => {
  const form = mount(local);
  form.mode("remote");
  (form.get((node) => node.type === "Select").props.onValueChange as (value: string) => void)(
    "browser-v1"
  );
  form.render();
  assert.equal(form.get((node) => node.type === "Button").props.disabled, true);
  (
    form.get((node) => node.type === "input" && node.props.type === "checkbox").props.onChange as (
      event: unknown
    ) => void
  )({ target: { checked: true } });
  form.render();
  assert.equal(form.get((node) => node.type === "Button").props.disabled, false);
  form.mode("local");
  assert.equal(form.get((node) => node.props.id === "exec-writable-subdirs").props.value, ".state");
});

test("actual form blocks missing, disabled, failed candidates and unsupported timeout", () => {
  for (const options of [[], [{ ...environment, enabled: false }]]) {
    const form = mount(
      {
        ...local,
        backend: "remote",
        image: null,
        remote_environment_id: "browser-v1",
        writable_subdirs: [],
      },
      options
    );
    assert.equal(form.get((node) => node.type === "Button").props.disabled, true);
  }
  const form = mount({
    ...local,
    backend: "remote",
    image: null,
    remote_environment_id: "browser-v1",
    writable_subdirs: [],
  });
  form.change("exec-remote-timeout", "301");
  assert.equal(form.get((node) => node.type === "Button").props.disabled, true);
  const failed = mount(
    {
      ...local,
      backend: "remote",
      image: null,
      remote_environment_id: "browser-v1",
      writable_subdirs: [],
    },
    [environment],
    true
  );
  assert.equal(failed.get((node) => node.type === "Button").props.disabled, true);
});
