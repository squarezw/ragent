import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { createRequire } from "node:module";
import { test } from "node:test";
import ts from "typescript";
const require = createRequire(import.meta.url);

function harness() {
  const slots: any[] = [];
  let cursor = 0;
  const calls: any[] = [];
  let complete: (value: any) => void = () => {};
  const api: any = {};
  const source = readFileSync(
    new URL("../app/chat/components/KnowledgeWriteCard.tsx", import.meta.url),
    "utf8"
  );
  runInNewContext(
    ts.transpileModule(source, {
      compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
    }).outputText,
    {
      exports: api,
      require: (name: string) => {
        if (name === "react/jsx-runtime") return require(name);
        if (name === "react")
          return {
            useState: (initial: any) => {
              const slot = cursor++;
              if (!(slot in slots)) slots[slot] = initial;
              return [
                slots[slot],
                (value: any) => {
                  slots[slot] = value;
                },
              ];
            },
            useRef: (initial: any) => {
              const slot = cursor++;
              if (!(slot in slots)) slots[slot] = { current: initial };
              return slots[slot];
            },
          };
        if (name === "next-intl") return { useTranslations: () => (key: string) => key };
        if (name === "@/lib/axios")
          return {
            default: {
              post: (...args: any[]) => {
                calls.push(args);
                return new Promise((resolve) => {
                  complete = resolve;
                });
              },
            },
          };
        throw Error(name);
      },
    }
  );
  const selection = {
    request_id: "a".repeat(32),
    chat_id: "42",
    filename: "report.md",
    datasets: [{ id: "550e8400-e29b-41d4-a716-446655440000", name: "Mine" }],
  };
  return {
    calls,
    selection,
    complete: () => complete({ data: { status: "processing" } }),
    render() {
      cursor = 0;
      return api.default({ selection });
    },
  };
}
function nodes(tree: any, type: string): any[] {
  if (!tree || typeof tree !== "object") return [];
  if (Array.isArray(tree)) return tree.flatMap((item) => nodes(item, type));
  return [...(tree.type === type ? [tree] : []), ...nodes(tree.props?.children, type)];
}

test("no write until user selects and confirms, double click submits only once", async () => {
  const h = harness();
  let tree = h.render();
  assert.equal(h.calls.length, 0);
  assert.equal(nodes(tree, "button")[0].props.disabled, true);
  nodes(tree, "select")[0].props.onChange({ target: { value: h.selection.datasets[0].id } });
  tree = h.render();
  const submit = nodes(tree, "button")[0].props.onClick;
  const pending = submit();
  await submit();
  assert.equal(h.calls.length, 1);
  assert.equal(h.calls[0][1].chat_id, "42");
  assert.equal(h.calls[0][1].dataset_id, h.selection.datasets[0].id);
  h.complete();
  await pending;
  assert.equal(nodes(h.render(), "button").length, 0);
  assert.ok(
    nodes(h.render(), "p").some((item) => item.props.children === "knowledgeWriteProcessing")
  );
});
test("cancel dismisses controls without submitting a write", () => {
  const h = harness();
  nodes(h.render(), "button")[1].props.onClick();
  assert.equal(h.calls.length, 0);
  assert.equal(nodes(h.render(), "button").length, 0);
});
