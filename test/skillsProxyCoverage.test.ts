import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";

/**
 * 每个 `/api/v1/skills/*` 请求都要有一个 Next.js 转发文件，否则 404。
 *
 * 2026-08-09 踩的：后端加了 `PUT /skills/{id}/tenant`，前端没加对应的
 * `pages/api/v1/skills/[id]/tenant.ts`，于是浏览器拿到 404。**这个 404 是 Next.js
 * 自己报的，请求根本没到过后端** —— 看起来像"后端没实现这个接口"，实际后端好好的，
 * 少的是中间那一层。排查方向会整个跑偏。
 *
 * 这是同一类疏漏的第三次（前两次：pnpm-workspace.yaml 没进镜像、builtin_skills/
 * 没 COPY 进镜像）。共同点是：**新增了一条路径，忘了那个必须同步更新的配套层**，
 * 而三次的失败都不报错、只是静默不生效。
 *
 * ## 判据
 *
 * 扫前端代码里所有 `/api/v1/skills/...` 的调用字面量，检查每一个都能落到一个
 * 转发文件上。不去读后端源码（跨仓不可靠），而是以**前端真的会发出的请求**为准 ——
 * 那才是会 404 的东西。
 */

const REPO = path.resolve(import.meta.dirname, "..");
const PROXY_DIR = path.join(REPO, "pages/api/v1/skills");

/** 递归收集目录下的文件相对路径 */
function walk(dir: string, base = dir): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = path.join(dir, e.name);
    return e.isDirectory() ? walk(full, base) : [path.relative(base, full)];
  });
}

/** 把转发文件路径转成可匹配的段数组：`[id]/assets/[...path].ts` → ["*","assets","**"] */
function proxySegments(rel: string): string[] {
  return rel
    .replace(/\.tsx?$/, "")
    .split(path.sep)
    .map((seg) => {
      if (seg.startsWith("[...")) return "**";
      if (seg.startsWith("[")) return "*";
      return seg;
    })
    .filter((seg, i, arr) => !(seg === "index" && i === arr.length - 1));
}

function matches(proxy: string[], req: string[]): boolean {
  for (let i = 0; i < proxy.length; i++) {
    if (proxy[i] === "**") return true; // catch-all 吃掉剩余全部
    if (i >= req.length) return false;
    if (proxy[i] === "*") continue;
    if (proxy[i] !== req[i]) return false;
  }
  return proxy.length === req.length;
}

/** 收集源码里出现的 /api/v1/skills/... 调用路径（模板串里的 ${...} 视作一个动态段） */
function collectCalledPaths(): Map<string, string[]> {
  const found = new Map<string, string[]>();
  const roots = ["app", "hooks", "lib", "components"].map((d) => path.join(REPO, d));
  const re = /["'`]\/api\/v1\/skills\/([^"'`?]*)["'`?]/g;

  for (const root of roots) {
    for (const rel of walk(root)) {
      if (!/\.(ts|tsx)$/.test(rel)) continue;
      const src = fs.readFileSync(path.join(root, rel), "utf8");
      for (const m of src.matchAll(re)) {
        const raw = m[1];
        if (!raw) continue; // `/api/v1/skills` 本身由 index.ts 兜住
        const segs = raw
          .split("/")
          .filter(Boolean)
          .map((s) => (s.includes("${") ? "*" : s));
        if (segs.length === 0) continue;
        found.set(segs.join("/"), segs);
      }
    }
  }
  return found;
}

test("每个前端发出的 /api/v1/skills 请求都有转发文件", () => {
  const proxies = walk(PROXY_DIR).map(proxySegments);
  assert.ok(proxies.length > 0, "一个转发文件都没找到，测试前提不成立");

  const missing: string[] = [];
  for (const [label, segs] of collectCalledPaths()) {
    if (!proxies.some((p) => matches(p, segs))) missing.push(label);
  }

  assert.deepEqual(
    missing,
    [],
    `这些路径前端会调用但没有转发文件，请求会拿到 Next.js 的 404（不是后端的）：\n  ` +
      missing.join("\n  ")
  );
});

test("tenant 迁移的转发文件在位", () => {
  // 单独钉一条：它就是本次漏掉的那个，也是这个测试文件存在的理由
  assert.ok(
    fs.existsSync(path.join(PROXY_DIR, "[id]", "tenant.ts")),
    "缺 pages/api/v1/skills/[id]/tenant.ts —— 迁移租户会 404"
  );
});
