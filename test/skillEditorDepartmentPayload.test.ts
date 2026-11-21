import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

const jsx = (type: unknown, props: any) => ({ type, props: props || {} });
const baseSkill = { id: 42, name: 'sample-skill', display_name: 'Sample', description: 'Summary', content: 'Body', owner_dept_id: 8, owner_tenant_id: 2, visibility: 'tenant', requires: { tools: ['tool'] }, status: 'draft', published_content: null, can_view_content: true };
function load(file: string, mocks: Record<string, any>) {
  const api: any = {};
  vm.runInNewContext(ts.transpileModule(readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 },
  }).outputText, { exports: api, require(name: string) {
    if (name in mocks) return mocks[name];
    if (name === 'react/jsx-runtime') return { jsx, jsxs: jsx };
    if (name === 'next-intl') return { useTranslations: () => (key: string) => key };
    return new Proxy({}, { get: (_, key) => String(key) });
  } });
  return api.default;
}
function nodes(tree: any): any[] {
  if (!tree || typeof tree !== 'object') return [];
  if (Array.isArray(tree)) return tree.flatMap(nodes);
  return [tree, ...nodes(tree.props?.children)];
}
function editor(skill: any = baseSkill, flags: any = {}) {
  let stateIndex = 0;
  const component = load('app/skills/components/SkillEditor.tsx', {
    react: { useEffect() {}, useMemo: (fn: () => unknown) => fn(), useState: (v: unknown) => [stateIndex++ === 8 && 'selectedDept' in flags ? flags.selectedDept : v, () => {}] },
    '@/hooks/useSkillCategories': { useSkillCategories: () => ({ categories: [], labelOf: (s: string) => s }) },
    '@/hooks/useRequiresOptions': { useRequiresOptions: () => ({ options: [] }) },
    '@/hooks/useOrganization': { useOrganization: () => ({ departments: [] }) },
    '@/hooks/useCurrentUser': { useCurrentUser: () => ({ user: { tenant_id: 2 } }) },
    '@/app/components/WorkspaceProvider': { useWorkspace: () => ({ enabled: false }) },
    '@/lib/skillRequires': { normalizeRequiresList: (v: unknown) => v || [] },
    '@/lib/skillValidation': { isValidSkillName: () => true, SKILL_DESCRIPTION_MAX_LENGTH: 1024 },
    '@/lib/reviewStatus': { resolveReviewStatus: () => 'draft', reviewStatusBadge: () => null, hasUnpublishedChanges: () => false },
  });
  let payload: any;
  const tree = component({ skill, saving: false, canReview: false, ...flags, onSaveDraft: (p: unknown) => { payload = p; }, onSubmitReview: (p: unknown) => { payload = p; } });
  return { click(label: string) {
    const button = nodes(tree).find(n => n.type === 'Button' && (n.props.children === label || n.props.children?.includes?.(label)));
    assert.ok(button, label); button.props.onClick(); return payload;
  } };
}
for (const [name, flags, expected] of [
  ['ordinary author', {}, undefined],
  ['tenant admin unchanged', { isTenantAdmin: true }, undefined],
  ['super admin unchanged', { isSuperAdmin: true }, undefined],
  ['tenant admin changed', { isTenantAdmin: true, selectedDept: 9 }, 9],
  ['super admin changed', { isSuperAdmin: true, selectedDept: 9 }, 9],
  ['ordinary author stale selection', { selectedDept: 9 }, undefined],
  ['null remains omitted', { isTenantAdmin: true, selectedDept: null }, undefined],
] as const) test(`actual editor payload: ${name}`, () => {
  const form = editor(baseSkill, flags);
  for (const action of ['saveDraft', 'submitReview']) {
    const p = form.click(action);
    assert.equal(p.owner_dept_id, expected);
    assert.equal(Object.hasOwn(p, 'owner_dept_id'), expected !== undefined);
    assert.equal(p.name, baseSkill.name); assert.equal(p.content, baseSkill.content);
    assert.equal(p.requires.tools[0], 'tool'); assert.equal(p.visibility, 'tenant');
  }
});
test('new admin selection is sent; new ordinary selection is omitted', () => {
  assert.equal(editor(null, { isTenantAdmin: true, selectedDept: 9 }).click('saveDraft').owner_dept_id, 9);
  assert.equal(Object.hasOwn(editor(null, { selectedDept: 9 }).click('saveDraft'), 'owner_dept_id'), false);
});
for (const success of [true, false]) test(`actual detail saves before review and only submits after success=${success}`, async () => {
  const calls: string[] = [];
  let finishSave: (v: unknown) => void = () => {};
  const save = new Promise(resolve => { finishSave = resolve; });
  const component = load('app/skills/[id]/page.tsx', {
    react: { use: () => ({ id: '42' }), useState: (v: unknown) => [v, () => {}], useEffect() {} },
    'next/navigation': { useRouter: () => ({ push() {} }) },
    '@/hooks/useCurrentUser': { useCurrentUser: () => ({ user: { id: 3 }, loading: false }) },
    '@/app/components/WorkspaceProvider': { useWorkspace: () => ({ enabled: false }) },
    '@/hooks/useSkills': { useSkill: () => ({ skill: baseSkill, loading: false, saveDraft: async (p: any) => { assert.equal(Object.hasOwn(p, 'owner_dept_id'), false); calls.push('save'); return save; }, submitReview: async () => { calls.push('submit'); } }) },
    '@/lib/clientPermissions': { checkSuperAdmin: () => false, checkTenantAdmin: () => false },
    '@/lib/skillPermissions': { canEditSkill: () => true, canManageSkillLifecycle: () => true, canPublishSkill: () => false },
    '@/lib/skillRequires': { takeSaveWarnings: () => [], parseSaveWarnings: () => [] },
    '../components/SkillEditor': { default: 'SkillEditor' },
  });
  const detail = nodes(component({ params: Promise.resolve({ id: '42' }) })).find(n => n.type === 'SkillEditor');
  assert.ok(detail);
  const pending = detail.props.onSubmitReview(editor().click('submitReview'));
  assert.deepEqual(calls, ['save']);
  finishSave(success ? baseSkill : null);
  await pending;
  assert.deepEqual(calls, success ? ['save', 'submit'] : ['save']);
});
