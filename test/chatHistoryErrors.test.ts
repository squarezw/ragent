import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
/* @ts-expect-error Node runs this test directly and requires the .ts extension. */
import { turnArtifacts } from "../lib/chatTurnArtifacts.ts";
import { chatRunFailureNotice } from "../lib/chatRun.ts";

async function details(
  options: { allowed?: boolean; missing?: boolean; runErrorCode?: string } = {}
) {
  const queries: { sql: string; values: unknown[] }[] = [];
  const errors = [
    {
      detail_id: 1,
      status: "failed",
      error_message: "DeepSeek HTTP 400: unsupported input",
      error_code: "CHAT_STREAM_FAILED",
      raw_body: "private",
    },
    {
      detail_id: 2,
      status: "completed",
      error_message: "stale error",
      error_code: "CHAT_STREAM_FAILED",
    },
  ];
  const module = { exports: {} as { default?: (req: unknown, res: unknown) => Promise<void> } };
  vm.runInNewContext(
    ts.transpileModule(
      readFileSync(new URL("../pages/api/chat/sessions/[id]/details.ts", import.meta.url), "utf8"),
      { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }
    ).outputText,
    {
      module,
      exports: module.exports,
      console: { error() {} },
      require: (name: string) => {
        if (name === "@/lib/workspaceTenant")
          return { requireWorkspaceTenant: async () => ({ enabled: true, tenantId: 8 }) };
        if (name === "@/lib/auth") return { getUserIdFromRequest: () => 4 };
        if (name === "@/lib/visibilityScope")
          return {
            buildVisibilityScope: async () => ({ conditions: [], params: [], nextIndex: 1 }),
            canViewOwner: async () => options.allowed !== false,
          };
        if (name === "@/lib/sessionToolUsage") return { sessionToolUsageQuery: "SELECT mocked_usage" };
        if (name === "@/lib/chatTurnArtifacts") return { turnArtifacts };
        if (name === "@/lib/sessionAttachments") return { normalizeSessionAttachments: () => [] };
        if (name === "@/lib/db")
          return {
            default: {
              query: async (sql: string, values: unknown[]) => {
                queries.push({ sql, values });
                if (sql.includes("FROM chat_session cs"))
                  return {
                    rows: [{ id: "11", user_id: 4, owner_tenant_id: 8, operation_tenant_id: 8 }],
                  };
                if (sql.includes("FROM chat_runs r")) {
                  if (options.runErrorCode)
                    throw Object.assign(new Error("query failed"), { code: options.runErrorCode });
                  if (options.missing)
                    throw Object.assign(new Error("missing table"), { code: "42P01" });
                  return { rows: errors };
                }
                if (sql.includes("jsonb_each")) return { rows: [{ id: 1, files: [
                  { id: "00000000-0000-4000-8000-000000000001", filename: "dir/report.xlsx", source: "private storage" }
                ] }] };
                if (sql.includes("FROM chat_session_detail"))
                  return {
                    rows: [1, 2].map((id) => ({
                      id,
                      session_id: "11",
                      question: "question",
                      answer: id === 1 ? "partial" : "success",
                      references: [],
                      total_tokens: null,
                    })),
                  };
                return { rows: [] };
              },
            },
          };
        throw new Error(name);
      },
    }
  );
  let status = 200;
  let body: Record<string, unknown> = {};
  const res = {
    status(value: number) {
      status = value;
      return res;
    },
    json(value: Record<string, unknown>) {
      body = value;
      return res;
    },
  };
  assert.ok(module.exports.default);
  await module.exports.default({ method: "GET", query: { id: "11" } }, res);
  return { status, body, queries };
}

test("history exposes only sanitized failed errors after session authorization with detail/workspace constraints", async () => {
  const result = await details();
  assert.equal(result.status, 200);
  const rows = result.body.details as {
    id: number;
    answer: string;
    error?: { message?: string; code?: string };
  }[];
  assert.equal(rows[0].answer, "partial");
  assert.equal(rows[0].error?.message, "DeepSeek HTTP 400: unsupported input");
  assert.deepEqual(Object.keys(rows[0].error || {}).sort(), ["code", "message"]);
  assert.equal(rows[1].error, undefined);
  const query = result.queries.find((query) => query.sql.includes("FROM chat_runs r"));
  assert.ok(query);
  assert.match(query.sql, /d.id = r.detail_id AND d.session_id::text = r.session_id/);
  assert.match(query.sql, /d.session_id = \$1/);
  assert.match(query.sql, /r.workspace_id = \$3/);
  assert.equal(query.values[0], "11");
  assert.equal(query.values[2], 8);
});

test("history authorization denial never queries errors; missing optional run table preserves legacy history", async () => {
  const denied = await details({ allowed: false });
  assert.equal(denied.status, 403);
  assert.equal(
    denied.queries.some((query) => query.sql.includes("FROM chat_runs")),
    false
  );
  const legacy = await details({ missing: true });
  assert.equal(legacy.status, 200);
  assert.equal((legacy.body.details as { error?: unknown }[])[0].error, undefined);
});

test("safe error formatting returns nonempty server messages unchanged and only falls back when empty", () => {
  const translate = (key: string) => key;
  for (const message of [
    "DeepSeek HTTP 400: unsupported input",
    "  original text\n",
    "Chat execution failed",
    " ",
  ]) {
    assert.equal(chatRunFailureNotice({ code: "CHAT_STREAM_FAILED", message }, translate), message);
  }
  assert.equal(
    chatRunFailureNotice({ code: "MODEL_RESPONSE_TIMEOUT", message: "" }, translate),
    "modelResponseTimeout"
  );
  assert.equal(chatRunFailureNotice(null, translate), "runFailed");
});

test("unexpected history run-query failures are not silently downgraded", async () => {
  const result = await details({ runErrorCode: "42501" });
  assert.equal(result.status, 500);
});

test("assistant error notice is rendered as React text instead of markdown or HTML", () => {
  const list = readFileSync(
    new URL("../app/chat/components/MessageList.tsx", import.meta.url),
    "utf8"
  );
  assert.match(list, /<p role="alert"[^>]*>\{msg.error\}<\/p>/);
  assert.doesNotMatch(list, /content=\{msg.error\}|dangerouslySetInnerHTML/);
});

test("history exposes turn-owned download cards with safe fields even after a failed answer", async () => {
  const { body } = await details();
  const [first, second] = body.details as { skill_artifacts: { id: string; filename: string; url: string }[] }[];
  assert.equal(first.skill_artifacts[0].filename, "dir/report.xlsx");
  assert.equal(first.skill_artifacts[0].url, "/api/chat/sessions/11/artifacts/00000000-0000-4000-8000-000000000001/download?filename=report.xlsx");
  assert.deepEqual(Object.keys(first.skill_artifacts[0]).sort(), ["filename", "id", "url"]);
  assert.equal(second.skill_artifacts.length, 0);
});
