import { createRequire } from "node:module";
import test from "node:test";
const require = createRequire(import.meta.url);
const fs = require("fs"),
  vm = require("vm"),
  assert = require("node:assert/strict"),
  ts = require("typescript");
const root = process.cwd() + "/";
function load(file, deps = {}) {
  let exports = {};
  const src = ts.transpileModule(fs.readFileSync(root + file, "utf8"), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
  vm.runInNewContext(
    src,
    {
      exports,
      require: (id) => (id in deps ? deps[id] : id.startsWith("node:") ? require(id) : {}),
      console,
      process: deps.$process || process,
      fetch: deps.fetch,
      TextDecoder,
      URL,
      Buffer,
      Date,
      Number,
      Set,
      Map,
    },
    { filename: file }
  );
  return exports;
}
function response() {
  return {
    code: 200,
    body: null,
    status(c) {
      this.code = c;
      return this;
    },
    json(b) {
      this.body = b;
      return this;
    },
    setHeader() {},
    end() {},
    send(b) {
      this.body = b;
    },
  };
}
test("products and automation isolate operation tenants and retain creator ownership", async () => {
  let enabled = true;
  const contexts = load("lib/automation/workspace.ts", {
    "@/lib/workspaceTenant": { workspaceEnabled: () => enabled },
  });
  const ctx = (tenant) => ({ enabled: true, tenantId: tenant, actorUserId: 3, isSuperAdmin: true });
  await Promise.all(
    [1, 2].map((t) =>
      contexts.withAutomationWorkspace(ctx(t), async () => {
        await new Promise((r) => setTimeout(r, t === 1 ? 5 : 1));
        assert.equal(contexts.automationWorkspaceTenant(), t);
      })
    )
  );
  assert.throws(
    () => contexts.withAutomationWorkspace(ctx(0), () => contexts.automationTenantClause()),
    /REQUIRED/
  );
  await contexts.withAutomationWorkspace(ctx(99), async () => {
    await contexts.withoutAutomationWorkspace(async () => {
      await Promise.resolve();
      assert.equal(
        contexts.automationWorkspaceTenant(),
        null,
        "background scans cannot inherit HTTP workspace"
      );
    });
    assert.equal(contexts.automationWorkspaceTenant(), 99);
  });
  let queries = [];
  const pool = {
    query: async (sql, params = []) => {
      queries.push({ sql, params });
      if (sql.includes("COUNT(*)")) return { rows: [{ count: 0 }] };
      return { rows: [] };
    },
    connect: async () => ({ query: pool.query, release() {} }),
  };
  const deps = {
    "@/lib/db": { default: pool },
    "@/lib/auth": { requireAuth: () => true, getUserIdFromRequest: () => 3 },
    "@/lib/workspaceTenant": {
      requireWorkspaceTenant: async () => (enabled ? ctx(2) : { enabled: false }),
      workspaceHeaders: () => ({ "X-Workspace-Tenant-ID": "2" }),
    },
  };
  let h = load("pages/api/products/index.ts", deps).default;
  let res = response();
  await h({ method: "GET", query: {}, headers: {} }, res);
  assert.equal(res.code, 200);
  assert.equal(queries.length, 2);
  for (const q of queries) {
    assert.match(q.sql, /owner_tenant_id = \$1/);
    assert.equal(q.params[0], 2);
  }
  queries = [];
  res = response();
  await h(
    { method: "POST", query: {}, headers: {}, body: { sn: "s", name: "p", owner_tenant_id: 99 } },
    res
  );
  assert.equal(queries[1].params.at(-1), 2);
  assert.match(queries[1].sql, /owner_tenant_id/);
  queries = [];
  res = response();
  h = load("pages/api/products/[id].ts", deps).default;
  await h({ method: "DELETE", query: { id: "44" }, headers: {} }, res);
  assert.equal(res.code, 404);
  assert.equal(JSON.stringify(queries[0].params), JSON.stringify(["44", 2]));
  assert.match(queries[0].sql, /owner_tenant_id = \$2/);
  enabled = false;
  queries = [];
  h = load("pages/api/products/index.ts", deps).default;
  await h({ method: "GET", query: {}, headers: {} }, response());
  assert(queries.every((q) => !q.sql.includes("owner_tenant_id")));
  enabled = true;
  const store = load("lib/automation/store.ts", {
    "@/lib/db": { default: pool },
    "@/lib/automation/workspace": contexts,
    "@/lib/automation/schema": { assertAutomationTablesReady: async () => {} },
  });
  for (const [method, args] of [
    ["listAutomations", [3]],
    ["getAutomation", [3, 77]],
    ["listRuns", [3]],
    ["getRunForUser", [3, 55]],
    ["listRunActions", [3, 55]],
    ["listRunReviewHistory", [3, 55]],
  ]) {
    queries = [];
    await contexts.withAutomationWorkspace(ctx(2), () => store[method](...args));
    assert(queries.length > 0);
    for (const q of queries) {
      assert.match(q.sql, /tenant_id = 2/);
      assert.match(q.sql, /created_by_user_id/);
      assert(q.params.includes(3));
    }
  }
  queries = [];
  await contexts.withAutomationWorkspace(ctx(2), () => store.deleteAutomation(3, 99));
  assert(
    queries.every((q) => !q.sql.includes("DELETE")),
    "foreign task does not reach mutation"
  );

  // Webhook queues must never be drained by a different workspace.
  let active = ctx(1);
  const webhook = load("pages/api/automation/webhook.ts", {
    "@/lib/workspaceTenant": {
      workspaceEnabled: () => true,
      requireWorkspaceTenant: async (_req, res) => {
        if (!active) {
          res.status(401).json({ error: "unauthorized" });
          return null;
        }
        return active;
      },
    },
    "@/lib/automation/workspace": contexts,
    "@/lib/automation/store": {
      getAutomation: async (actor, id) => (id === active.tenantId * 10 ? { id } : null),
    },
    "@/lib/auth": { requireAuth: () => true },
  }).default;
  for (const tenant of [1, 2]) {
    active = ctx(tenant);
    let res = response();
    await webhook(
      {
        method: "POST",
        query: { automation_id: String(tenant * 10) },
        body: { payload: { tenant } },
        headers: {},
      },
      res
    );
    assert.equal(res.code, 202);
  }
  for (const tenant of [1, 2]) {
    active = ctx(tenant);
    let res = response();
    await webhook({ method: "GET", query: {}, headers: {} }, res);
    assert.equal(res.body.events.length, 1);
    assert.equal(res.body.events[0].tenant_id, tenant);
  }
  active = null;
  let denied = response();
  await webhook({ method: "POST", query: { automation_id: "10" }, body: {}, headers: {} }, denied);
  assert.equal(denied.code, 401);
  // An upload receipt comes from the immutable task, not a request's current tenant.
  const jwt = require("jsonwebtoken");
  const secret = "offline-workspace-receipt-fixture-not-a-real-secret";
  const receipt = load("lib/workspaceUploadReceipt.ts", {
    jsonwebtoken: { default: jwt },
    $process: { env: { JWT_SECRET: secret } },
  });
  const uploads = load("lib/automation/task-upload.ts", {
    "@/lib/workspaceTenant": { workspaceEnabled: () => enabled },
    "@/lib/workspaceUploadReceipt": receipt,
  });
  const attachment = {
    objectKey: "arbitrary-not-an-authority-prefix",
    filename: "sample.pdf",
    contentType: "application/pdf",
  };
  const signed = uploads.taskUploadAttachment({ created_by_user_id: 23, tenant_id: 8 }, attachment);
  const claims = jwt.verify(signed.uploadReceipt, secret, {
    audience: "ragent-workspace-upload",
    issuer: "ragent-upload",
    algorithms: ["HS256"],
  });
  assert.equal(claims.sub, "23");
  assert.equal(claims.operation_tenant_id, 8);
  assert.equal(claims.object_key, attachment.objectKey);
  assert.throws(
    () => uploads.taskUploadAttachment({ created_by_user_id: 23, tenant_id: null }, attachment),
    /SNAPSHOT/
  );
  enabled = false;
  assert.equal(
    uploads.taskUploadAttachment({ created_by_user_id: 23, tenant_id: null }, attachment),
    attachment
  );
  enabled = true;
  // Runtime headers are fixed to the persisted run/task tenant; JWT actor remains real.
  let outgoing;
  const payloads = load("lib/automation/agent-payload.ts");
  const execute = load("lib/automation/execute.ts", {
    "@/lib/workspaceTenant": {
      workspaceEnabled: () => enabled,
      WORKSPACE_HEADER: "X-Workspace-Tenant-ID",
    },
    "@/lib/automation/agent-payload": payloads,
    jsonwebtoken: { default: jwt },
    $process: { env: { JWT_SECRET: secret, EXTERNAL_API_BASE_URL: "http://offline.invalid" } },
    fetch: async (url, options) => {
      outgoing = { url, ...options };
      return {
        ok: true,
        body: { getReader: () => ({ read: async () => ({ done: true }), releaseLock() {} }) },
      };
    },
  });
  await execute.executeAutomationAgent({
    userId: 23,
    tenantId: 8,
    appId: 88,
    question: "offline",
    attachments: [signed],
  });
  assert.equal(outgoing.headers["X-Workspace-Tenant-ID"], "8");
  assert.equal(jwt.verify(outgoing.headers.Authorization.slice(7), secret).userId, 23);
  assert.equal(JSON.parse(outgoing.body).attachments[0].upload_receipt, signed.uploadReceipt);
  await assert.rejects(
    () => execute.executeAutomationAgent({ userId: 23, appId: 88, question: "offline" }),
    /SNAPSHOT/
  );

  console.log(
    "PASS: concurrent request tenants, invalid context, product count/list/detail/create/deletion boundary, flag-off old-schema compatibility, automation task/run/actions/history creator + tenant, foreign task cannot delete."
  );
});
