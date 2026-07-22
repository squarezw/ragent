import { RagentOssClient } from "ragent-oss";

const baseUrl = process.env.OSS_SERVICE_URL!;

const rawClient = new RagentOssClient({
  baseUrl,
  apiKey: process.env.OSS_API_KEY!,
});

type ErrorWithExtras = Error & {
  statusCode?: number;
  body?: unknown;
  cause?: { name?: string; message?: string; code?: string; cause?: { code?: string }; errno?: number; syscall?: string; hostname?: string };
};

function describeError(err: unknown): Record<string, unknown> {
  if (!(err instanceof Error)) return { error: String(err) };
  const e = err as ErrorWithExtras;
  const info: Record<string, unknown> = { name: e.name, message: e.message };
  if (e.statusCode !== undefined) info.statusCode = e.statusCode;
  if (e.body !== undefined) info.body = e.body;
  if (e.cause) {
    info.cause = {
      name: e.cause.name,
      message: e.cause.message,
      code: e.cause.code ?? e.cause.cause?.code,
      errno: e.cause.errno,
      syscall: e.cause.syscall,
      hostname: e.cause.hostname,
    };
  }
  return info;
}

export const ossClient = new Proxy(rawClient, {
  get(target, prop, receiver) {
    const value = Reflect.get(target, prop, receiver);
    if (typeof value !== "function") return value;

    return (...args: unknown[]) => {
      const startedAt = Date.now();
      const result = value.apply(target, args);
      if (!(result instanceof Promise)) return result;

      return result.catch((err: unknown) => {
        console.error(`[ossClient] ${String(prop)} failed`, {
          durationMs: Date.now() - startedAt,
          baseUrl,
          arg: args[0],
          ...describeError(err),
        });
        throw err;
      });
    };
  },
});
