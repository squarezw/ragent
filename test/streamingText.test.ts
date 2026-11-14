import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

function mount(text = "", reducedMotion = false) {
  const slots: { value?: unknown; deps?: unknown[]; cleanup?: () => void }[] = [];
  let cursor = 0;
  let dirty = false;
  let effects: (() => void)[] = [];
  let props: [string, boolean, string | null] = [text, true, "r1"];
  let output = "";
  let now = 0;
  let sequence = 0;
  const frames = new Map<number, (time: number) => void>();
  const react = {
    useState(initial: unknown) {
      const i = cursor++;
      slots[i] ??= { value: initial };
      return [
        slots[i].value,
        (next: unknown) => {
          if (next !== slots[i].value) {
            slots[i].value = next;
            dirty = true;
          }
        },
      ];
    },
    useRef(initial: unknown) {
      const i = cursor++;
      slots[i] ??= { value: { current: initial } };
      return slots[i].value;
    },
    useEffect(effect: () => (() => void) | undefined, deps: unknown[]) {
      const i = cursor++;
      const old = slots[i];
      if (!old || deps.some((value, j) => value !== old.deps?.[j])) {
        slots[i] = { deps, cleanup: old?.cleanup };
        effects.push(() => {
          old?.cleanup?.();
          slots[i].cleanup = effect();
        });
      }
    },
  };
  const module = { exports: {} as { useStreamingText: (...args: typeof props) => string } };
  const code = ts.transpileModule(
    readFileSync(new URL("../hooks/useStreamingText.ts", import.meta.url), "utf8"),
    {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }
  ).outputText;
  vm.runInNewContext(code, {
    module,
    exports: module.exports,
    require: () => react,
    Intl,
    performance: { now: () => now },
    window: { matchMedia: () => ({ matches: reducedMotion }) },
    requestAnimationFrame: (frame: (time: number) => void) => {
      frames.set(++sequence, frame);
      return sequence;
    },
    cancelAnimationFrame: (id: number) => frames.delete(id),
  });
  const invokeHook = module.exports.useStreamingText;
  function render() {
    do {
      dirty = false;
      cursor = 0;
      effects = [];
      output = invokeHook(...props);
      for (const effect of effects) effect();
    } while (dirty);
    return output;
  }
  render();
  return {
    value: () => output,
    update: (next: string, enabled = true, identity: string | null = "r1") => {
      props = [next, enabled, identity];
      return render();
    },
    tick: (time: number) => {
      now = time;
      const pending = [...frames.values()];
      frames.clear();
      for (const frame of pending) frame(now);
      return render();
    },
    pending: () => frames.size,
    unmount: () => {
      for (const slot of slots) slot.cleanup?.();
    },
  };
}

test("live batches appear over animation frames instead of jumping in whole", () => {
  const hook = mount();
  assert.equal(hook.update("abcdef"), "");
  assert.equal(hook.tick(18), "a");
  assert.equal(hook.tick(36), "ab");
  hook.update("abcdefghi");
  assert.equal(hook.tick(54), "abc");
  assert.equal(hook.tick(236), "abcdefghi");
  assert.equal(hook.pending(), 0);
});
test("restored text and a different run display immediately without replaying history", () => {
  const hook = mount("saved partial");
  assert.equal(hook.value(), "saved partial");
  hook.update("saved partial plus");
  assert.ok(hook.pending());
  assert.equal(hook.update("other partial", true, "r2"), "other partial");
  assert.equal(hook.pending(), 0);
  assert.equal(hook.tick(200), "other partial");
});
test("terminal or stopped output bypasses animation and unmount cancels frames", () => {
  const hook = mount();
  hook.update("partial answer");
  assert.ok(hook.pending());
  assert.equal(hook.update("complete answer", false), "complete answer");
  assert.equal(hook.pending(), 0);
  hook.update("complete answer extra");
  assert.ok(hook.pending());
  hook.unmount();
  assert.equal(hook.pending(), 0);
});
test("Chinese, emoji sequences and combining marks are revealed as whole graphemes", () => {
  const hook = mount();
  hook.update("你👩‍💻好é");
  assert.equal(hook.tick(18), "你");
  assert.equal(hook.tick(36), "你👩‍💻");
  assert.equal(hook.tick(54), "你👩‍💻好");
  assert.equal(hook.tick(72), "你👩‍💻好é");
});
test("large batches catch up within 200ms and reduced motion uses immediate text", () => {
  const hook = mount();
  const long = "字".repeat(1000);
  hook.update(long);
  assert.ok(hook.tick(100).length < long.length);
  assert.equal(hook.tick(200), long);
  const reduced = mount("", true);
  assert.equal(reduced.update("instant"), "instant");
  assert.equal(reduced.pending(), 0);
});
test("corrected snapshots replace text without animating stale content", () => {
  const hook = mount("old answer");
  hook.update("old answer extra");
  assert.equal(hook.update("corrected"), "corrected");
  assert.equal(hook.pending(), 0);
});
