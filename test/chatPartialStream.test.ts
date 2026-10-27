import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import test from "node:test";
import ts from "typescript";

async function start() {
  const source = ts.createSourceFile(
    "page.tsx",
    readFileSync(new URL("../app/chat/page.tsx", import.meta.url), "utf8"),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX
  );
  let callback = "";
  function visit(node: ts.Node) {
    if (
      ts.isVariableDeclaration(node) &&
      node.name.getText(source) === "handleSend" &&
      node.initializer
    )
      callback = node.initializer.getText(source);
    ts.forEachChild(node, visit);
  }
  visit(source);
  assert.ok(callback);
  let callbacks: any;
  let messages: any[] = [];
  let streaming = "";
  let requests = 0;
  const version = { current: 0 };
  const module = { exports: null as unknown };
  vm.runInNewContext(
    ts.transpileModule(`module.exports = ${callback};`, {
      compilerOptions: { target: ts.ScriptTarget.ES2020 },
    }).outputText,
    {
      module,
      loading: false,
      loadingHistorySession: false,
      input: "question",
      attachments: [],
      conversationVersion: version,
      abortControllerRef: { current: null },
      selectedAppId: null,
      selectedDatasetIds: [],
      enableWebSearch: false,
      setMessages(update: (messages: any[]) => any[]) {
        messages = update(messages);
      },
      setStreamingMessage(value: string) {
        streaming = value;
      },
      setInput() {},
      setAttachments() {},
      setLoading() {},
      setIsStreaming() {},
      setToolSteps() {},
      focusInput() {},
      t: (key: string, params?: { message: string }) => (params ? `${key}:${params.message}` : key),
      askStream: async (_text: string, _datasets: unknown, _params: unknown, cb: unknown) => {
        requests++;
        callbacks = cb;
        return {};
      },
      console: { info() {}, error() {} },
    }
  );
  await (module.exports as () => Promise<void>)();
  return {
    get messages() {
      return messages;
    },
    get streaming() {
      return streaming;
    },
    get requests() {
      return requests;
    },
    callbacks,
    version,
  };
}

test("actual stream callbacks preserve all partial chunks exactly once and do not resend", async () => {
  const h = await start();
  h.callbacks.onChunk("first ");
  h.callbacks.onChunk("second");
  h.callbacks.onError({
    code: "MODEL_STREAM_INTERRUPTED",
    message: "raw upstream detail",
    detail_id: 19,
  });
  h.callbacks.onError({ code: "MODEL_STREAM_INTERRUPTED" });
  h.callbacks.onComplete({ answer: "late duplicate" });
  h.callbacks.onChunk("late chunk");
  assert.equal(h.messages.length, 2);
  assert.equal(h.messages[1].content, "first second\n\nstreamInterrupted");
  assert.equal(h.messages[1].detail_id, 19);
  assert.equal(h.streaming, "");
  assert.equal(h.requests, 1);
});

test("failure before output shows friendly message, not upstream transport details", async () => {
  const h = await start();
  h.callbacks.onError({ code: "CHAT_STREAM_FAILED", message: "incomplete chunked read" });
  assert.equal(h.messages[1].content, "streamFailed");
});

test("conversation version change rejects stale chunks and failure", async () => {
  const h = await start();
  h.version.current++;
  h.callbacks.onChunk("stale");
  h.callbacks.onError({ code: "MODEL_STREAM_INTERRUPTED" });
  assert.equal(h.messages.length, 1);
  assert.equal(h.streaming, "");
});

test("existing billing errors retain their localized business messages", async () => {
  for (const [code, expected] of [
    ["insufficient_balance", "insufficientBalance"],
    ["user_credit_account_busy", "creditAccountBusy"],
    ["user_credit_reconciliation_required", "creditReconciliationRequired"],
  ]) {
    const h = await start();
    h.callbacks.onError({ code, message: "backend language" });
    assert.equal(h.messages[1].content, expected);
  }
});

test("tenant model network and response timeout codes are localized without losing partial output", async () => {
  for (const [code, expected] of [
    ["MODEL_ENDPOINT_UNREACHABLE", "modelEndpointUnreachable"],
    ["MODEL_RESPONSE_TIMEOUT", "modelResponseTimeout"],
  ]) {
    for (const partial of ["", "received content"]) {
      const h = await start();
      if (partial) h.callbacks.onChunk(partial);
      h.callbacks.onError({ code, message: "raw socket error to internal endpoint" });
      assert.equal(h.messages[1].content, partial ? `${partial}\n\n${expected}` : expected);
      assert.equal(h.requests, 1);
      assert.equal(h.streaming, "");
    }
  }
});
