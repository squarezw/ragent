export const PRESENTATION_MODE_LABEL_KEY: Readonly<Record<string, string>> = {
  Chat: "chatType",
  Custom: "customType",
};

export function presentationModeLabel(appType: string, t: (key: never) => string): string {
  const key = PRESENTATION_MODE_LABEL_KEY[appType];
  return key ? t(key as never) : "";
}
