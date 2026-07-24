// Skill 表单纯函数校验（与后端 skills.py 校验规则保持一致）

/** kebab-case：小写字母/数字段，以单个连字符分隔 */
export const SKILL_NAME_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;

export const SKILL_DESCRIPTION_MAX_LENGTH = 1024;

export function isValidSkillName(name: string): boolean {
  return SKILL_NAME_RE.test(name);
}

export function isValidSkillDescription(description: string): boolean {
  const trimmed = description.trim();
  return trimmed.length > 0 && trimmed.length <= SKILL_DESCRIPTION_MAX_LENGTH;
}

/** 逗号分隔输入 → 去重去空的名字数组（requires.tools / requires.workflows 简易编辑） */
export function parseNameList(input: string): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const raw of input.split(/[,，]/)) {
    const name = raw.trim();
    if (name && !seen.has(name)) {
      seen.add(name);
      result.push(name);
    }
  }
  return result;
}

/** 数组 → 逗号分隔字符串（回显） */
export function formatNameList(names: string[] | undefined | null): string {
  return (names || []).join(", ");
}
