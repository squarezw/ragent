/**
 * 每个弹层都必须有标题（2026-09-01）。
 *
 * Radix 的 Dialog 强制要求：没有 Title，读屏软件打开时念不出这是什么，
 * 控制台每次都报一条 error。手机版侧边栏漏了这个 —— 它平时是 <div>，
 * 只有窄屏下才变成 Sheet，桌面开发时根本碰不到，直到有人拿手机打开。
 *
 * 视觉上不想要标题就用 sr-only，别省掉。
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOTS = ["app", "components"];
const PAIRS = [
  ["DialogContent", "DialogTitle"],
  ["SheetContent", "SheetTitle"],
  ["AlertDialogContent", "AlertDialogTitle"],
  ["DrawerContent", "DrawerTitle"],
] as const;

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (p.endsWith(".tsx")) out.push(p);
  }
  return out;
}

test("所有 Dialog/Sheet 弹层都带标题", () => {
  const missing: string[] = [];
  for (const root of ROOTS) {
    for (const file of walk(root)) {
      const src = readFileSync(file, "utf-8");
      for (const [content, title] of PAIRS) {
        // 逐个开标签找，一个文件里可能有多个弹层
        const re = new RegExp(`<${content}[\\s>]`, "g");
        let m: RegExpExecArray | null;
        // biome-ignore lint/suspicious/noAssignInExpressions: 标准 regex 遍历写法
        while ((m = re.exec(src)) !== null) {
          const end = src.indexOf(`</${content}>`, m.index);
          if (end < 0) continue;
          if (!src.slice(m.index, end).includes(title)) {
            missing.push(`${file}:${src.slice(0, m.index).split("\n").length} 缺 ${title}`);
          }
        }
      }
    }
  }
  assert.deepEqual(missing, [], `这些弹层没有标题:\n${missing.join("\n")}`);
});

test("手机版侧边栏的标题是隐藏的，不是真渲染一行字", () => {
  // 导航自己就在下面，视觉上再加个标题是多余的；但不能因此省掉标签
  const src = readFileSync("components/ui/sidebar.tsx", "utf-8");
  assert.match(src, /<SheetTitle className="sr-only">/, "侧边栏标题没有用 sr-only 隐藏");
});
