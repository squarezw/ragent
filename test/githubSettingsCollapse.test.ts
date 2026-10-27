import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

function load(file: string, mocks: Record<string, unknown>) {
  const module = { exports: {} as any };
  vm.runInNewContext(
    ts.transpileModule(readFileSync(new URL(`../${file}`, import.meta.url), "utf8"), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
    }).outputText,
    {
      module,
      exports: module.exports,
      require: (id: string) => {
        if (!(id in mocks)) throw Error(id);
        return mocks[id];
      },
    }
  );
  return module.exports;
}

test("actual GitHub section supports an initially collapsed accessible card and expands on click", () => {
  let cursor = 0;
  const slots: any[] = [];
  const jsx = (type: any, props: any) => ({ type, props });
  const react = {
    useEffect() {},
    useId: () => "github-fixture",
    useState(initial: any) {
      const i = cursor++;
      if (!(i in slots)) slots[i] = initial;
      return [
        slots[i],
        (value: any) => {
          slots[i] = typeof value === "function" ? value(slots[i]) : value;
        },
      ];
    },
  };
  const shared: Record<string, unknown> = {
    react,
    "react/jsx-runtime": { jsx, jsxs: jsx },
    "lucide-react": { Github: "icon", ChevronDown: "chevron" },
    "@/components/ui/card": {
      Card: "card",
      CardHeader: "header",
      CardTitle: "title",
      CardDescription: "description",
      CardContent: "content",
    },
  };
  const collapse = load(
    "app/system-settings/components/CollapsibleCard.tsx",
    shared
  ).CollapsibleCard;
  const github = load("app/system-settings/components/GithubOAuthSection.tsx", {
    ...shared,
    "./CollapsibleCard": { CollapsibleCard: collapse },
    "next-intl": { useTranslations: () => (key: string) => key },
    swr: { default: () => ({ data: null }) },
    sonner: { toast: {} },
    "@/lib/axios": { default: {} },
    "@/lib/apiError": {},
    "@/components/ui/button": { Button: "button" },
    "@/components/ui/input": { Input: "input" },
    "@/components/ui/label": { Label: "label" },
  }).default;
  function render() {
    cursor = 0;
    const section = github({ defaultOpen: false });
    return collapse(section.props);
  }
  function nodes(tree: any): any[] {
    return !tree
      ? []
      : Array.isArray(tree)
        ? tree.flatMap(nodes)
        : typeof tree === "object"
          ? [tree, ...nodes(tree.props?.children)]
          : [];
  }
  let all = nodes(render());
  assert.equal(
    all.some((node) => node.type === "input"),
    false
  );
  const toggle = all.find((node) => node.type === "button" && "aria-expanded" in node.props);
  assert.equal(toggle.props["aria-expanded"], false);
  toggle.props.onClick({ stopPropagation() {} });
  all = nodes(render());
  assert.equal(
    all.some((node) => node.type === "input"),
    true
  );
  assert.equal(
    all.find((node) => node.type === "button" && "aria-expanded" in node.props).props[
      "aria-expanded"
    ],
    true
  );
});
