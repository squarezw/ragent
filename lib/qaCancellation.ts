import type { IncomingMessage, ServerResponse } from "node:http";

// A completed request body is not a disconnect. Watch the outgoing response
// and the explicit aborted event instead of IncomingMessage's normal close.
export function watchQaDisconnect(req: IncomingMessage, res: ServerResponse) {
  const controller = new AbortController();
  const abort = () => controller.abort();
  const close = () => {
    if (!res.writableFinished) abort();
  };
  req.on("aborted", abort);
  res.on("close", close);
  if (req.aborted || res.destroyed) abort();
  return {
    signal: controller.signal,
    dispose() {
      req.off("aborted", abort);
      res.off("close", close);
    },
  };
}

export async function forwardQaStream(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  res: { write: (chunk: string) => unknown; end: () => unknown; flush?: () => unknown },
  signal?: AbortSignal
) {
  const decoder = new TextDecoder();
  try {
    while (true) {
      signal?.throwIfAborted();
      const { done, value } = await reader.read();
      signal?.throwIfAborted();
      if (done) break;
      res.write(decoder.decode(value, { stream: true }));
      res.flush?.();
    }
    res.end();
  } finally {
    await closeQaReader(reader);
  }
}

export async function closeQaReader(reader: ReadableStreamDefaultReader<Uint8Array>) {
  try {
    await reader.cancel();
  } catch {
    // Abort can already have errored the stream. Cleanup must not replace
    // the original read error or turn successful completion into an error.
  } finally {
    reader.releaseLock();
  }
}
