// Agent.md 保存响应的纯函数解析（PUT /apps/{id}/agent-md）

export interface AgentMdSaveResult {
  /** 后端的非阻断提示，例如 frontmatter 的 model 被剥离 */
  warnings: string[];
  /** 入库后的归一化全文；后端没回传字符串时为 null，调用方应保留编辑器现有内容 */
  normalizedContent: string | null;
}

export function parseAgentMdSaveResult(data: unknown): AgentMdSaveResult {
  const root = data && typeof data === "object" ? (data as Record<string, unknown>) : null;
  const warningsField = root ? root.warnings : undefined;
  const rawWarnings: unknown[] = Array.isArray(warningsField) ? warningsField : [];
  return {
    warnings: rawWarnings
      .map((w) => (typeof w === "string" ? w.trim() : ""))
      .filter((w) => w.length > 0),
    normalizedContent: root && typeof root.content === "string" ? root.content : null,
  };
}
