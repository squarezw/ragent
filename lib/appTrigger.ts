/**
 * 触发方式（列名沿用 app_type）的显示名。
 *
 * **不要直接渲染 app_type 的原始值**：底层存的 `Subscription` 在界面上叫「定时任务」，
 * 两者故意不一致——前端 isStreamApp 靠这个值决定要不要显示订阅源管理，换成新值就得
 * 迁移存量数据并改 8 处调用，而收益只是名字好看。
 *
 * 放在 lib 而不是某个页面里：列表页和详情页都要用，两处各写一份迟早分叉（详情页
 * 一度就还在显示原始的 "Chat"）。
 *
 * Tool / Plugin 不再是可选项，但存量数据里可能还有，仍给出各自的旧文案，
 * 不至于显示成空白。
 */
export const TRIGGER_LABEL_KEY: Readonly<Record<string, string>> = {
  Chat: "chatType",
  Subscription: "subscriptionType",
  Email: "emailType",
  Custom: "customType",
  Tool: "toolType",
  Plugin: "pluginType",
};

/** 认不出的值原样显示——比显示空白强，也让"哪儿冒出个新值"看得见 */
export function triggerLabel(appType: string, t: (key: never) => string): string {
  const key = TRIGGER_LABEL_KEY[appType];
  return key ? t(key as never) : appType;
}
