import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import vm from "node:vm";
import ts from "typescript";

function load(file: string, mocks: Record<string, unknown>) {
  const module = { exports: {} as any };
  const source = readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  vm.runInNewContext(compiled, {
    module, exports: module.exports, console, process: { env: {} }, URLSearchParams,
    require(name: string) {
      if (name in mocks) return mocks[name];
      throw new Error(`Unexpected import: ${name}`);
    },
  });
  return module.exports;
}

async function listPermission({ canEdit, canContribute = canEdit, ownerTenant = 6, workspace = true, canAccess = true }: {
  canEdit: boolean; canContribute?: boolean; ownerTenant?: number; workspace?: boolean; canAccess?: boolean;
}) {
  let query = "";
  const handler = load("pages/api/knowledge/list.ts", {
    "@/lib/workspaceKnowledge": {
      withKnowledgeWorkspace: (handler: unknown) => handler,
      knowledgeWorkspaceContext: () => ({ enabled: workspace, tenantId: 6 }),
    },
    "@/lib/workspaceTenant": { workspaceHeaders: () => ({}) },
    "@/lib/auth": { getUserIdFromRequest: () => 2 },
    axios: { default: { get: async () => ({ data: { files: [], dataset: { name: "Empty" } } }) } },
    "@/lib/db": { default: { connect: async () => ({
      query: async (sql: string) => {
        query = sql;
        return { rows: [{ can_access: canAccess, can_upload: canContribute, can_replace: canEdit, owner_tenant_id: ownerTenant }] };
      }, release() {},
    }) } },
  }).default;
  const response: any = {
    statusCode: 200,
    status(code: number) { this.statusCode = code; return this; },
    json(data: unknown) { this.data = data; return this; },
  };
  await handler({ method: "GET", query: { dataset_id: "fixture" }, headers: {} }, response);
  return { response, query };
}

test("empty upload entry separates contribution from replacement within the workspace write boundary", async () => {
  const own = await listPermission({ canEdit: true });
  assert.equal(own.response.data.can_upload, true);
  assert.match(own.query, /can_edit_dataset/);
  assert.match(own.query, /can_upload_dataset/);
  assert.equal(own.response.data.can_replace, true);
  const contributor = await listPermission({ canEdit: false, canContribute: true });
  assert.equal(contributor.response.data.can_upload, true);
  assert.equal(contributor.response.data.can_replace, false);
  assert.equal((await listPermission({ canEdit: false })).response.data.can_upload, false);
  assert.equal((await listPermission({ canEdit: true, ownerTenant: 9 })).response.data.can_upload, false);
  assert.equal((await listPermission({ canEdit: false, canContribute: true, ownerTenant: 9 })).response.data.can_upload, false);
  assert.equal((await listPermission({ canEdit: true, ownerTenant: 9 })).response.data.can_replace, false);
  assert.equal((await listPermission({ canEdit: true, ownerTenant: 9, workspace: false })).response.data.can_upload, true);
  assert.equal((await listPermission({ canEdit: false, canAccess: false })).response.statusCode, 403);
});

