import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createRequire } from "node:module";
import vm from "node:vm";
import ts from "typescript";
import pg from "pg";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import type { ComponentType } from "react";
import { sessionToolUsageQuery, type SessionToolUsage } from "../lib/sessionToolUsage.ts";

const socket = process.env.SESSION_TOOL_TEST_PGHOST;
test("session summary SQL isolates runs and deduplicates retained events and projections", { skip: !socket }, async () => {
  const client = new pg.Client({ host: socket, port: Number(process.env.SESSION_TOOL_TEST_PGPORT ?? 5432), database: "postgres" });
  await client.connect();
  try {
    await client.query(`
      CREATE TEMP TABLE chat_session_detail(id int, session_id int);
      CREATE TEMP TABLE chat_runs(run_id text, session_id text, detail_id int, workspace_id int, cursor int, projection json);
      CREATE TEMP TABLE chat_run_events(run_id text, cursor int, event text, data json);
      INSERT INTO chat_session_detail VALUES (1,101),(2,101),(3,5000);
      INSERT INTO chat_runs VALUES ('a','101',1,7,61,'{}'),('b','101',2,7,2,'{}'),
        ('foreign','101',1,9,1,'{}'),('wrong-detail','101',3,7,1,'{}');
      INSERT INTO chat_run_events VALUES ('a',1,'status','{}'),('b',1,'status','{}');
      INSERT INTO chat_run_events
      SELECT 'a', 2 * i + k, 'tool_status', json_build_object(
        'tool_call_id', i::text, 'phase', CASE k WHEN 0 THEN 'started' ELSE 'finished' END,
        'name', CASE WHEN i <= 21 THEN 'execute_skill' WHEN i <= 25 THEN 'search_knowledge_base'
          WHEN i <= 28 THEN 'load_skill' ELSE 'skill_view' END, 'ok', true, 'detail', 'private arguments')
      FROM generate_series(1,29) i CROSS JOIN generate_series(0,1) k;
      INSERT INTO chat_run_events
      SELECT r,2,'tool_status','{"tool_call_id":"1","name":"ocr_recognize","phase":"finished","ok":false}'::json
      FROM unnest(ARRAY['b','foreign','wrong-detail']) r;
      UPDATE chat_runs SET projection = (SELECT json_build_object('tool_steps',json_agg(data))
        FROM chat_run_events WHERE run_id='a' AND cursor IN (2,3)) WHERE run_id='a';
    `);
    const read = async (session = 101) => (await client.query<SessionToolUsage>(sessionToolUsageQuery, [session,7])).rows[0];
    const summary = await read();
    assert.equal(summary.coverage, "complete");
    assert.deepEqual(summary.tools.map(t => [t.name,t.calls,t.failures]), [
      ["execute_skill",21,0],["search_knowledge_base",4,0],["load_skill",3,0],
      ["ocr_recognize",1,1],["skill_view",1,0],
    ]);
    assert.doesNotMatch(JSON.stringify(summary), /private arguments|tool_call_id/);
    await client.query("DELETE FROM chat_run_events WHERE run_id='a' AND cursor<=3");
    assert.deepEqual(await read(), { ...summary, coverage: "partial" });
    assert.deepEqual(await read(5000), { coverage: "unavailable", tools: [] });
    await client.query("INSERT INTO chat_runs VALUES ('empty','5000',3,7,1,'{}'); INSERT INTO chat_run_events VALUES ('empty',1,'status','{}')");
    assert.deepEqual(await read(5000), { coverage: "complete", tools: [] });
    await client.query("INSERT INTO chat_run_events VALUES ('empty',2,'tool_status','{}')");
    assert.deepEqual(await read(5000), { coverage: "partial", tools: [] });
    await client.query("DELETE FROM chat_run_events WHERE run_id='empty' AND cursor=2");
    await client.query("INSERT INTO chat_session_detail VALUES (4,5000)");
    assert.deepEqual(await read(5000), { coverage: "partial", tools: [] });
  } finally {
    await client.end();
  }
});

const require = createRequire(import.meta.url);
export function renderSummary(locale: string, usage?: SessionToolUsage) {
  const messages = require(`../messages/${locale}/chatSessions.json`);
  const text = (key: string, args: Record<string, number> = {}) =>
    messages[key].replace(/\{(\w+)\}/g, (_: string, k: string) => args[k]);
  const mod = { exports: {} as { SessionToolSummary: ComponentType<{ usage?: SessionToolUsage }> } };
  const source = readFileSync(new URL("../app/chat-sessions/SessionToolSummary.tsx", import.meta.url), "utf8");
  vm.runInNewContext(ts.transpileModule(source, {
    compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS },
  }).outputText, { exports: mod.exports, require: (name: string) => name === "next-intl" ? { useTranslations: () => text } : require(name) });
  return renderToStaticMarkup(createElement(mod.exports.SessionToolSummary, { usage }));
}

test("session summary renders named counts and distinguishes missing, partial and empty histories", () => {
  const tools = [{ name: "execute_skill", calls: 21, failures: 0 }, { name: "ocr", calls: 1, failures: 1 }];
  assert.match(renderSummary("zh-CN", { coverage: "complete", tools }), /共 22 次，失败 1 次/);
  assert.match(renderSummary("en", { coverage: "partial", tools }), /Some records are unavailable/);
  assert.match(renderSummary("en", { coverage: "complete", tools: [] }), /No tools were called/);
  assert.match(renderSummary("en"), /No tool-call records are available/);
});

test("an out-of-scope viewer cannot query the session tool history", async () => {
  const mod = { exports: {} as { default: Function } };
  const source = readFileSync(new URL("../pages/api/chat/sessions/[id]/details.ts", import.meta.url), "utf8");
  const queries: string[] = [];
  const db = { query: async (sql: string) => {
    queries.push(sql);
    return { rows: [{ id: 101, user_id: 42 }] };
  } };
  const mocks: Record<string, unknown> = {
    "@/lib/db": { default: db },
    "@/lib/sessionToolUsage": { sessionToolUsageQuery },
    "@/lib/auth": { getUserIdFromRequest: () => 9 },
    "@/lib/workspaceTenant": { requireWorkspaceTenant: () => ({ enabled: true, tenantId: 7 }) },
    "@/lib/visibilityScope": {
      buildVisibilityScope: () => ({ conditions: [], params: [], nextIndex: 1 }),
      canViewOwner: () => false,
    },
  };
  vm.runInNewContext(ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: false },
  }).outputText, { exports: mod.exports, require: (name: string) => mocks[name] });
  let status = 0;
  await mod.exports.default({ method: "GET", query: { id: "101" } }, {
    status(code: number) { status = code; return this; }, json() {},
  });
  assert.equal(status, 403);
  assert.equal(queries.length, 1);
  assert.match(queries[0], /cs.operation_tenant_id = \$2/);
});
