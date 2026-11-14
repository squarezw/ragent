import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import * as protocol from "../lib/chatRun.ts";
import type { ChatRunSnapshot } from "../types/chat-run.ts";
import type { ChatRunClient as Client, RunTransport } from "../lib/chatRunClient.ts";
function client(
  transport: RunTransport,
  wait?: (ms: number, signal: AbortSignal) => Promise<void>
): Client {
  const module = {
    exports: {} as { ChatRunClient: new (transport: RunTransport, wait?: unknown) => Client },
  };
  vm.runInNewContext(
    ts.transpileModule(readFileSync(new URL("../lib/chatRunClient.ts", import.meta.url), "utf8"), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText,
    {
      module,
      exports: module.exports,
      require: () => protocol,
      AbortController,
      TextDecoder,
      URLSearchParams,
      setTimeout,
      clearTimeout,
    }
  );
  return new module.exports.ChatRunClient(transport, wait);
}
const run = (patch: Partial<ChatRunSnapshot> = {}): ChatRunSnapshot => ({
  run_id: "r1",
  session_id: "11",
  detail_id: 12,
  app_id: 1,
  status: "running",
  cursor: 0,
  answer: "",
  tool_steps: [],
  pending_confirmations: [],
  usage: null,
  result: null,
  error: null,
  updated_at: "2026-11-14T00:00:00Z",
  ...patch,
});
const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));
function response(wire: string) {
  return new Response(
    new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(wire));
        controller.close();
      },
    })
  );
}

test("lost admission response recovers exact request including terminal without replaying question", async () => {
  let posts = 0;
  const reads: string[] = [];
  const instance = client({
    post: async () => {
      posts++;
      throw Error("lost response");
    },
    get: async (path) => {
      reads.push(path);
      return { items: [run({ status: "completed", answer: "done" })] };
    },
    stream: async () => response(""),
  });
  const result = await instance.start({ question: "do work" }, "stable-key");
  assert.equal(result.answer, "done");
  assert.equal(posts, 1);
  assert.match(reads[0], /client_request_id=stable-key/);
});
test("network EOF reconnects reads only, replays by cursor and does not append duplicate tokens", async () => {
  let streams = 0;
  let posts = 0;
  const paths: string[] = [];
  let latest = run();
  const instance = client(
    {
      post: async () => {
        posts++;
        return run();
      },
      get: async () =>
        streams < 2
          ? run({ cursor: 1, answer: "A" })
          : run({ status: "completed", cursor: 3, answer: "AB" }),
      stream: async (path) => {
        paths.push(path);
        streams++;
        return response(
          streams === 1
            ? 'id: 1\nevent: delta\ndata: {"v":"A"}\n\n'
            : 'id: 1\nevent: delta\ndata: {"v":"A"}\n\nid: 2\nevent: delta\ndata: {"v":"B"}\n\nid: 3\nevent: finish\ndata: {}\n\n'
        );
      },
    },
    async () => {}
  );
  instance.subscribe(run(), (next) => {
    latest = next;
  });
  for (let i = 0; i < 12; i++) await flush();
  assert.equal(latest.answer, "AB");
  assert.equal(latest.status, "completed");
  assert.equal(posts, 0);
  assert.match(paths[1], /after=1$/);
  instance.detach();
});
test("detach on navigation closes only subscription, explicit stop alone performs cancellation POST", async () => {
  const posts: string[] = [];
  let signal: AbortSignal | undefined;
  let latest = run();
  const instance = client({
    post: async (path) => {
      posts.push(path);
      return run({ status: "stopping", cursor: 1 });
    },
    get: async () => run(),
    stream: async (_path, s) => {
      signal = s;
      return new Promise(() => {});
    },
  });
  instance.subscribe(run(), (next) => {
    latest = next;
  });
  await flush();
  instance.detach();
  assert.equal(signal?.aborted, true);
  assert.deepEqual(posts, []);
  instance.subscribe(run(), (next) => {
    latest = next;
  });
  await instance.stop();
  assert.deepEqual(posts, ["/api/chat/turns/r1/stop"]);
  assert.equal(latest.status, "stopping");
  instance.detach();
});
test("stop failure leaves authoritative active state and can be retried", async () => {
  let attempts = 0;
  let latest = run();
  const instance = client({
    get: async () => run(),
    stream: async () => new Promise(() => {}),
    post: async () => {
      if (++attempts === 1) throw Error("offline");
      return run({ status: "stopping", cursor: 1 });
    },
  });
  instance.subscribe(run(), (next) => {
    latest = next;
  });
  await assert.rejects(instance.stop());
  assert.equal(latest.status, "running");
  await instance.stop();
  assert.equal(latest.status, "stopping");
  instance.detach();
});
test("snapshot reset corrects future cursor and two subscribers never cancel each other", async () => {
  const make = () =>
    client({
      post: async () => {
        throw Error("unexpected stop");
      },
      get: async () => run({ cursor: 5, answer: "truth", status: "completed" }),
      stream: async () =>
        response(
          `id: 5\nevent: snapshot\ndata: ${JSON.stringify(run({ cursor: 5, answer: "truth", status: "completed" }))}\n\n`
        ),
    });
  const first = make();
  const second = make();
  let latest = run();
  first.subscribe(run({ cursor: 99 }), () => {});
  second.subscribe(run({ cursor: 99 }), (next) => {
    latest = next;
  });
  first.detach();
  for (let i = 0; i < 5; i++) await flush();
  assert.equal(latest.cursor, 5);
  assert.equal(latest.answer, "truth");
  second.detach();
});

test("finish metadata waits for cleanup terminal status and cannot leave a running snapshot unsubscribed", async () => {
  let streams = 0;
  let latest = run();
  const instance = client(
    {
      post: async () => run(),
      get: async () =>
        streams < 2
          ? run({ cursor: 1, result: { usage: { total_tokens: 3 } } })
          : run({ status: "completed", cursor: 2, answer: "done" }),
      stream: async () => {
        streams++;
        return response(
          streams === 1
            ? 'id: 1\nevent: finish\ndata: {"usage":{"total_tokens":3}}\n\n'
            : 'id: 2\nevent: status\ndata: {"status":"completed"}\n\n'
        );
      },
    },
    async () => {}
  );
  instance.subscribe(run(), (next) => {
    latest = next;
  });
  for (let i = 0; i < 10; i++) await flush();
  assert.equal(streams, 2);
  assert.equal(latest.status, "completed");
  instance.detach();
});
