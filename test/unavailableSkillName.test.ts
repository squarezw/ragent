import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
const paths = ['app/apps/components/AppSkillsSection.tsx', 'app/apps/components/AppSkillDiagnostics.tsx'];
function labelExpression(path: string) {
  const source = readFileSync(path, 'utf8');
  const ast = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let expression = '';
  function visit(node: ts.Node) {
    if (ts.isJsxExpression(node) && node.expression) {
      const text = node.expression.getText(ast);
      if (text.includes('workspaceUnavailableSkill')) expression = text;
    }
    ts.forEachChild(node, visit);
  }
  visit(ast); assert.ok(expression, path);
  return expression;
}
for (const path of paths) {
  const expression = labelExpression(path);
  const render = (displayName: string, name: string) => vm.runInNewContext(expression, {
    info: { skillId: 42, displayName, name }, item: { skill_id: 42, display_name: displayName, skill_name: name, reason: 'workspace_unavailable' },
    row: { available: false }, t: () => '不可用的 Skill',
  });
  test(`${path}: unavailable binding shows real display name`, () => assert.equal(render('机械图纸公差提取', 'drawing-tolerance'), '机械图纸公差提取'));
  test(`${path}: missing display name uses actual technical name`, () => assert.equal(render('', 'drawing-tolerance'), 'drawing-tolerance'));
  test(`${path}: missing/deleted metadata retains localizable ID fallback`, () => assert.equal(render('', ''), '不可用的 Skill (#42)'));
}
test('unavailable bindings remain non-navigable and do not expose descriptions', () => {
  const source = readFileSync(paths[0], 'utf8');
  assert.match(source, /disabled=\{row\.available === false\}/);
  assert.match(source, /row\.available === false \? t\("workspaceUnavailable"\) : info\.description/);
});
