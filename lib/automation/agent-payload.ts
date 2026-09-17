/**
 * 自动化调用数字员工时的请求体构建，以及邮件提示词的拼装。
 *
 * 为什么单独成模块：与 `mail-rules.ts` 同样的理由——`execute.ts` 与调度器都依赖 `@/lib/*`，
 * 而单测用 `node --experimental-strip-types` 跑、解析不了 `@/` 别名。请求体形状是与
 * ragent-service 的契约、提示词里附件怎么说则决定模型读不读得到附件，两者都必须能被
 * 测试直接钉住，所以抽成零依赖纯模块。
 *
 * 同构约束：只允许纯 TypeScript 与纯函数，不要引入 lib/env、pg、node:* 等服务端依赖。
 */

/** 邮件正文进提示词的上限，超出即截断。 */
export const EMAIL_BODY_MAX_CHARS = 20_000;

/** 一个待下发的附件。objectKey 来自 OSS 上传，只在服务端流转。 */
export type AutomationAgentAttachment = {
  objectKey: string;
  filename: string;
  contentType?: string;
  size?: number;
};

/**
 * 构建 `/api/v1/chat/completions` 的请求体。
 *
 * 附件元信息以**结构化字段**下发，字段名与 `lib/qaCore.ts` 的对话链路保持一致——
 * 后端据此在 skill 沙箱起容器前把原始文件取回、写进容器的 `inputs/` 下。
 *
 * **`object_key` 只在这里出现，绝不进 `messages`**：模型按文件名引用 `inputs/` 里已经放好的
 * 文件即可，一旦把 key 写进提示词，模型就等于拿到了对象存储的任意读能力。这条规矩是对话
 * 链路已经定下的，不能因为换了入口就松掉。
 *
 * 没有 objectKey 的附件直接剔除——后端取不回文件，下发它只是让模型误以为文件可用。
 * 剔完为空则整个字段不带，避免发一个空数组让后端多做一次无谓判断。
 */
export function buildAutomationAgentPayload(params: {
  question: string;
  appId: number;
  attachments?: readonly AutomationAgentAttachment[];
}): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    messages: [{ role: "user", content: params.question }],
    app_id: params.appId,
  };

  const withKey = (params.attachments ?? []).filter(
    (attachment) => String(attachment?.objectKey || "").trim().length > 0
  );

  if (withKey.length > 0) {
    payload.attachments = withKey.map((attachment) => ({
      object_key: attachment.objectKey,
      filename: attachment.filename,
      content_type: attachment.contentType,
      size: attachment.size,
    }));
  }

  return payload;
}

/**
 * 正文的规范化：去两端空白 → 超长截断 → 空内容给一句可读的占位。
 *
 * 抽出来是为了让调度器（写 `triggerContext`）与提示词拼装共用同一份口径。两处各写一遍
 * 截断阈值，改一处漏一处时，人看到的正文与模型看到的正文就会不一致——而那个不一致极难发现。
 */
export function normalizeEmailBody(value: unknown): string {
  const raw = typeof value === "string" ? value.trim() : "";

  if (raw.length > EMAIL_BODY_MAX_CHARS) {
    return `${raw.slice(0, EMAIL_BODY_MAX_CHARS)}\n\n[正文较长，已截取前 ${EMAIL_BODY_MAX_CHARS} 个字符]`;
  }

  return raw || "（无正文）";
}

/**
 * 拼邮件触发的提示词：任务说明 + 本次邮件的结构化描述 + 正文。
 *
 * 附件的说法是这一段的关键。文件由后端按 `attachments` 结构化字段取回、写进 skill 沙箱的
 * `inputs/`，所以这里**只说文件名**——object_key 不进提示词（见上）。
 *
 * 没传成的附件必须**点名**：模型看不到「本该有几个」，若只报传成功的，它会默认收到的就是
 * 全部，进而对缺数据给出错误的解释（"成绩单里没有分数"）。实测踩过这个坑。
 */
export function buildEmailAutomationQuestion(params: {
  task: string;
  mailboxLabel: string;
  from?: string;
  to?: string;
  subject?: string;
  date?: string;
  body?: string;
  /** 已放入 inputs/ 的附件名。 */
  delivered?: readonly string[];
  /** 因超限或上传失败没传成的附件名。 */
  skipped?: readonly string[];
}): string {
  const body = normalizeEmailBody(params.body);

  const delivered = params.delivered ?? [];
  const skipped = params.skipped ?? [];

  const attachmentLines =
    delivered.length > 0
      ? [
          "附件（已放入工作目录 inputs/，请按文件名引用）：",
          ...delivered.map((name) => `- ${name}`),
        ]
      : ["附件：无"];

  const skippedLines =
    skipped.length > 0
      ? [
          "以下附件未传入（超过大小上限或上传失败），其中若有任务需要的数据，请说明缺少它：",
          ...skipped.map((name) => `- ${name}`),
        ]
      : [];

  return [
    "【自动化任务】",
    String(params.task || ""),
    "",
    "【本次收到的新邮件】",
    `监听邮箱：${params.mailboxLabel}`,
    `发件人：${params.from || "未知"}`,
    `收件人：${params.to || "未知"}`,
    `主题：${params.subject || "无主题"}`,
    `时间：${params.date || "未知"}`,
    ...attachmentLines,
    ...skippedLines,
    "正文：",
    body,
    "",
    "【执行要求】",
    "请根据上面的真实邮件内容完成自动化任务。",
    "只输出本次邮件的处理结果，不要自行回复邮件，除非用户指明要回复邮件。",
  ].join("\n");
}
