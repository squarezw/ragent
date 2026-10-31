import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
const jsx = (type: any, props: any) => ({ type, props: props || {} });
function renderDetail(canView: boolean | undefined, executable: boolean, tenantAdmin = false, retainedDialogs = false, actorId = 9, tenantId = 20) {
  const calls: string[] = [];
  let stateIndex = 0;
  let scope: unknown;
  const skill = { id: 7, name: 'shared-skill', display_name: 'Shared skill', description: 'safe summary', user_id: 2,
    is_executable: executable, can_view_content: canView, content: 'SECRET', requires: { tools: ['secret-tool'] } };
  const api: any = {};
  const source = ts.transpileModule(readFileSync('app/skills/[id]/page.tsx', 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  vm.runInNewContext(source, { exports: api, require(name: string) {
    if (name === 'react/jsx-runtime') return { jsx, jsxs: jsx };
    if (name === 'react') return { use: () => ({ id: '7' }), useState: (v: unknown) => [retainedDialogs ? [false, "OLD-PRIVATE-EXPORT", 7, []][stateIndex++] : v, () => {}], useEffect() {} };
    if (name === 'next/navigation') return { useRouter: () => ({ push() {} }) };
    if (name === 'next-intl') return { useTranslations: () => (key: string) => key };
    if (name === '@/hooks/useCurrentUser') return { useCurrentUser: () => ({ user: { id: actorId }, loading: false }) };
    if (name === '@/app/components/WorkspaceProvider') return { useWorkspace: () => ({ enabled: true, ready: true, tenant: { id: tenantId } }) };
    if (name === '@/hooks/useSkills') return { useSkill: (_id: number, accessScope: unknown) => { scope = accessScope; return ({ skill, loading: false, exportMarkdown: async () => { calls.push('export'); return 'SECRET'; } }); } };
    if (name === '@/lib/clientPermissions') return { checkSuperAdmin: () => false, checkTenantAdmin: () => tenantAdmin };
    if (name === '@/lib/skillPermissions') return { canEditSkill: () => tenantAdmin, canManageSkillLifecycle: () => tenantAdmin, canPublishSkill: () => tenantAdmin };
    if (name === '@/lib/skillRequires') return { takeSaveWarnings: () => [], parseSaveWarnings: () => [] };
    if (name.startsWith('../components/')) return { default: name.split('/').pop() };
    return new Proxy({}, { get: (_, key) => String(key) });
  } });
  const tree = api.default({ params: Promise.resolve({ id: '7' }) });
  const nodes: any[] = [];
  function walk(node: any) { if (!node || typeof node !== 'object') return; if (Array.isArray(node)) return node.forEach(walk); nodes.push(node); walk(node.props?.children); }
  walk(tree);
  return { nodes, calls, scope };
}
for (const tenantAdmin of [false, true]) for (const capability of [false, undefined]) test(`ordinary/cross-tenant admin content denied, tenantAdmin=${tenantAdmin}, capability=${capability}`, async () => {
  const r = renderDetail(capability, true, tenantAdmin);
  for (const name of ['SkillEditor', 'SkillAssetsPanel', 'SkillGitPanel', 'SkillDiffDialog']) assert.ok(!r.nodes.some(n => n.type === name), name);
  assert.ok(!r.nodes.some(n => n.props?.children === 'exportSkillMd'));
  assert.ok(r.nodes.some(n => n.type === 'SkillUserEnvPanel'));
  assert.ok(JSON.stringify(r.nodes).includes('safe summary'));
  assert.ok(!JSON.stringify(r.nodes).includes('SECRET'));
});
test('authoritative creator/super capability retains content UI', () => {
  const r = renderDetail(true, true);
  for (const name of ['SkillEditor', 'SkillAssetsPanel', 'SkillDiffDialog']) assert.ok(r.nodes.some(n => n.type === name), name);
  assert.ok(r.nodes.some(n => n.props?.children?.includes?.('exportSkillMd')) || r.nodes.some(n => n.props?.children === 'exportSkillMd'));
});
test('non-executable shared summary does not mount personal env fetches', () => {
  assert.ok(!renderDetail(false, false).nodes.some(n => n.type === 'SkillUserEnvPanel'));
});
for (const capability of [false, undefined, true]) test(`diagnostic tool dependencies require authoritative capability=${capability}`, () => {
  let gapReads = 0;
  const api: any = {};
  const source = readFileSync('app/apps/components/AppSkillDiagnostics.tsx', 'utf8') + '\nexport { BlockedSkill };';
  vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 } }).outputText, {
    exports: api, require(name: string) {
      if (name === 'react/jsx-runtime') return { jsx, jsxs: jsx };
      if (name === 'react') return { useMemo: (fn: () => unknown) => fn() };
      if (name === 'next-intl') return { useTranslations: () => (key: string) => key };
      if (name === '@/lib/skillRequires') return { buildGapGroups: () => { gapReads++; return [{ kind: 'tool', gaps: [{ kind: 'tool', name: 'PRIVATE-DEPENDENCY' }] }]; } };
      return new Proxy({}, { get: (_, key) => String(key) });
    },
  });
  const tree = api.BlockedSkill({ item: { skill_id: 7, display_name: 'Shared', skill_name: 'shared', reason: 'missing_tools', missing: [{ name: 'PRIVATE-DEPENDENCY' }], can_view_content: capability }, isSuperAdmin: true });
  assert.equal(gapReads, capability === true ? 1 : 0);
  assert.equal(JSON.stringify(tree).includes('PRIVATE-DEPENDENCY'), capability === true);
});

