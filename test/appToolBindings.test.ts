import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { test } from "node:test";
import jwt from "jsonwebtoken";
import ts from "typescript";

const secret = "offline-app-tool-binding-test-only";
const token = jwt.sign({ userId: 17 }, secret);

function load(relative: string, imports: Record<string, unknown>, env = {}) {
  const exports: Record<string, any> = {};
  runInNewContext(
    ts.transpileModule(readFileSync(new URL(relative, import.meta.url), "utf8"), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
    }).outputText,
    {
      exports,
      process: { env },
      console: { error() {} },
      require: (name: string) => {
        assert.ok(name in imports, `unexpected import: ${name}`);
        return imports[name];
      },
    }
  );
  return exports;
}

const auth = load(
  "../lib/auth.ts",
  {
    jsonwebtoken: { default: jwt },
    "./localLogout": { isLocallySignedOut: () => false },
  },
  { JWT_SECRET: secret, OIDC_ENABLED: "true" }
);

async function invoke(
  route: string,
  method: string,
  options: {
    anonymous?: boolean;
    cookie?: boolean;
    backendStatus?: number;
    body?: unknown;
  } = {}
) {
  const calls: { method: string; url: string; data?: unknown; headers: Record<string, string> }[] =
    [];
  const backend = (verb: string) => async (url: string, dataOrConfig: any, config?: any) => {
    const headers = (verb === "delete" || verb === "get" ? dataOrConfig : config).headers;
    calls.push({ method: verb, url, data: config ? dataOrConfig : undefined, headers });
    if (options.backendStatus)
      throw {
        response: {
          status: options.backendStatus,
          data: { detail: "backend permission or tool validation" },
        },
      };
    return { data: { success: true } };
  };
  const handler = load(`../pages/api/apps/[id]/tools/${route}.ts`, {
    "@/lib/auth": auth,
    axios: {
      default: {
        get: backend("get"),
        post: backend("post"),
        put: backend("put"),
        delete: backend("delete"),
      },
    },
  }).default;
  let status = 200;
  let response: any;
  const res = {
    status(code: number) {
      status = code;
      return res;
    },
    json(value: unknown) {
      response = value;
      return res;
    },
    setHeader() {},
  };
  const headers = options.anonymous
    ? {}
    : {
        authorization: options.cookie ? "Bearer stale-header" : `Bearer ${token}`,
    "x-api-key": "unrelated-identity",
      };
  await handler(
    {
      method,
      query: { id: "21", toolId: "32" },
      cookies: options.cookie ? { ragent_token: token } : {},
      headers,
      body: options.body ?? (method === "PUT" ? { priority: 1 } : { tools: [{ tool_id: 5 }] }),
    },
    res
  );
  return { status, response, calls };
}

const operations = [
  ["batch", "POST"],
  ["index", "POST"],
  ["[toolId]", "PUT"],
  ["[toolId]", "DELETE"],
] as const;

for (const [route, method] of operations) {
  test(`${route} ${method}: ordinary owner reaches backend with cookie-selected identity`, async () => {
    const result = await invoke(route, method, {
      cookie: true,
      body:
        method === "PUT"
          ? { priority: 3, custom_config: { mode: "safe" }, ignored: true }
          : undefined,
    });
    assert.ok(result.status >= 200 && result.status < 300);
    assert.equal(result.calls.length, 1);
    assert.equal(result.calls[0].headers.Authorization, `Bearer ${token}`);
    assert.ok(result.calls[0].url.includes("/api/v1/apps/21/tools"));
    if (method === "PUT")
      assert.deepEqual(JSON.parse(JSON.stringify(result.calls[0].data)), {
        custom_config: { mode: "safe" },
        priority: 3,
      });
  });

  test(`${route} ${method}: anonymous denied; backend non-owner denial preserved`, async () => {
    const anonymous = await invoke(route, method, { anonymous: true });
    assert.equal(anonymous.status, 401);
    assert.equal(anonymous.calls.length, 0);
    const otherOwner = await invoke(route, method, { backendStatus: 403 });
    assert.equal(otherOwner.status, 403);
    assert.equal(otherOwner.calls.length, 1);
  });
}

test("binding preserves disabled-tool rejection and bearer-token compatibility", async () => {
  const disabled = await invoke("batch", "POST", { backendStatus: 400 });
  assert.equal(disabled.status, 400);
  const bearer = await invoke("batch", "POST");
  assert.equal(bearer.status, 200);
  assert.equal(bearer.calls[0].headers.Authorization, `Bearer ${token}`);
});
