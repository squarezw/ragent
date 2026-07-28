/**
 * 新建 Skill 的正文脚手架。
 *
 * 只给结构不给解释：正文会**逐字注入** system prompt，脚手架里写的每个字都会
 * 占模型的上下文预算，所以各小节该写什么放在编辑器的帮助文案里（不注入），
 * 不放进正文。
 *
 * 小节取舍：
 * - **不设「When to use」**：触发条件由 description 字段承担（它的引导写法就是
 *   "Use when ..."，且注入时作为 skill 的一行摘要），正文再写一遍是重复。
 *   「不适用」的反面清单也归 description——本仓两次事故都源于触发边界没写清
 *   （长任务 GUIDANCE 关键词冲突、fund skill 与 Adobe 印前混淆），而做判断的
 *   正是 description。
 * - `References` 只能写**内联**的口径/术语；平台没有渐进披露能力，模型读不到
 *   skill 资产里的文件（见 SuperAgent/plans/2026-07-27-digital-employee-architecture.md §十一），
 *   所以这里列文件路径等于写给空气。帮助文案里点明了这一点。
 * - 可执行 skill 另需「执行原则」（显式指令=执行授权、展示≠写入、交付前自检），
 *   那是 execute_skill 场景专属，不进通用脚手架。
 */
export const SKILL_BODY_SCAFFOLD = `## Workflow

1. ...

## References

...

## Guardrails

- ...
`;

/** 用户是否一个字都没动过脚手架（用于判断"正文实际为空"）。 */
export function isUntouchedScaffold(content: string): boolean {
  return content.trim() === SKILL_BODY_SCAFFOLD.trim();
}

/** 正文里是否还留着未填的 `...` 占位（这些会原样注入 system prompt）。 */
export function hasUnfilledPlaceholders(content: string): boolean {
  return content
    .split("\n")
    .some((line) => line.trim() === "..." || line.trim() === "1. ..." || line.trim() === "- ...");
}
