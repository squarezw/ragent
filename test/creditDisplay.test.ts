import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import vm from "node:vm";
import ts from "typescript";

const compiled = ts.transpileModule(readFileSync("lib/creditDisplay.ts", "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS },
}).outputText;
const exports = {} as {
  formatCreditBalance: (value: number | string | null | undefined, locale: string) => string;
};
vm.runInNewContext(compiled, { exports, Intl });
const format = exports.formatCreditBalance;

test("credit balances show approximate integers without fractional digits", () => {
  assert.equal(format(1234.6, "zh-CN"), "1,235");
  assert.equal(format(0.49, "zh-CN"), "0");
  assert.equal(format(-0.49, "zh-CN"), "0");
  assert.equal(format(-0.5, "zh-CN"), "-1");
  assert.equal(format("9000.20", "en"), "9,000");
});

test("long balances use locale-specific compact units with no decimals", () => {
  assert.equal(format(10000, "zh-CN"), "1万");
  assert.equal(format(123456, "zh-CN"), "12万");
  assert.equal(format(100000000, "zh-CN"), "1亿");
  assert.equal(format(-10000, "zh-CN"), "-1万");
  assert.equal(format(123456, "en"), "123K");
  assert.equal(format(100000000, "en"), "100M");
});

test("missing or invalid balances are unknown rather than fabricated zero", () => {
  for (const value of [null, undefined, "", "invalid", NaN, Infinity])
    assert.equal(format(value, "zh-CN"), "—");
});

test("visible users are batched into at most 200 IDs per balance request", async () => {
  const requests: string[] = [];
  let swrKey: [string, number, string] | null = null;
  let loader: ((key: [string, number, string]) => Promise<unknown[]>) | undefined;
  const hookExports = {} as { useUserCreditBalances: (ids: number[]) => unknown };
  const hooks = ts.transpileModule(readFileSync("hooks/useBilling.ts", "utf8"), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      esModuleInterop: true,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;
  vm.runInNewContext(hooks, {
    exports: hookExports,
    URLSearchParams,
    require(name: string) {
      if (name === "react") return {};
      if (name === "@/hooks/useCurrentUser") return { useCurrentUser: () => ({ user: { id: 7 } }) };
      if (name === "swr")
        return (key: [string, number, string] | null, fetcher: typeof loader) => {
          swrKey = key;
          loader = fetcher;
          return { data: undefined, error: undefined, isLoading: true, mutate() {} };
        };
      if (name === "@/lib/axios")
        return {
          get: async (url: string) => {
            requests.push(url);
            return {
              data: {
                items: new URL(url, "http://localhost").searchParams
                  .get("user_ids")!
                  .split(",")
                  .map((id) => ({ user_id: Number(id), source: "user", balance: 100 })),
              },
            };
          },
        };
      throw new Error(name);
    },
  });
  hookExports.useUserCreditBalances([...Array.from({ length: 201 }, (_, i) => i + 1), 1]);
  assert.ok(swrKey);
  assert.ok(loader);
  const result = await loader(swrKey);
  assert.equal(requests.length, 2);
  assert.equal(result.length, 201);
  assert.equal(
    new URL(requests[0], "http://localhost").searchParams.get("user_ids")!.split(",").length,
    200
  );
  assert.equal(new URL(requests[1], "http://localhost").searchParams.get("user_ids"), "201");
});