test("empty file row is one native upload button only when an authorized callback is supplied", () => {
  const jsx = (type: unknown, props: unknown) => ({ type, props });
  const FileList = load("app/knowledge/components/FileList.tsx", {
    "react/jsx-runtime": { jsx, jsxs: jsx, Fragment: "fragment" },
    react: { useState: (value: unknown) => [value, () => {}] },
    "next-intl": { useTranslations: () => (key: string) => key },
    "@/components/ui/badge": { Badge: "badge" },
    "@/components/ui/button": { Button: "button" },
    "@/components/ui/checkbox": { Checkbox: "checkbox" },
    "@/components/ui/table": Object.fromEntries(["Table", "TableBody", "TableCell", "TableHead", "TableHeader", "TableRow"].map(name => [name, name])),
    "@/hooks/useVectorization": { useVectorization: () => ({}) },
    "lucide-react": {},
  }).FileList;
  const nodes = (tree: any): any[] => {
    if (!tree || typeof tree !== "object") return [];
    if (Array.isArray(tree)) return tree.flatMap(nodes);
    return [tree, ...nodes(tree.props?.children)];
  };
  let clicks = 0;
  const onUploadRequested = () => { clicks++; };
  const editable = nodes(FileList({ files: [], selectedFileIds: new Set(), onUploadRequested }));
  const buttons = editable.filter(node => node.type === "button");
  assert.equal(buttons.length, 1);
  assert.equal(buttons[0].props.type, "button");
  assert.equal(buttons[0].props["aria-label"], "startUploadFirst");
  buttons[0].props.onClick();
  assert.equal(clicks, 1);
  assert.equal(editable.find(node => node.type === "checkbox").props.onClick, undefined);
  const readOnly = nodes(FileList({ files: [], selectedFileIds: new Set() }));
  assert.equal(readOnly.filter(node => node.type === "button").length, 0);
});

test("duplicate uploads default to new documents for contributors and preserve editor replacement", async () => {
  for (const canReplace of [false, true]) {
    const state: any[] = [];
    const effects: (() => void)[] = [];
    let cursor = 0;
    const jsx = (type: unknown, props: unknown) => ({ type, props });
    const UploadDialog = load("app/knowledge/components/UploadDialog.tsx", {
      "react/jsx-runtime": { jsx, jsxs: jsx, Fragment: "fragment" },
      react: {
        useState(value: unknown) {
          const i = cursor++;
          if (!(i in state)) state[i] = value;
          return [state[i], (next: any) => { state[i] = typeof next === "function" ? next(state[i]) : next; }];
        },
        useRef: () => ({ current: null }), useCallback: (fn: unknown) => fn,
        useEffect: (fn: () => void) => { effects.push(fn); },
      },
      "next-intl": { useTranslations: () => (key: string) => key },
      "@radix-ui/react-dialog": Object.fromEntries(["Root", "Portal", "Overlay", "Content", "Title", "Description"].map(name => [name, name])),
      "@/components/ui/button": { Button: "button" },
      "@/components/ui/input": { Input: "input" },
      "@/components/ui/label": { Label: "label" },
      "@/components/ui/checkbox": { Checkbox: "checkbox" },
      "lucide-react": {}, sonner: { toast: {} },
      "@/lib/axios": { default: { post: async () => ({ data: { duplicates: {
        "same-name.pdf": [{ id: "old-file", filename: "old.pdf", originalname: "same-name.pdf", size: 10, mimetype: "application/pdf", upload_time: "2026-10-31" }],
      } } }) } },
      "@/lib/ossUpload": { uploadFile: () => { throw new Error("No upload should be called"); } },
      "@/components/TagSelect": { default: "tags" },
      "@/components/FilePreviewDialog": { FilePreviewDialog: "preview" },
    }).UploadDialog;
    const props = { isOpen: true, datasetId: "fixture", canReplace, initialFiles: [{ name: "same-name.pdf", size: 10, type: "application/pdf" }], onClose() {}, onUploadSuccess() {} };
    UploadDialog(props);
    effects.forEach(effect => effect());
    await new Promise(resolve => setImmediate(resolve));
    cursor = 0;
    const tree = UploadDialog(props);
    const nodes = (value: any): any[] => !value || typeof value !== "object" ? []
      : Array.isArray(value) ? value.flatMap(nodes) : [value, ...nodes(value.props?.children)];
    const replacement = nodes(tree).find(node => node.type === "checkbox");
    assert.ok(replacement);
    assert.equal(replacement.props.checked, canReplace);
    assert.equal(replacement.props.disabled, !canReplace);
    if (!canReplace) {
      replacement.props.onCheckedChange();
      assert.equal(state[0][0].duplicateFiles[0].shouldReplace, false);
      assert.match(JSON.stringify(tree), /uploadContributionOnly/);
    }
  }
});
