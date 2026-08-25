/**
 * 一轮对话的 token 用量。
 *
 * 目标（2026-08-25）：数字员工费用 = Skills 费用 + 主会话 Token 消耗 + 其它费用。
 * 第一阶段只显示 token 量，不折算成钱。
 *
 * **这个对象缺席 ≠ 消耗为 0。** 后端在拿不到用量时写 NULL 而不是 0：存量对话、
 * provider 没回 usage，都属于「没记录」。界面必须靠"有没有这个对象"决定显示与否，
 * 显示成 `0 tokens` 会被读成"这轮免费"。
 */
export interface TurnUsage {
  /** 本轮全部 LLM 调用的输入 token 之和 */
  promptTokens?: number;
  /** 本轮全部 LLM 调用的输出 token 之和 */
  completionTokens?: number;
  /** 通常等于上面两者之和；provider 直接给出时以其为准 */
  totalTokens?: number;
  /**
   * 本轮调了几次模型。
   *
   * 一轮对话不等于一次调用：agent 每个工具轮次都重发完整上下文，input 逐轮累积。
   * 没有这个数，看到一个异常大的输入量无法区分「上下文长」还是「工具轮次多」。
   */
  llmCalls?: number;
  /** 本轮实际使用的模型；单价按模型走，缺了就算不出钱 */
  modelName?: string;
  /**
   * 输入里命中缓存的部分（promptTokens 的子集）。
   *
   * 按约 1/10 计价，所以它决定了这一轮真实花多少钱。工具定义是固定前缀、
   * 恰好是缓存命中的主要对象 —— 一轮 4 万输入里三万多命中缓存是常态，
   * 按全额算会把成本高估近十倍。
   */
  cacheReadTokens?: number;
  /** 写入缓存的 token（Anthropic 系计费更高）；DeepSeek 无此概念 */
  cacheWriteTokens?: number;
  /** true = 用户中途中断，这是当时已知的部分用量，不完整 */
  partial?: boolean;
}

/** SSE finish 事件里的形态与接口返回一致，直接复用 */
export type TurnUsagePayload = TurnUsage;

/**
 * 把后端 SSE 的 snake_case 用量转成前端的 camelCase。
 *
 * 同一份数据有两条路进前端，形态**不同**：
 *   · 实时那轮 —— SSE `finish` 事件，直接来自 Python，是 snake_case
 *   · 历史消息 —— /api/chat/sessions/[id]/details，那一层已经转成 camelCase
 *
 * 2026-08-25 踩的：实时那条没转，读 `usage.totalTokens` 得到 undefined，于是
 * 「共消耗」一直不显示 —— 而库里数据是好好的。TypeScript 抓不到，因为 SSE 那边
 * `parsed` 是 any，snake_case 赋给 TurnUsage 不报错。
 *
 * 两个字段名都收：后端哪天统一了口径也不会退化成不显示。
 */
export function normalizeTurnUsage(raw: unknown): TurnUsage | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const r = raw as Record<string, unknown>;
  const num = (...keys: string[]): number | undefined => {
    for (const k of keys) {
      const v = r[k];
      if (typeof v === "number") return v;
    }
    return undefined;
  };
  const totalTokens = num("totalTokens", "total_tokens");
  // 没有合计就当作"没记录"。别用 0 兜底：0 会被渲染成「共消耗 0」，读起来是免费。
  if (typeof totalTokens !== "number") return undefined;
  const modelName = r.modelName ?? r.model_name;
  return {
    promptTokens: num("promptTokens", "prompt_tokens"),
    completionTokens: num("completionTokens", "completion_tokens"),
    totalTokens,
    llmCalls: num("llmCalls", "llm_calls"),
    cacheReadTokens: num("cacheReadTokens", "cache_read_tokens"),
    cacheWriteTokens: num("cacheWriteTokens", "cache_write_tokens"),
    modelName: typeof modelName === "string" ? modelName : undefined,
    partial: r.partial === true || r.usage_partial === true,
  };
}
