import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import test from "node:test";
import ts from "typescript";
import { PreviewLinkCache } from "../lib/previewLinkCache.ts";

function harness() {
  const slots: any[] = [],
    effects: any[] = [],
    pending: any[] = [],
    calls: any[] = [];
  const timers = new Map<number, { callback: () => void; delay: number }>();
  const listeners = new Map<string, Set<() => void>>();
  let cursor = 0,
    dirty = false,
    now = 1000,
    timerId = 0,
    session = 0,
    logout = false;
  const user = { id: 1, tenant_id: 2 };
  const file = (id: string) => ({
    id,
    filename: `${id}.pdf`,
    originalname: `${id}.pdf`,
    mimetype: "application/pdf",
  });
  let props: any = { file: file("a"), open: true, onOpenChange() {} };
  let tree: any;
  const jsx = (type: any, props: any) => ({ type, props });
  const hooks = {
    useState(initial: any) {
      const index = cursor++;
      if (!(index in slots)) slots[index] = initial;
      return [
        slots[index],
        (next: any) => {
          if (!Object.is(slots[index], next)) {
            slots[index] = next;
            dirty = true;
          }
        },
      ];
    },
    useRef(initial: any) {
      const index = cursor++;
      if (!(index in slots)) slots[index] = { current: initial };
      return slots[index];
    },
    useEffect(run: () => any, deps: any[]) {
      const index = cursor++,
        prev = slots[index];
      if (!prev || deps.some((value, i) => !Object.is(value, prev.deps[i]))) {
        slots[index] = { deps, cleanup: prev?.cleanup };
        effects.push(() => {
          slots[index].cleanup?.();
          slots[index].cleanup = run();
        });
      }
    },
  };
  const module = { exports: {} as any };
  const translate = (value: string) => value;
  const mocks: any = {
    react: hooks,
    "react/jsx-runtime": { jsx, jsxs: jsx },
    "@/components/ui/button": { Button: "button" },
    "@radix-ui/react-dialog": {},
    "next-intl": { useTranslations: () => translate },
    "react-markdown": {},
    "lucide-react": {},
    sonner: { toast: {} },
    "@/hooks/useCurrentUser": { useCurrentUser: () => ({ user }) },
    "@/lib/browserAuthMode": { getSessionGeneration: () => session, isLogoutPending: () => logout },
    "@/lib/previewLinkCache": {
      PreviewLinkCache: class extends PreviewLinkCache {
        get(fileId: string) {
          return super.get(fileId, now);
        }
      },
    },
    "@/lib/axios": {
      default: {
        get() {
          throw Error("Unexpected metadata request");
        },
      },
    },
    "@/lib/fileApi": {
      isOfficeDocument: () => false,
      getFileDownloadUrl: () => "/download",
      getPreviewUrl(id: string, previousToken?: string) {
        calls.push({ id, previousToken });
        return new Promise((resolve, reject) => pending.push({ resolve, reject }));
      },
    },
  };
  vm.runInNewContext(
    ts.transpileModule(
      readFileSync(new URL("../components/FilePreviewDialog.tsx", import.meta.url), "utf8"),
      {
        compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
      }
    ).outputText,
    {
      module,
      exports: module.exports,
      require: (id: string) => {
        if (!(id in mocks)) throw Error(id);
        return mocks[id];
      },
      URL,
      console,
      Date: { now: () => now },
      window: {
        location: { origin: "http://fixture" },
        addEventListener(name: string, fn: () => void) {
          if (!listeners.has(name)) listeners.set(name, new Set());
          listeners.get(name)?.add(fn);
        },
        removeEventListener(name: string, fn: () => void) {
          listeners.get(name)?.delete(fn);
        },
      },
      setTimeout(callback: () => void, delay: number) {
        timers.set(++timerId, { callback, delay });
        return timerId;
      },
      clearTimeout(id: number) {
        timers.delete(id);
      },
    }
  );
  function render() {
    let rounds = 0;
    do {
      dirty = false;
      cursor = 0;
      tree = module.exports.FilePreviewDialog(props);
      for (const effect of effects.splice(0)) effect();
      if (++rounds > 20) throw Error("Render loop");
    } while (dirty);
  }
  const urls = () => {
    const found: string[] = [];
    function visit(node: any) {
      if (Array.isArray(node)) return node.forEach(visit);
      if (node?.props) {
        if (node.props.src) found.push(node.props.src);
        visit(node.props.children);
      }
    }
    visit(tree);
    return found;
  };
  render();
  return {
    calls,
    timers,
    urls,
    compatibility() {
      function visit(node: any): any {
        if (Array.isArray(node)) return node.map(visit).find(Boolean);
        if (!node?.props) return;
        if (node.type === "button" && node.props.children === "previewCompatibilityMode") return node;
        return visit(node.props.children);
      }
      const button = visit(tree);
      assert.ok(button);
      button.props.onClick();
      render();
    },
    file(id: string) {
      props = { ...props, file: file(id) };
      render();
    },
    open(open: boolean) {
      props = { ...props, open };
      render();
    },
    logout() {
      logout = true;
      session++;
      for (const fn of listeners.get("auth:logout-start") ?? []) fn();
      render();
    },
    refresh() {
      const timer = [...timers.entries()][0];
      timers.delete(timer[0]);
      timer[1].callback();
    },
    async reject() {
      pending.shift().reject(new Error("fixture temporary failure"));
      await new Promise((r) => setImmediate(r));
      render();
    },
    async resolve(url: string, expiresIn: number, elapsed = 0, fallbackUrl?: string) {
      now += elapsed;
      pending.shift().resolve({ url, expiresIn, fallbackUrl });
      await new Promise((r) => setImmediate(r));
      render();
    },
  };
}

