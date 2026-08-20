/**
 * skills 代理层的查询参数白名单。
 *
 * `proxySkillsApi` 的 `passQuery` 是**白名单**：不在里面的参数被静默丢掉 ——
 * 不报错、不警告、请求照样 200。前端发了、后端没收到，用户看到的是
 * 「筛选了但列表没变」，而三处代码（hook / 代理 / 后端）看起来都是对的。
 *
 * 2026-08-20 就是这么漏的：tenant_id / dept_id 加到了 useSkills 和后端端点，
 * 忘了这一行。后端函数直接调用时筛选完全正确，走前端就是全量 —— 排查时很容易
 * 怀疑到授权逻辑上去，而病因在一个谁都不会看的转发文件里。
 *
 * 这条测试读源码文本而不是跑 handler：目的是**钉住那一行的内容**，
 * 而不是验证 Next.js 的转发行为（那属于 proxySkillsApi 自己的职责）。
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

const PROXY = join(process.cwd(), "pages/api/v1/skills/index.ts");

/** 后端 GET /api/v1/skills 支持的查询参数 —— 每一个都必须在白名单里 */
const BACKEND_QUERY_PARAMS = ["q", "tenant_id", "dept_id"];

function passQueryList(src: string): string[] {
  const m = src.match(/passQuery:\s*\[([^\]]*)\]/);
  assert.ok(m, "代理文件里找不到 passQuery —— 白名单被挪走了？");
  return m[1]
    .split(",")
    .map((s) => s.trim().replace(/^["']|["']$/g, ""))
    .filter(Boolean);
}

test("每个后端支持的查询参数都在代理白名单里", () => {
  const list = passQueryList(readFileSync(PROXY, "utf8"));
  for (const p of BACKEND_QUERY_PARAMS) {
    assert.ok(
      list.includes(p),
      `查询参数 ${p} 不在 passQuery 里，会被代理静默丢掉。` +
        `\n  当前白名单: ${JSON.stringify(list)}` +
        `\n  后端支持: ${JSON.stringify(BACKEND_QUERY_PARAMS)}` +
        `\n  加后端筛选参数时，这一行要同步。`
    );
  }
});

test("白名单里没有后端不认的参数", () => {
  // 反向也检查一次：白名单里放了后端不存在的参数，说明两边已经对不上 ——
  // 可能是后端删了参数而这里没跟，也可能是名字拼错。两种都值得知道。
  const list = passQueryList(readFileSync(PROXY, "utf8"));
  for (const p of list) {
    assert.ok(
      BACKEND_QUERY_PARAMS.includes(p),
      `passQuery 里的 ${p} 不在后端参数清单里（拼错，或后端已删）`
    );
  }
});
