import test from "node:test";
import assert from "node:assert/strict";
import {
  canReplacePackage,
  canPublishSavedPackage,
  type PackageReplacementPreview,
} from "../lib/skillPackageReplacement.ts";
const preview = (): PackageReplacementPreview => ({
  skill_id: 9,
  package_sha256: "hash",
  expected_version: "version",
  validation_token: "signed",
  expires_at: new Date(Date.now() + 60000).toISOString(),
  can_apply: true,
  warnings: [],
  files: [],
  removed_paths: [],
  counts: { added: 0, modified: 0, unchanged: 0, removed: 0, total_files: 0, total_bytes: 0 },
  preserved_fields: [],
  published_unchanged: true,
});
test("full replacement requires explicit deletion acknowledgement even with no warnings", () => {
  assert.equal(canReplacePackage(preview(), [], false), false);
  assert.equal(canReplacePackage(preview(), [], true), true);
});
test("slug mismatch and script/removal warnings require all warning codes", () => {
  const p = preview();
  p.warnings = [
    { code: "NAME_MISMATCH", message: "slug unchanged", confirmation_required: true },
    { code: "SCRIPT_CHANGED", message: "script", confirmation_required: true },
  ];
  assert.equal(canReplacePackage(p, ["NAME_MISMATCH"], true), false);
  assert.equal(canReplacePackage(p, ["NAME_MISMATCH", "SCRIPT_CHANGED"], true), true);
});
test("invalid preview, expiry, missing CAS/token or published mutation fail closed", () => {
  for (const patch of [
    { can_apply: false },
    { published_unchanged: false },
    { expires_at: "invalid" },
    { expires_at: new Date(0).toISOString() },
    { validation_token: "" },
    { expected_version: "" },
  ])
    assert.equal(canReplacePackage({ ...preview(), ...patch }, [], true), false);
});
const skill = {
  name: "slug",
  display_name: "Title",
  description: "Description",
  content: "Body",
  requires: { tools: ["a", "b"] },
  visibility: "private",
  owner_dept_id: 2,
  owner_tenant_id: 1,
  is_active: true,
  has_unpublished_changes: true,
};
const payload = () => ({
  name: "slug",
  display_name: "Title",
  description: "Description",
  content: "Body",
  requires: { tools: ["a", "b"] },
  visibility: "private",
  owner_dept_id: 2,
});
test("saved asset-only draft can publish without rewriting unchanged body/config", () => {
  assert.equal(canPublishSavedPackage(payload(), skill, false), true);
  assert.equal(
    canPublishSavedPackage(payload(), { ...skill, has_unpublished_changes: false }, false),
    false
  );
});
test("every writable field and requires order/structure prevents skipping a real edit", () => {
  for (const [field, value] of Object.entries({
    name: "new",
    display_name: "new",
    description: "new",
    content: "new",
    requires: { tools: ["b", "a"] },
    visibility: "public",
    owner_dept_id: 3,
    owner_tenant_id: 3,
    is_active: false,
    exec_config: { image: "new" },
  })) {
    assert.equal(
      canPublishSavedPackage({ ...payload(), [field]: value }, skill, false),
      false,
      field
    );
  }
  assert.equal(canPublishSavedPackage(payload(), skill, true), false);
});
test("server-null requires normalizes only empty tools, never ignores additional dependencies", () => {
  assert.equal(
    canPublishSavedPackage(
      { ...payload(), requires: { tools: [] } },
      { ...skill, requires: null },
      false
    ),
    true
  );
  assert.equal(
    canPublishSavedPackage(
      { ...payload(), requires: { tools: [] } },
      { ...skill, requires: { env: ["SECRET"] } },
      false
    ),
    false
  );
});

test("actual publish handler skips redundant save only for identical persisted payload", async () => {
  const ts = (await import("typescript")).default;
  const vm = await import("node:vm");
  const fs = await import("node:fs");
  const source = ts.createSourceFile(
    "page.tsx",
    fs.readFileSync(new URL("../app/skills/[id]/page.tsx", import.meta.url), "utf8"),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX
  );
  let callback = "";
  function visit(node: import("typescript").Node) {
    if (
      ts.isVariableDeclaration(node) &&
      node.name.getText(source) === "handlePublish" &&
      node.initializer
    )
      callback = node.initializer.getText(source);
    ts.forEachChild(node, visit);
  }
  visit(source);
  assert.ok(callback);
  for (const scenario of ["unchanged", "body-edit", "requires-edit", "exec-dirty", "save-fails"]) {
    const calls: string[] = [];
    const module = { exports: null as any };
    const edited =
      scenario === "body-edit" || scenario === "save-fails"
        ? { ...payload(), content: "Edited" }
        : scenario === "requires-edit"
          ? { ...payload(), requires: { tools: ["b", "a"] } }
          : payload();
    vm.runInNewContext(
      ts.transpileModule(`module.exports=${callback}`, {
        compilerOptions: { target: ts.ScriptTarget.ES2022 },
      }).outputText,
      {
        module,
        skill,
        canPublishSavedPackage,
        document: { querySelector: () => (scenario === "exec-dirty" ? {} : null) },
        setSaving: () => {},
        setSaveWarnings: () => {},
        parseSaveWarnings: () => [],
        saveDraft: async () => {
          calls.push("save");
          return scenario === "save-fails" ? null : skill;
        },
        publish: async () => calls.push("publish"),
      }
    );
    await module.exports(edited);
    assert.deepEqual(
      calls,
      scenario === "unchanged"
        ? ["publish"]
        : scenario === "save-fails"
          ? ["save"]
          : ["save", "publish"],
      scenario
    );
  }
});

test("actual runtime configuration dirty marker covers every unsaved config input", async () => {
  const ts = (await import("typescript")).default,
    vm = await import("node:vm"),
    fs = await import("node:fs");
  const source = ts.createSourceFile(
    "config.tsx",
    fs.readFileSync(
      new URL("../app/skills/components/SkillExecConfigForm.tsx", import.meta.url),
      "utf8"
    ),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX
  );
  let expression = "";
  function visit(node: import("typescript").Node) {
    if (
      ts.isVariableDeclaration(node) &&
      node.name.getText(source) === "configDirty" &&
      node.initializer
    )
      expression = node.initializer.getText(source);
    ts.forEachChild(node, visit);
  }
  visit(source);
  assert.ok(expression);
  const base = {
    image: "python:tag",
    selection: { value: "python:tag" },
    timeout: "120",
    DEFAULT_TIMEOUT: 120,
    needsNetwork: false,
    warmPool: false,
    artifactExclude: "*.tmp",
    writableSubdirs: ".state",
    config: {
      timeout_sec: 120,
      needs_network: false,
      warm_pool: false,
      artifact_exclude: ["*.tmp"],
      writable_subdirs: [".state"],
    },
  };
  assert.equal(vm.runInNewContext(expression, base), false);
  for (const change of [
    { image: "other" },
    { timeout: "121" },
    { needsNetwork: true },
    { warmPool: true },
    { artifactExclude: "*.log" },
    { writableSubdirs: ".other" },
  ])
    assert.equal(vm.runInNewContext(expression, { ...base, ...change }), true);
});
