import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import test from "node:test";
import ts from "typescript";

function deferred() {
  let resolve!: (value: string) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<string>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

function harness() {
  const state: any[] = [];
  const refs: any[] = [];
  const requests: ReturnType<typeof deferred>[] = [];
  const alerts: string[] = [];
  let si = 0;
  let ri = 0;
  const exports: any = {};
  const imports: Record<string, any> = {
    react: {
      useState(initial: any) {
        const i = si++;
        if (!(i in state)) state[i] = initial;
        return [
          state[i],
          (next: any) => {
            state[i] = typeof next === "function" ? next(state[i]) : next;
          },
        ];
      },
      useRef(initial: any) {
        const i = ri++;
        return (refs[i] ??= { current: initial });
      },
    },
    "next-intl": { useTranslations: () => (key: string) => key },
    "@/lib/axios": {
      default: {
        post: async (_url: string, data: any) => ({
          data: {
            filename: data.originalFilename,
            objectKey: data.objectKey,
            type: "image/png",
            content: "",
          },
        }),
      },
    },
    "@/lib/browserAuthMode": { isCookieAuthMode: () => true },
    "@/lib/ossUpload": {
      uploadFile: () => {
        const d = deferred();
        requests.push(d);
        return d.promise;
      },
      getFileUrl: (key: string) => key,
    },
    "@/lib/sessionAttachments": { sessionAttachmentMime: () => "image/png" },
    "@/lib/chatAttachments": { isAllowedAttachment: () => true },
    "@/lib/chatResourcePreview": {},
    "@/lib/workspaceBrowser": { workspaceUrl: (url: string) => url, getWorkspaceSnapshot: () => ({ enabled: false }) },
    "@/lib/chatAttachmentPreview": {},
  };
  runInNewContext(
    ts.transpileModule(
      readFileSync(new URL("../app/chat/hooks/useFileAttachments.ts", import.meta.url), "utf8"),
      {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
      }
    ).outputText,
    {
      exports,
      require: (name: string) => {
        assert.ok(name in imports, name);
        return imports[name];
      },
      localStorage: { getItem: () => null },
      console: { error() {} },
      alert: (message: string) => alerts.push(message),
    }
  );
  const render = () => {
    si = 0;
    ri = 0;
    return exports.useFileAttachments();
  };
  return { render, requests, alerts };
}

test("pending name is visible before upload resolves; completion produces only a ready attachment", async () => {
  const h = harness();
  const job = h.render().handleFileDrop([new File(["png"], "paste.png")]);
  assert.equal(h.requests.length, 1);
  assert.equal(h.render().pendingAttachments[0].filename, "paste.png");
  assert.equal(h.render().attachments.length, 0);
  assert.equal(h.render().uploading, true);
  h.requests[0].resolve("uploaded-key");
  await job;
  assert.equal(h.render().pendingAttachments.length, 0);
  assert.equal(h.render().attachments[0].filename, "paste.png");
  assert.equal(h.render().attachments[0].objectKey, "uploaded-key");
  assert.equal(h.render().uploading, false);
});

test("same-name concurrent uploads finish independently and failure clears only its pending row", async () => {
  const h = harness();
  const first = h.render().handleFileDrop([new File(["one"], "same.pdf")]);
  const second = h.render().handleFileDrop([new File(["two"], "same.pdf")]);
  const pending = h.render().pendingAttachments;
  assert.equal(pending.length, 2);
  assert.notEqual(pending[0].id, pending[1].id);
  h.requests[1].resolve("second-key");
  await second;
  assert.equal(h.render().pendingAttachments.length, 1);
  assert.equal(h.render().pendingAttachments[0].id, pending[0].id);
  assert.equal(h.render().attachments[0].objectKey, "second-key");
  assert.equal(h.render().uploading, true);
  h.requests[0].reject(new Error("offline"));
  await first;
  assert.equal(h.render().pendingAttachments.length, 0);
  assert.equal(h.render().attachments.length, 1);
  assert.equal(h.render().uploading, false);
  assert.equal(h.alerts.length, 1);
});
