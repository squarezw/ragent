import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { normalizeTurnUsage } from "../types/token-usage.ts";

const REPO = path.resolve(import.meta.dirname, "..");
const read = (rel: string) => fs.readFileSync(path.join(REPO, rel), "utf8");

const DETAILS_API = read("pages/api/chat/sessions/[id]/details.ts");
const FEEDBACK_UI = read("app/chat/components/FeedbackUI.tsx");
const ADMIN_PAGE = read("app/chat-sessions/page.tsx");
const CHAT_HOOK = read("hooks/useChatSession.ts");

/**
 * 这一组守的是同一件事：**「没有用量记录」不能被渲染成「消耗 0」**。
 *
 * 后端在拿不到用量时写 NULL（迁移 058 六列都刻意没给 DEFAULT 0）。几万条存量
 * 对话全是 NULL，一旦哪一层把它折成 0，界面上就会出现「共消耗 0 tokens」——
 * 读起来是"这轮免费"，而真相是"没记"。这类错不会报错，只会让人相信一个假数字。
 */
test("接口在 total_tokens 为 NULL 时返回 undefined，而不是补 0", () => {
  assert.match(
    DETAILS_API,
    /detail\.total_tokens === null \|\| detail\.total_tokens === undefined\s*\?\s*undefined/,
    "NULL 用量必须整块给 undefined，前端才能靠「有没有这个对象」决定显示与否"
  );
});

