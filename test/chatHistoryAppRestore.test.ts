import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";

const REPO = path.resolve(import.meta.dirname, "..");
const read = (rel: string) => fs.readFileSync(path.join(REPO, rel), "utf8");

const PAGE = "app/chat/page.tsx";
const API = "pages/api/chat/sessions/[id]/details.ts";

/**
 * 加载历史会话时把数字员工切回这条会话原本用的那个（2026-09-05）。
 *
 * 不做这件事的后果不是"显示不对"：会话视图里**根本不渲染员工选择器**
 * （`showWelcomeView = messages.length === 0`），用户看不见当前是谁、也没法改。
 * 继续提问就带着上次选的员工跑，找不到原会话依赖的 skill，界面上毫无提示。
 *
 * 后端也有对应的一半（以 chat_session.app_id 为准），两边都要在 ——
 * 前端这半保证界面与实际一致，后端那半保证任何客户端都纠得回来。
 */

test("details 接口返回会话所属的数字员工", () => {
  const src = read(API);
  assert.match(src, /cs\.app_id,/, "SQL 没查 app_id");
  assert.match(src, /appId: session\.app_id \?\? null,/, "返回体没带 appId");
});

test("appId 允许为 null，不能强转成 0 或空串", () => {
  // 线上 44% 的会话没记 app_id。把它压成 0/"" 会让前端以为"有值"，
  // 然后去选一个不存在的员工。
  const src = read(API);
  assert.ok(
    !/appId: Number\(session\.app_id\)/.test(src) && !/appId: String\(session\.app_id\)/.test(src),
    "appId 被强转了，null 会变成 0 或 'null'",
  );
});

test("加载历史会话时恢复员工选择", () => {
  const src = read(PAGE);
  assert.match(src, /handleAppSelect\(String\(sessionData\.appId\)\)/,
    "loadHistorySession 没有恢复 selectedAppId");
});

test("没有 app_id 的老会话保持当前选择，不清空", () => {
  // 强行清空会让这些会话连默认员工都没有，比不改更糟。
  const src = read(PAGE);
  assert.match(src, /if \(sessionData\.appId != null\) \{/,
    "必须用 != null 判空——0 是合法 app_id 吗？不是，但空串/undefined 都要挡住，"
    + "而 `if (sessionData.appId)` 会把合法的 0 也挡掉");
});

test("恢复动作发生在渲染消息之前", () => {
  // 放到 setMessages 之后，会有一帧界面显示着旧员工 + 新消息。
  const src = read(PAGE);
  const restore = src.indexOf("handleAppSelect(String(sessionData.appId))");
  const setMsgs = src.indexOf("setMessages(historyMessages)");
  assert.ok(restore !== -1 && setMsgs !== -1, "找不到关键调用");
  assert.ok(restore < setMsgs, "恢复员工发生在渲染消息之后");
});

test("SELECT 里的每个 cs.* 列都在 GROUP BY 里", () => {
  // 2026-09-05：加了 cs.app_id 到 SELECT 却忘了 GROUP BY，
  // details 接口整个 500（`column "cs.app_id" must appear in the GROUP BY clause`）。
  // 上面那条"SQL 没查 app_id"的断言照样绿 —— 它只看文本在不在，
  // 看不出这条语句能不能跑。这一条补上结构层面的检查。
  const src = read(API);
  const q = src.split("const sessionQuery = `")[1].split("`")[0];
  const selectPart = q.split(/\bFROM\b/)[0];
  const groupPart = (q.split(/\bGROUP BY\b/)[1] ?? "").split("`")[0];

  const selected = [...selectPart.matchAll(/\bcs\.(\w+)/g)].map((m) => m[1]);
  const grouped = new Set([...groupPart.matchAll(/\bcs\.(\w+)/g)].map((m) => m[1]));

  const missing = [...new Set(selected)].filter((c) => !grouped.has(c));
  assert.deepEqual(missing, [], `这些 cs 列在 SELECT 里但不在 GROUP BY 里：${missing}`);
});
