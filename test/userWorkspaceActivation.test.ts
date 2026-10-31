import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
const source = readFileSync('app/user/page.tsx', 'utf8');
const ast = ts.createSourceFile('page.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
function expression(name: string) {
  let value: ts.Expression | undefined;
  function visit(node: ts.Node) {
    if (ts.isVariableDeclaration(node) && node.name.getText(ast) === name) value = node.initializer;
    ts.forEachChild(node, visit);
  }
  visit(ast);
  assert.ok(value, name);
  if (ts.isCallExpression(value)) return value.arguments[0].getText(ast);
  return value.getText(ast);
}
function run(name: string, context: Record<string, unknown>) {
  const js = ts.transpileModule(`(${expression(name)})`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  return vm.runInNewContext(js, context);
}
function setup(enabled: boolean, ready = true) {
  const actor = { id: 1, tenant_id: 10, isSuperAdmin: true };
  const calls: any[] = [];
  let form: any;
  const context: Record<string, any> = { user: actor, workspace: { enabled }, workspaceReady: ready,
    operationTenantId: enabled ? 20 : 10, t: (key: string) => key,
    setForm: (value: any) => { form = value; }, setEditing() {}, setShowDialog() {}, setError() {},
    createEmptyUser: run('createEmptyUser', {}), setLoading() {}, setUsers() {}, setTenants() {}, setDepts() {},
    filterTenantId: 10, filterDeptId: null, debouncedSearchUsername: '', URLSearchParams, console,
    axios: { get: async (url: string) => { calls.push(url); return { data: { users: [], tenants: [], depts: [] } }; } } };
  return { context, actor, calls, form: () => form };
}
test('superadmin create uses selected workspace without changing actual actor tenant', () => {
  const s = setup(true); run('handleOpenAdd', s.context)();
  assert.equal(s.form().tenant_id, 20); assert.equal(s.form().dept_id, null); assert.equal(s.actor.tenant_id, 10);
});
test('disabled create preserves original superadmin default and tenant-admin default', () => {
  const s = setup(false); run('handleOpenAdd', s.context)(); assert.equal(s.form().tenant_id, null);
  s.actor.isSuperAdmin = false; Object.assign(s.actor, { isTenantAdmin: true });
  run('handleOpenAdd', s.context)(); assert.equal(s.form().tenant_id, 10);
});
test('not-ready scope cannot open create or edit; cross-workspace edit is rejected', () => {
  const s = setup(true, false); run('handleOpenAdd', s.context)(); assert.equal(s.form(), undefined);
  s.context.workspaceReady = true; run('handleOpenEdit', s.context)({ id: 3, tenant_id: 10 }); assert.equal(s.form(), undefined);
  run('handleOpenEdit', s.context)({ id: 4, tenant_id: 20, roles: ['normalUser'] }); assert.equal(s.form().id, 4);
});
test('enabled user and department queries use selected workspace rather than stale tenant filter', async () => {
  const s = setup(true); await run('fetchUsers', s.context)(); await run('fetchDepts', s.context)();
  assert.equal(s.calls[0], '/api/user/list?tenant_id=20'); assert.equal(s.calls[1], '/api/organization/depts?tenant_id=20');
});
test('disabled queries preserve original filters and superadmin department scope', async () => {
  const s = setup(false); await run('fetchUsers', s.context)(); await run('fetchDepts', s.context)();
  assert.equal(s.calls[0], '/api/user/list?tenant_id=10'); assert.equal(s.calls[1], '/api/organization/depts');
});
test('stale cross-workspace submit stops before network or loading side effects', async () => {
  const s = setup(true); s.context.form = { tenant_id: 10 }; s.context.setLoading = () => { throw Error('must not load'); };
  await run('handleSubmit', s.context)(); assert.equal(s.calls.length, 0);
});
