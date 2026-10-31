import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
function harness(initialRole: string) {
  let role = initialRole, cursor = 0;
  const states: any[] = [], effects: (() => void)[] = [];
  const jsx = (type: any, props: any) => ({ type, props: props || {} });
  const api: any = {};
  const components = new Proxy({}, { get: (_, key) => String(key) });
  const skills = [{ id: 1, user_id: 11, author: 'Creator Alice', display_name: 'Skill A', name: 'a', visibility: 'tenant' }, { id: 2, user_id: 12, author: 'Creator Bob', display_name: 'Skill B', name: 'b', visibility: 'tenant' }];
  vm.runInNewContext(ts.transpileModule(readFileSync('app/skills/page.tsx', 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText, {
    exports: api, require(name: string) {
      if (name === 'react/jsx-runtime') return { jsx, jsxs: jsx };
      if (name === 'react') return { useState: (initial: any) => { const i = cursor++; if (!(i in states)) states[i] = initial; return [states[i], (v: any) => { states[i] = v; }]; }, useMemo: (fn: () => any) => fn(), useEffect: (fn: () => void) => effects.push(fn) };
      if (name === 'next-intl') return { useTranslations: () => (key: string) => key };
      if (name === 'next/navigation') return { useRouter: () => ({ push() {} }) };
      if (name === 'use-debounce') return { useDebounce: (v: any) => [v] };
      if (name === '@/hooks/useCurrentUser') return { useCurrentUser: () => ({ user: { id: 3 }, loading: false }) };
      if (name === '@/lib/clientPermissions') return { checkSuperAdmin: () => role === 'super', checkTenantAdmin: () => role === 'tenant', checkDeptAdmin: () => role === 'dept' };
      if (name === '@/app/components/WorkspaceProvider') return { useWorkspace: () => ({ enabled: true, tenant: { id: 20 } }) };
      if (name === '@/hooks/useSkills') return { useSkills: () => ({ skills, loading: false }) };
      if (name === '@/lib/skillCreatorFilter') return { getSkillCreators: (rows: any[]) => rows.map(r => ({ userId: r.user_id, name: r.author })), filterSkillsByCreator: (rows: any[], id: number | null) => id == null ? rows : rows.filter(r => r.user_id === id) };
      if (name === '@/lib/skillPermissions') return { canEditSkill: () => false, canDeleteSkill: () => false };
      if (name === '@/lib/reviewStatus') return { resolveReviewStatus: () => 'published', reviewStatusBadge: () => ({ labelKey: 'published' }) };
      if (name === '@/lib/skillOwnerLabel') return { getSkillOwnerLabel: () => ({ label: 'Organization' }) };
      if (name.endsWith('SkillOrgFilter')) return { default: 'SkillOrgFilter', defaultOrgFilter: () => null };
      return components;
    },
  });
  function nodes(n: any): any[] { if (!n || typeof n !== 'object') return []; if (Array.isArray(n)) return n.flatMap(nodes); return [n, ...nodes(n.props?.children)]; }
  return { render() { cursor = 0; effects.length = 0; return nodes(api.default()); }, effects() { effects.forEach(fn => fn()); }, role(value: string) { role = value; }, states };
}
for (const role of ['ordinary', 'dept']) test(`${role} list hides creator column, names and selector`, () => {
  const h = harness(role); const tree = h.render();
  assert.equal(tree.filter(n => n.type === 'Select').length, 0);
  assert.ok(!JSON.stringify(tree).includes('Creator Alice'));
  assert.equal(tree.filter(n => n.type === 'TableHead').length, 5);
});
for (const role of ['tenant', 'super']) test(`${role} list uses creator dropdown in search toolbar`, () => {
  const tree = harness(role).render();
  assert.equal(tree.filter(n => n.type === 'Select').length, 1);
  assert.ok(JSON.stringify(tree).includes('Creator Alice'));
  assert.equal(tree.filter(n => n.type === 'TableHead').length, 6);
  assert.ok(tree.findIndex(n => n.type === 'Input') < tree.findIndex(n => n.type === 'Select'));
});
test('losing administrator role immediately drops hidden creator filter and resets state', () => {
  const h = harness('tenant'); const tree = h.render();
  tree.find(n => n.type === 'Select')!.props.onValueChange('11');
  assert.equal(h.render().filter(n => n.type === 'TableRow').length, 2);
  h.role('ordinary'); const ordinary = h.render();
  assert.equal(ordinary.filter(n => n.type === 'TableRow').length, 3);
  h.effects(); h.role('tenant');
  assert.equal(h.render().find(n => n.type === 'Select')!.props.value, 'all');
});
