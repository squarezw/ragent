import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createDirectPreviewResolver,
  inspectDirectPdfResponse,
  pdfDisposition,
} from "../lib/directPreviewLink.ts";

const file = {
  objectKey: "knowledge/test.pdf",
  mimetype: "application/pdf",
  filename: "康复指南.pdf",
};
function signed(
  request: { responseContentDisposition: string; responseContentType: string; expiresIn: number },
  time = Date.now()
) {
  const url = new URL("https://bucket.example/knowledge/test.pdf");
  url.searchParams.set(
    "X-Amz-Date",
    new Date(time)
      .toISOString()
      .replace(/[-:]/g, "")
      .replace(/\.\d{3}/, "")
  );
  url.searchParams.set("X-Amz-Expires", String(request.expiresIn));
  url.searchParams.set("X-Amz-Signature", "offline-signature");
  url.searchParams.set("response-content-disposition", request.responseContentDisposition);
  url.searchParams.set("response-content-type", request.responseContentType);
  return { url: url.toString() };
}
const proxy = { url: "/api/file-preview/stream?token=offline", expiresIn: 1800 };

test("UTF8 filename is encoded as an ASCII inline response header without injection", () => {
  const header = pdfDisposition("康复\r\n/指南.pdf");
  assert.match(header, /^inline; filename="document.pdf"; filename\*=UTF-8''/);
  assert.match(header, /%E5%BA%B7/);
  assert.ok(!/[\r\n\u0080-\uffff]/.test(header));
  assert.ok(pdfDisposition("长".repeat(500)).length <= 1024);
});

test("direct PDF signatures remain stable and do not renew their expiration", async () => {
  const resolve = createDirectPreviewResolver(200, async () => true);
  let calls = 0;
  const signer = async (request: Parameters<typeof signed>[0]) => {
    calls++;
    return signed(request);
  };
  const first = await resolve(proxy, file, signer);
  assert.equal(first.fallbackUrl, proxy.url);
  assert.ok(first.url.startsWith("https://"));
  const second = await resolve({ ...proxy, expiresIn: 1700 }, file, signer);
  assert.equal(second.url, first.url);
  assert.ok(second.expiresIn <= 1700);
  assert.equal(calls, 1);
});

test("legacy files and non-PDF files never invoke direct signing", async () => {
  const resolve = createDirectPreviewResolver(200, async () => true);
  const fail = async () => {
    throw new Error("must not sign");
  };
  assert.deepEqual(await resolve(proxy, { ...file, objectKey: undefined }, fail), proxy);
  assert.deepEqual(await resolve(proxy, { ...file, mimetype: "text/html" }, fail), proxy);
});

test("old gateways, signing errors and unsigned/unsafe links retain proxy delivery", async () => {
  for (const value of [
    "https://bucket.example/test.pdf",
    "http://bucket.example/test.pdf",
    "javascript:alert(1)",
  ]) {
    assert.deepEqual(
      await createDirectPreviewResolver(200, async () => true)(proxy, file, async () => ({
        url: value,
      })),
      proxy
    );
  }
  assert.deepEqual(
    await createDirectPreviewResolver(200, async () => true)(proxy, file, async () => {
      throw new Error("offline");
    }),
    proxy
  );
  assert.deepEqual(
    await createDirectPreviewResolver(200, async () => true)(proxy, file, async (req) => {
      const result = signed(req);
      const url = new URL(result.url);
      url.searchParams.set("response-content-type", "text/html");
      return { url: url.toString() };
    }),
    proxy
  );
});

test("expired, nearly expired and excessively long signatures fall back", async () => {
  for (const ttl of [0, 120, 3600]) {
    const result = await createDirectPreviewResolver(200, async () => true)(
      proxy,
      file,
      async (req) => signed({ ...req, expiresIn: ttl })
    );
    assert.deepEqual(result, proxy);
  }
  const result = await createDirectPreviewResolver(200, async () => true)(
    proxy,
    file,
    async (req) => signed(req, Date.now() - 3600_000)
  );
  assert.deepEqual(result, proxy);
});

test("bounded cache evicts oldest signatures", async () => {
  const resolve = createDirectPreviewResolver(1, async () => true);
  let calls = 0;
  const signer = async (req: Parameters<typeof signed>[0]) => {
    calls++;
    return signed(req);
  };
  await resolve(proxy, file, signer);
  await resolve({ ...proxy, url: `${proxy.url}2` }, file, signer);
  await resolve(proxy, file, signer);
  assert.equal(calls, 3);
});

test("malformed signing dates cannot escape as non-finite expiration", async () => {
  const result = await createDirectPreviewResolver(200, async () => true)(
    proxy,
    file,
    async (request) => {
      const url = new URL(signed(request).url);
      url.searchParams.set("X-Amz-Date", "20269999T999999Z");
      return { url: url.toString() };
    }
  );
  assert.deepEqual(result, proxy);
});

test("signing timeout aborts the request and keeps proxy delivery", async () => {
  const result = await createDirectPreviewResolver(200, async () => true)(
    proxy,
    file,
    async (_request, options) => {
      return new Promise((_resolve, reject) => {
        const keepAlive = setTimeout(() => reject(new Error("deadline not enforced")), 5000);
        options.signal.addEventListener(
          "abort",
          () => {
            clearTimeout(keepAlive);
            reject(options.signal.reason);
          },
          { once: true }
        );
      });
    }
  );
  assert.deepEqual(result, proxy);
});

test("storage attachment responses retain proxy delivery", async () => {
  const result = await createDirectPreviewResolver(200, async () => false)(
    proxy,
    file,
    async (request) => signed(request)
  );
  assert.deepEqual(result, proxy);
});

test("response probe checks real headers, requests one byte and cancels response body", async () => {
  for (const [status, disposition, type, force, expected] of [
    [206, "inline; filename=example.pdf", "application/pdf", "false", true],
    [200, "attachment", "application/pdf", "false", false],
    [206, "inline", "application/pdf", "true", false],
    [206, "inline", "text/html", "false", false],
    [403, "inline", "application/pdf", "false", false],
  ] as const) {
    let cancelled = false;
    const request: typeof fetch = async (_url, options) => {
      assert.equal((options?.headers as Record<string, string>).Range, "bytes=0-0");
      assert.equal(options?.redirect, "error");
      return new Response(
        new ReadableStream({
          cancel() {
            cancelled = true;
          },
        }),
        {
          status,
          headers: {
            "Content-Disposition": disposition,
            "Content-Type": type,
            "x-cos-force-download": force,
          },
        }
      );
    };
    assert.equal(
      await inspectDirectPdfResponse(
        "https://offline.invalid/test.pdf",
        AbortSignal.timeout(1000),
        request
      ),
      expected
    );
    assert.equal(cancelled, true);
  }
});