test("聊天区靠 typeof 判断而不是真值判断", () => {
  // `usage?.totalTokens ? ...` 会把真实的 0 也吃掉。0 是合法值（极短的一轮），
  // 判据必须是"有没有这个数"，不是"这个数是不是非零"。
  assert.match(
    FEEDBACK_UI,
    /typeof credits === ["']string["']/,
    "hasCredits 必须用 typeof 判断 —— 真值判断会把空串当成有值",
  );
});

test("接口 SELECT 了六列用量字段", () => {
  // 只在 SELECT 块里找。用 includes 扫全文是无效断言：这些列名在下面的
  // 映射里（detail.usage_partial 等）也会出现，SELECT 漏了照样绿。
  const select = DETAILS_API.match(/SELECT[\s\S]*?FROM chat_session_detail/);
  assert.ok(select, "找不到 chat_session_detail 的 SELECT 语句");
  for (const col of [
    "prompt_tokens",
    "completion_tokens",
    "total_tokens",
    "llm_calls",
    "model_name",
    "usage_partial",
  ]) {
    assert.ok(select[0].includes(col), `details.ts 的 SELECT 少了 ${col}`);
  }
});

/**
 * 下面几条锁接线。2026-08-24 栽过一次：纯函数写好了、单测全绿，但按钮的
 * onChange 根本没调它，功能看起来做了却没生效。
 */
test("SSE finish 事件的 usage 被读出来", () => {
  assert.match(
    CHAT_HOOK,
    /if \(parsed\.usage\) \{[\s\S]{0,300}?usage = normalizeTurnUsage\(parsed\.usage\);/,
    "没解析 finish 里的 usage，刚问完的那轮就不会显示消耗"
  );
});

test("**每一个** onComplete 调用点都带 usage", () => {
  // 有两条结束路径：收到 [DONE]，和流结束但没收到 [DONE] 的兜底。
  // 2026-08-25 第一版只改了前者，兜底那条把 usage 丢了 —— 表现是"某些时候
  // 不显示消耗"，对话本身完全正常，最难被发现。所以按调用点计数来断言。
  const calls = CHAT_HOOK.match(/callbacks\?\.onComplete\(\{[\s\S]*?\}\);/g) ?? [];
  assert.ok(calls.length >= 2, `只找到 ${calls.length} 个 onComplete 调用点，预期至少 2`);
  calls.forEach((call, i) => {
    assert.ok(/\busage,/.test(call), `第 ${i + 1} 个 onComplete 没带 usage`);
  });
});

test("FeedbackUI 收 usage 并渲染", () => {
  assert.match(FEEDBACK_UI, /usage\?: TurnUsage;/, "props 没有 usage");
  assert.ok(FEEDBACK_UI.includes("tokenTotal"), "没渲染「共消耗」");
  assert.doesNotMatch(FEEDBACK_UI, /tokenUsageDetail/, "hover 明细应已移除");
});

test("hover 明细里带上模型调用次数", () => {
  // 一轮对话不等于一次调用：agent 每个工具轮次都重发完整上下文，输入量逐轮累积。
  // 没有这个数，看到很大的输入量无法区分「上下文长」还是「工具轮次多」。
  // 聊天区不再展示细节，但算账的人需要：没有这个数，看到很大的输入量
  // 无法区分「上下文长」还是「工具轮次多」。
  assert.match(ADMIN_PAGE, /usage\.llmCalls/, "管理员页丢了模型调用次数");
});

test("管理员会话详情显示 input / output 而不是只有合计", () => {
  // 聊天区空间紧张所以只显示合计、hover 出明细；管理员这页是拿来算账的，
  // 要能一眼扫过整列，不能藏在 hover 里。
  assert.ok(ADMIN_PAGE.includes("tokenInputLabel"), "管理员页没显示输入");
  assert.ok(ADMIN_PAGE.includes("tokenOutputLabel"), "管理员页没显示输出");
  assert.match(ADMIN_PAGE, /detail\.usage && \(/, "没有按 usage 存在与否做条件渲染");
});

test("中断的部分用量在两处都有标记", () => {
  // 不标的话，一个被中断的轮次会和完整轮次长得一模一样，汇总时也拎不出来。
  assert.ok(FEEDBACK_UI.includes("tokenPartialMark"), "聊天区没标中断");
  assert.ok(ADMIN_PAGE.includes("tokenPartialLabel"), "管理员页没标中断");
});

test("两个语种的 token 文案齐全且一一对应", () => {
  for (const ns of ["chat", "chatSessions"]) {
    const zh = JSON.parse(read(`messages/zh-CN/${ns}.json`));
    const en = JSON.parse(read(`messages/en/${ns}.json`));
    const zhKeys = Object.keys(zh).filter((k) => k.startsWith("token"));
    const enKeys = Object.keys(en).filter((k) => k.startsWith("token"));
    assert.ok(zhKeys.length > 0, `${ns} 没有 token 文案`);
    assert.deepEqual(zhKeys.sort(), enKeys.sort(), `${ns} 中英 token 文案对不上`);
  }
});

/**
 * 同一份用量有两条路进前端，形态不同：SSE finish 事件是后端直出的 snake_case，
 * 历史消息经 details.ts 转成了 camelCase。
 *
 * 2026-08-25 踩的：实时那条没转，`usage.totalTokens` 取到 undefined，「共消耗」
 * 一直不显示 —— 而库里数据好好的（prompt 39550 / completion 172 都记下了）。
 * TypeScript 抓不到：SSE 那边 parsed 是 any。
 *
 * 上一轮那些结构断言也抓不到 —— 它们检查"有没有接线"，不检查"两端字段名对不对得上"。
 */
test("归一：后端直出的 snake_case 能读出来", () => {
  const u = normalizeTurnUsage({
    prompt_tokens: 39550,
    completion_tokens: 172,
    total_tokens: 39722,
    llm_calls: 1,
    model_name: "deepseek-v4-flash",
    usage_partial: false,
  });
  assert.equal(u?.totalTokens, 39722, "snake_case 没转成 camelCase → 界面不显示");
  assert.equal(u?.promptTokens, 39550);
  assert.equal(u?.completionTokens, 172);
  assert.equal(u?.llmCalls, 1);
  assert.equal(u?.modelName, "deepseek-v4-flash");
  assert.equal(u?.partial, false);
});

test("归一：已经是 camelCase 的原样通过", () => {
  const u = normalizeTurnUsage({ totalTokens: 100, promptTokens: 80, completionTokens: 20 });
  assert.equal(u?.totalTokens, 100);
  assert.equal(u?.promptTokens, 80);
});

test("归一：中断标记两种字段名都认", () => {
  assert.equal(normalizeTurnUsage({ total_tokens: 5, usage_partial: true })?.partial, true);
  assert.equal(normalizeTurnUsage({ totalTokens: 5, partial: true })?.partial, true);
});

test("归一：没有合计就是「没记录」，不能兜成 0", () => {
  // 兜成 0 会渲染出「共消耗 0 tokens」，读起来是"这轮免费"
  assert.equal(normalizeTurnUsage({}), undefined);
  assert.equal(normalizeTurnUsage(null), undefined);
  assert.equal(normalizeTurnUsage({ prompt_tokens: 10 }), undefined, "只有输入没有合计也算没记录");
});

test("归一：合计为 0 是合法值，要保留", () => {
  // 0 与"没记录"不同：极短的一轮确实可能是 0，那时该显示「共消耗 0」
  assert.equal(normalizeTurnUsage({ total_tokens: 0 })?.totalTokens, 0);
});

test("SSE 解析点必须过归一，不能直接赋值", () => {
  assert.match(
    CHAT_HOOK,
    /usage = normalizeTurnUsage\(parsed\.usage\)/,
    "直接 usage = parsed.usage 会把 snake_case 塞进 camelCase 的类型里，静默不显示"
  );
});


// ── 缓存命中：同样的 token 数，成本可能差十倍 ────────────────────────────

test("归一：缓存命中的 snake_case 也要转", () => {
  const u = normalizeTurnUsage({
    total_tokens: 39722,
    prompt_tokens: 39550,
    cache_read_tokens: 38400,
  });
  assert.equal(u?.cacheReadTokens, 38400, "缓存命中没转 → 界面看不到，成本判断全错");
});

test("接口 SELECT 与映射都带上缓存列", () => {
  const select = DETAILS_API.match(/SELECT[\s\S]*?FROM chat_session_detail/);
  assert.ok(select?.[0].includes("cache_read_tokens"), "SELECT 少了 cache_read_tokens");
  assert.match(DETAILS_API, /cacheReadTokens: detail\.cache_read_tokens/, "没映射成 camelCase");
});

test("两处显示都带缓存命中", () => {
  // 只显示总量会让人对成本产生完全错误的直觉：4 万 token 里三万多是缓存命中时，
  // 真实成本约为按全额算的六分之一。
  assert.ok(ADMIN_PAGE.includes("cacheReadTokens"), "管理员页没有缓存命中");
});


test("聊天区显示积分而非 token", () => {
  // token 数对用户没有意义：他既不为 token 付钱，也控制不了那 4 万的工具定义。
  // 积分才是账户里会少掉的东西。
  assert.match(FEEDBACK_UI, /usage\?\.credits/, "没有读积分");
  assert.doesNotMatch(FEEDBACK_UI, /formatTokenCount/, "还在格式化 token 数");
});

test("积分由后端算好，前端不重算", () => {
  // 系数改过之后重算会让历史账单跟着变。前端只显示落库时的值。
  assert.doesNotMatch(FEEDBACK_UI, /TOKENS_PER_CREDIT/, "前端在自己算积分");
  assert.match(DETAILS_API, /credit_transactions/, "历史消息没取积分");
});


test("details 的关联子查询用外层表名，不是 JS 里的行变量名", () => {
  // 2026-08-26 踩的：子查询写成 `ct.chat_session_detail_id = detail.id`，
  // 而 `detail` 是下面 JS 映射里的行变量、不是 SQL 别名（FROM 子句没起别名）。
  // PostgreSQL 报 missing FROM-clause entry，整个会话详情接口 500。
  //
  // 这类错 tsc 抓不到（SQL 是字符串）、单测也抓不到（不连库），只有真跑才炸。
  const sub = DETAILS_API.slice(DETAILS_API.indexOf("credit_transactions ct"));
  assert.doesNotMatch(
    sub.slice(0, 200),
    /=\s*detail\./,
    "关联子查询引用了 detail.xxx —— 那是 JS 变量名，SQL 里不存在",
  );
  assert.match(sub.slice(0, 200), /chat_session_detail\.id/, "没有用外层表名");
});