test('capability revoked after an owner view hides retained diff/export state and source props', () => {
  const permitted = renderDetail(true, true, false, true);
  assert.ok(permitted.nodes.some(n => n.type === 'SkillDiffDialog'));
  const denied = renderDetail(false, true, false, true);
  assert.ok(!denied.nodes.some(n => ['SkillEditor', 'SkillAssetsPanel', 'SkillDiffDialog'].includes(n.type)));
  assert.ok(!JSON.stringify(denied.nodes).includes('OLD-PRIVATE-EXPORT'));
  assert.ok(!JSON.stringify(denied.nodes).includes('SECRET'));
});
test('actual detail scopes its cache by actor, role and workspace', () => {
  const a = renderDetail(true, true, false, false, 9, 20).scope;
  assert.notEqual(a, renderDetail(false, true, false, false, 10, 20).scope);
  assert.notEqual(a, renderDetail(false, true, false, false, 9, 21).scope);
  assert.notEqual(a, renderDetail(false, true, true, false, 9, 20).scope);
});
function skillHook(capability: boolean | undefined, scope: string | null) {
  const keys: unknown[] = [], requests: string[] = [];
  const api: any = {};
  vm.runInNewContext(ts.transpileModule(readFileSync('hooks/useSkills.ts', 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, { exports: api, require(name: string) {
    if (name === 'swr') return { default: (key: unknown, _fetcher: unknown, options: any) => {
      keys.push(key); assert.equal(options.keepPreviousData, false);
      return { data: { can_view_content: capability, content: 'OLD-PRIVATE' }, mutate() {}, isLoading: false };
    } };
    if (name === 'next-intl') return { useTranslations: () => (key: string) => key };
    if (name === '@/hooks/useAppSkillDiagnostics') return { useInvalidateAppSkillDiagnostics: () => () => {} };
    if (name === '@/lib/axios') return { default: { get: async (url: string) => { requests.push(url); return { data: {} }; } } };
    if (name === 'sonner') return { toast: { success() {} } };
    return {};
  }, console });
  return { value: api.useSkill(7, scope), keys, requests };
}
for (const capability of [false, undefined]) test(`source request helpers do not request export or diff when capability=${capability}`, async () => {
  const h = skillHook(capability, 'actor9:tenant20');
  assert.equal(await h.value.exportMarkdown(), null); assert.equal(await h.value.fetchDiff(), null);
  assert.equal(h.requests.length, 0);
});
test('scoped detail hook never returns stale data while actor/workspace identity is unavailable', async () => {
  const h = skillHook(true, null); assert.equal(h.keys[0], null); assert.equal(h.value.skill, undefined);
  assert.equal(await h.value.exportMarkdown(), null); assert.equal(h.requests.length, 0);
});
test('detail hook cache keys separate identities and permitted export/diff remain available', async () => {
  const h = skillHook(true, 'actor9:tenant20'); const other = skillHook(false, 'actor10:tenant20');
  assert.notEqual(JSON.stringify(h.keys[0]), JSON.stringify(other.keys[0]));
  await h.value.exportMarkdown(); await h.value.fetchDiff(); assert.equal(h.requests.length, 2);
});
