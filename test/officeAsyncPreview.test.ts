import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { test } from "node:test";
import { runInNewContext } from "node:vm";
const require = createRequire(import.meta.url);
const ts = require("typescript");
const compile = (path: string) =>
  ts.transpileModule(readFileSync(new URL(path, import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;

test("actual Office component queues once, polls, displays ready, refreshes and cancels on file change", async () => {
  let effect: (() => void | (() => void)) | undefined;
  let state: any = { status: "pending" };
  let stateIndex = 0;
  let timer: (() => void) | undefined;
  let fallback = 0;
  const requests: any[] = [];
  const answers: any[] = [
    { status: "pending", retryAfter: 3 },
    { status: "running" },
    { status: "ready", url: "https://offline.invalid/preview.pdf", expiresIn: 300 },
  ];
  const imports: Record<string, any> = {
    react: {
      useState: (initial: any) =>
        stateIndex++ === 0
          ? [
              state,
              (value: any) => {
                state = value;
              },
            ]
          : [0, () => {}],
      useEffect: (fn: any) => {
        effect = fn;
      },
    },
    "react/jsx-runtime": {
      jsx: (type: any, props: any) => ({ type, props }),
      jsxs: (type: any, props: any) => ({ type, props }),
    },
    "next-intl": { useTranslations: () => (key: string) => key },
    "@/components/ui/button": { Button: "button" },
    "@/lib/axios": {
      default: {
        request: async (request: any) => {
          requests.push(request);
          const answer = answers.shift();
          if (answer instanceof Error) throw answer;
          return { data: answer };
        },
      },
    },
  };
  const module = { exports: {} as any };
  runInNewContext(compile("../components/OfficeAsyncPreview.tsx"), {
    module,
    exports: module.exports,
    require: (name: string) => imports[name],
    URL,
    AbortController,
    setTimeout: (fn: any) => {
      timer = fn;
      return 1;
    },
    clearTimeout: () => {
      timer = undefined;
    },
  });
  const render = (id = "1") => {
    stateIndex = 0;
    return module.exports.OfficeAsyncPreview({ fileId: id, onCompatibility: () => fallback++ });
  };
  const settle = () => new Promise((resolve) => setImmediate(resolve));
  render();
  const cleanup = effect?.();
  await settle();
  assert.equal(requests[0].method, "post");
  assert.equal(state.status, "pending");
  timer?.();
  await settle();
  assert.equal(requests[1].method, "get");
  assert.equal(state.status, "running");
  timer?.();
  await settle();
  assert.equal(state.status, "ready");
  const tree = render();
  assert.equal(tree.props.children[0].props.src, "https://offline.invalid/preview.pdf");
  assert.equal(fallback, 0);
  assert.equal(typeof timer, "function");
  if (typeof cleanup === "function") cleanup();
  assert.equal(requests[0].signal.aborted, true);
  assert.equal(timer, undefined);
  answers.push({ status: "disabled" });
  render("2");
  effect?.();
  await settle();
  assert.equal(fallback, 1);
});

test("proxy forwards only the authenticated original-file JWT and preserves backend ACL failures", async () => {
  let authenticated = true;
  const calls: any[] = [];
  const module = { exports: {} as any };
  const imports: Record<string, any> = {
    "@/lib/auth": {
      requireAuth: (_req: any, res: any) => {
        if (!authenticated) res.status(401).json({});
        return authenticated;
      },
      getTokenFromRequest: () => "offline-jwt",
    },
    axios: {
      default: {
        request: async (config: any) => {
          calls.push(config);
          return { status: 403, data: { error: "forbidden" } };
        },
      },
    },
  };
  runInNewContext(compile("../pages/api/file-preview/office.ts"), {
    module,
    exports: module.exports,
    require: (name: string) => imports[name],
    process: { env: {} },
  });
  let status = 0;
  const headers: Record<string, string> = {};
  const res = {
    setHeader: (key: string, value: string) => {
      headers[key] = value;
    },
    status: (value: number) => {
      status = value;
      return res;
    },
    json: () => res,
  };
  const req = {
    method: "POST",
    query: { fileId: "4" },
    body: { retry: true, objectKey: "untrusted" },
  };
  await module.exports.default(req, res);
  assert.equal(status, 403);
  assert.equal(headers["Cache-Control"], "no-store");
  assert.equal(calls[0].headers.Authorization, "Bearer offline-jwt");
  assert.equal(calls[0].data.retry, true);
  assert.equal(calls[0].data.objectKey, undefined);
  authenticated = false;
  await module.exports.default(req, res);
  assert.equal(status, 401);
  assert.equal(calls.length, 1);
  authenticated = true;
  req.query.fileId = "2147483648";
  await module.exports.default(req, res);
  assert.equal(status, 400);
  assert.equal(calls.length, 1);
  req.query.fileId = "process-document-4";
  await module.exports.default(req, res);
  assert.equal(status, 400);
  assert.equal(calls.length, 1);
});

test("Office component blocks denied/deleted fallback, handles revision changes and ignores stale responses", async () => {
  let effect: any;
  let state: any;
  let index = 0;
  let fallback = 0;
  let timer: any;
  let calls = 0;
  let answers: any[] = [];
  const module = { exports: {} as any };
  const imports: Record<string, any> = {
    react: {
      useState: (initial: any) =>
        index++ === 0
          ? [
              state || initial,
              (value: any) => {
                state = value;
              },
            ]
          : [0, () => {}],
      useEffect: (fn: any) => {
        effect = fn;
      },
    },
    "react/jsx-runtime": {
      jsx: (type: any, props: any) => ({ type, props }),
      jsxs: (type: any, props: any) => ({ type, props }),
    },
    "next-intl": { useTranslations: () => (key: string) => key },
    "@/components/ui/button": { Button: "button" },
    "@/lib/axios": {
      default: {
        request: async () => {
          calls++;
          const answer = answers.shift();
          if (answer?.response) throw answer;
          return { data: await answer };
        },
      },
    },
  };
  runInNewContext(compile("../components/OfficeAsyncPreview.tsx"), {
    module,
    exports: module.exports,
    require: (name: string) => imports[name],
    URL,
    AbortController,
    setTimeout: (fn: any) => {
      timer = fn;
      return 1;
    },
    clearTimeout: () => {
      timer = undefined;
    },
  });
  const render = () => {
    index = 0;
    return module.exports.OfficeAsyncPreview({ fileId: "1", onCompatibility: () => fallback++ });
  };
  const settle = () => new Promise((resolve) => setImmediate(resolve));
  for (const status of [401, 403, 404]) {
    answers = [{ response: { status } }];
    render();
    const cleanup = effect();
    await settle();
    assert.equal(state.status, status === 404 ? "missing" : "denied");
    const tree = render();
    assert.deepEqual(Array.from(tree.props.children[1].props.children), [false, false]);
    assert.equal(fallback, 0);
    cleanup();
  }
  answers = [{ response: { status: 409 } }, { status: "pending" }];
  render();
  let cleanup = effect();
  await settle();
  assert.equal(state.status, "pending");
  const staleTimer = timer;
  const callsBefore = calls;
  cleanup();
  staleTimer();
  await settle();
  assert.equal(calls, callsBefore);
  let resolveOld: any;
  answers = [
    new Promise((resolve) => {
      resolveOld = resolve;
    }),
  ];
  render();
  cleanup = effect();
  cleanup();
  state = { status: "pending" };
  resolveOld({ status: "ready", url: "https://offline.invalid/stale.pdf" });
  await settle();
  assert.equal(state.status, "pending");
  answers = [{ status: "ready", url: "javascript:alert(1)" }];
  render();
  cleanup = effect();
  await settle();
  assert.equal(state.status, "failed");
  cleanup();
});