test("late file A response cannot replace file B or create an A refresh timer", async () => {
  const h = harness();
  h.file("b");
  await h.resolve("/api/file-preview/stream?token=a", 600);
  assert.deepEqual(h.urls(), []);
  assert.equal(h.timers.size, 0);
  await h.resolve("/api/file-preview/stream?token=b", 600);
  assert.deepEqual(h.urls(), ["/api/file-preview/stream?token=b"]);
});

test("closed and signed-out previews reject in-flight responses and timers", async () => {
  for (const action of ["close", "logout"]) {
    const h = harness();
    if (action === "close") h.open(false);
    else h.logout();
    await h.resolve("/api/file-preview/stream?token=late", 600);
    assert.deepEqual(h.urls(), []);
    assert.equal(h.timers.size, 0);
  }
});

test("reopening reauthorizes with previous token; refresh uses remaining TTL", async () => {
  const h = harness();
  await h.resolve("/api/file-preview/stream?token=first", 600, 2000);
  assert.equal([...h.timers.values()][0].delay, 478000);
  h.open(false);
  h.open(true);
  assert.deepEqual(h.calls, [
    { id: "a", previousToken: undefined },
    { id: "a", previousToken: "first" },
  ]);
  await h.resolve("/api/file-preview/stream?token=first", 450, 3000);
  assert.equal([...h.timers.values()][0].delay, 327000);
});

test("transient scheduled refresh failure preserves the displayed document", async () => {
  const h = harness();
  await h.resolve("/api/file-preview/stream?token=first", 600);
  h.refresh();
  await h.reject();
  assert.deepEqual(h.urls(), ["/api/file-preview/stream?token=first"]);
  assert.equal(h.timers.size, 0);
  h.open(false);
  h.open(true);
  assert.equal(h.calls.length, 3);
});


test("direct PDF uses proxy token hints; compatibility choice survives refresh and resets on file switch", async () => {
  const h = harness();
  const fallback = "/api/file-preview/stream?token=first";
  await h.resolve("https://bucket.example/a.pdf", 600, 0, fallback);
  assert.deepEqual(h.urls(), ["https://bucket.example/a.pdf"]);
  h.compatibility();
  assert.deepEqual(h.urls(), [fallback]);
  h.refresh();
  assert.equal(h.calls[1].previousToken, "first");
  const renewed = "/api/file-preview/stream?token=renewed";
  await h.resolve("https://bucket.example/a-new.pdf", 600, 0, renewed);
  assert.deepEqual(h.urls(), [renewed]);
  h.file("b");
  await h.resolve("https://bucket.example/b.pdf", 600, 0, "/api/file-preview/stream?token=b");
  assert.deepEqual(h.urls(), ["https://bucket.example/b.pdf"]);
});
