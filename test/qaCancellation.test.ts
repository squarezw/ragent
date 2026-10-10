import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import type { IncomingMessage, ServerResponse } from "node:http";
import { createServer, request } from "node:http";
import { once } from "node:events";
import { test } from "node:test";
import { forwardQaStream, watchQaDisconnect } from "../lib/qaCancellation.ts";

async function listen(server: ReturnType<typeof createServer>) {
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  return `http://127.0.0.1:${address.port}`;
}

test("browser disconnect cancels the upstream HTTP stream and cleans listeners", {
  timeout: 5000,
}, async () => {
  let upstreamClosed!: () => void;
  const closed = new Promise<void>((resolve) => {
    upstreamClosed = resolve;
  });
  const upstream = createServer((_req, res) => {
    res.writeHead(200, { "Content-Type": "text/event-stream" });
    res.write("data: first\n\n");
    res.on("close", upstreamClosed);
  });
  const upstreamUrl = await listen(upstream);
  let proxyFinished!: () => void;
  const finished = new Promise<void>((resolve) => {
    proxyFinished = resolve;
  });
  const proxy = createServer(async (req, res) => {
    const cancellation = watchQaDisconnect(req, res);
    try {
      const response = await fetch(upstreamUrl, { signal: cancellation.signal });
      assert.ok(response.body);
      await forwardQaStream(response.body.getReader(), res, cancellation.signal);
    } catch {
      assert.equal(cancellation.signal.aborted, true);
    } finally {
      cancellation.dispose();
      assert.equal(req.listenerCount("aborted"), 0);
      assert.equal(res.listenerCount("close"), 0);
      proxyFinished();
    }
  });
  const proxyUrl = await listen(proxy);
  try {
    await new Promise<void>((resolve, reject) => {
      const client = request(proxyUrl, { method: "POST" }, (res) => {
        res.once("data", () => {
          res.destroy();
          client.destroy();
          resolve();
        });
      });
      client.on("error", reject);
      client.end("completed request body");
    });
    await Promise.all([closed, finished]);
  } finally {
    proxy.closeAllConnections();
    upstream.closeAllConnections();
    await Promise.all([
      new Promise<void>((r) => proxy.close(() => r())),
      new Promise<void>((r) => upstream.close(() => r())),
    ]);
  }
});

test("normal response completion does not abort or leak listeners", { timeout: 5000 }, async () => {
  const server = createServer((req, res) => {
    const cancellation = watchQaDisconnect(req, res);
    req.on("end", () => {
      assert.equal(cancellation.signal.aborted, false);
      res.end("done");
      res.on("close", () => {
        assert.equal(cancellation.signal.aborted, false);
        cancellation.dispose();
      });
    });
    req.resume();
  });
  const url = await listen(server);
  try {
    assert.equal(await (await fetch(url, { method: "POST", body: "question" })).text(), "done");
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test("cancel after a read suppresses a late chunk and releases the reader", async () => {
  const controller = new AbortController();
  const stream = new ReadableStream<Uint8Array>({
    pull(source) {
      controller.abort();
      source.enqueue(new TextEncoder().encode("late tool output"));
    },
  });
  let writes = 0;
  await assert.rejects(
    forwardQaStream(
      stream.getReader(),
      { write: () => writes++, end: () => writes++ },
      controller.signal
    )
  );
  assert.equal(writes, 0);
  assert.equal(stream.locked, false);
});

test("disconnect before upstream headers aborts only that request", { timeout: 5000 }, async () => {
  let started!: () => void;
  const startedPromise = new Promise<void>((resolve) => {
    started = resolve;
  });
  let stopped!: () => void;
  const stoppedPromise = new Promise<void>((resolve) => {
    stopped = resolve;
  });
  let completeOther!: () => void;
  const otherReady = new Promise<void>((resolve) => {
    completeOther = resolve;
  });
  let otherStarted!: () => void;
  const otherStartedPromise = new Promise<void>((resolve) => {
    otherStarted = resolve;
  });
  const upstream = createServer(async (req, res) => {
    if (req.url === "/other") {
      res.write("un");
      otherStarted();
      await otherReady;
      res.end("affected");
    } else {
      res.on("close", stopped);
      started();
    }
  });
  const upstreamUrl = await listen(upstream);
  let finished!: () => void;
  const finishedPromise = new Promise<void>((resolve) => {
    finished = resolve;
  });
  const proxy = createServer(async (req, res) => {
    const cancellation = watchQaDisconnect(req, res);
    try {
      if (req.url === "/other") {
        const response = await fetch(`${upstreamUrl}/other`, { signal: cancellation.signal });
        assert.ok(response.body);
        await forwardQaStream(response.body.getReader(), res, cancellation.signal);
      } else {
        await fetch(upstreamUrl, { signal: cancellation.signal });
        assert.fail("upstream never sends headers");
      }
    } catch {
      assert.equal(cancellation.signal.aborted, true);
    } finally {
      cancellation.dispose();
      if (req.url !== "/other") finished();
    }
  });
  const proxyUrl = await listen(proxy);
  const client = request(proxyUrl);
  client.on("error", () => {});
  client.end();
  try {
    await startedPromise;
    const other = fetch(`${proxyUrl}/other`).then((response) => response.text());
    await otherStartedPromise;
    client.destroy();
    await Promise.all([stoppedPromise, finishedPromise]);
    completeOther();
    assert.equal(await other, "unaffected");
  } finally {
    completeOther();
    client.destroy();
    proxy.closeAllConnections();
    upstream.closeAllConnections();
    await Promise.all([
      new Promise<void>((resolve) => proxy.close(() => resolve())),
      new Promise<void>((resolve) => upstream.close(() => resolve())),
    ]);
  }
});

test("end requested without a finished flush still cancels on close", () => {
  const req = Object.assign(new EventEmitter(), { aborted: false });
  const res = Object.assign(new EventEmitter(), {
    destroyed: false,
    writableEnded: true,
    writableFinished: false,
  });
  const cancellation = watchQaDisconnect(req as IncomingMessage, res as ServerResponse);
  res.emit("close");
  assert.equal(cancellation.signal.aborted, true);
  cancellation.dispose();
});

test("reader cleanup preserves the original error when cancel also rejects", async () => {
  const primary = new Error("original read failure");
  let released = false;
  const reader = {
    read: async () => {
      throw primary;
    },
    cancel: async () => {
      throw new Error("secondary cleanup error");
    },
    releaseLock: () => {
      released = true;
    },
  } as unknown as ReadableStreamDefaultReader<Uint8Array>;
  await assert.rejects(
    forwardQaStream(reader, { write() {}, end() {} }),
    (error) => error === primary
  );
  assert.equal(released, true);
});
