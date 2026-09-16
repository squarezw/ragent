/**
 * 定位「自动化建表脚本」—— 真源在后端仓，不在本仓。
 *
 * 本仓 ragent-public 是**公开仓**，平台的整体表结构由后端仓 ragent-service 统一维护
 * （`docker/db/`，见那边的 README）。建表脚本的真源因此是
 * **`ragent-service/docker/db/automation.sql`**，本仓**有意不保留副本** ——
 * 留副本必然悄悄落后，而读的人会以为它是真的（`docs/assets/quickStart/SOURCE.md`
 * 记着上一次漂移的教训：副本毫无察觉，照着搭出来的环境跟实际的不一样且看不出来）。
 *
 * 代价是拿不到后端仓检出时，读这份脚本的那几条断言无法校验。它们于是**跳过并说明原因**，
 * 而不是假装通过 —— 「测试全绿」比「少校验一方」危险得多。
 * 想跑全：把 ragent-service clone 到本仓的**同级目录**，或设
 * `AUTOMATION_SQL=<.../ragent-service/docker/db/automation.sql 绝对路径>`。
 *
 * ## 为什么单独成模块，而不是每个测试各复制一份
 *
 * 各测试文件里那种一行的 `withoutComments` 复制几份无所谓；这里不一样：三个候选路径、
 * 两个环境变量、外加"跳过理由只该有一份措辞"的语义，复制三份迟早走形，而走形的表现是
 * **某一条断言悄悄不再校验**，恰好是本文件想防的那类问题。
 *
 * 本文件名不以 `.test.ts` 结尾，所以 `pnpm test`（`node --test test/*.test.ts`）不会把它
 * 当成测试收走。
 */
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * 按顺序找建表脚本。都找不到返回 null（调用方据此跳过），**不抛错** ——
 * 没 clone 后端仓不该让本仓的测试变红。
 */
function locateAutomationSql(): string | null {
  const candidates = [
    process.env.AUTOMATION_SQL,
    process.env.RAGENT_SERVICE_DIR
      ? join(process.env.RAGENT_SERVICE_DIR, "docker/db/automation.sql")
      : null,
    join(process.cwd(), "../ragent-service/docker/db/automation.sql"),
  ];

  for (const candidate of candidates) {
    if (candidate && existsSync(candidate)) return candidate;
  }

  return null;
}

/** 建表脚本的路径；`null` 表示这次没找到后端仓的检出。 */
export const AUTOMATION_SQL_PATH = locateAutomationSql();

/** SQL 相关断言的跳过理由；`false` 表示照常跑。node:test 会把理由显示在报告里。 */
export const SKIP_AUTOMATION_SQL: false | string = AUTOMATION_SQL_PATH
  ? false
  : "读不到后端仓的建表脚本。请把 ragent-service clone 到本仓同级目录，" +
    "或设 AUTOMATION_SQL=<ragent-service/docker/db/automation.sql 绝对路径>。" +
    "（本仓有意不保留副本，见 test/automationSqlPath.ts 的文件头。）";

/** 读建表脚本原文（注释未剔除，各测试按自己的需要处理）。 */
export function readAutomationSql(): string {
  assert.ok(AUTOMATION_SQL_PATH, "建表脚本未定位到 —— 调用方漏了 skip 判断");
  return readFileSync(AUTOMATION_SQL_PATH, "utf8");
}
