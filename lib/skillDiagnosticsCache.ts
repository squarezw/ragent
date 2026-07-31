/** 「Skill 生效状态」诊断结果的 SWR key —— 写侧要精确失效，别各处手拼字符串 */
export function appSkillDiagnosticsKey(appId: number): string {
  return `/api/v1/apps/${appId}/skills/diagnostics`;
}

const DIAGNOSTICS_KEY_PATTERN = /^\/api\/v1\/apps\/\d+\/skills\/diagnostics$/;

/**
 * skills.requires 是不分草稿/发布的单列，改一次就影响所有绑定该 skill 的应用，
 * 前端拿不到"哪些应用绑了它"，所以按 key 形状全量失效。
 */
export function isAppSkillDiagnosticsKey(key: unknown): boolean {
  return typeof key === "string" && DIAGNOSTICS_KEY_PATTERN.test(key);
}
