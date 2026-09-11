/**
 * 向导内联邮箱配置的表单状态与请求体（模块 B）。
 *
 * 本模块是零依赖纯函数模块：会被打进客户端 bundle，也被 node:test 直接 import
 * 来验证"未提供的密码不得退化成空串"这类约束，因此不允许引入 React、axios、
 * lib/env 等依赖。选中的邮箱标识与展示名在 `mailbox-id.ts`，不在本模块。
 */

/** 内联新建邮箱表单的可编辑字段：全部按字符串保存，提交时再规整。 */
export type MailboxFormState = {
  name: string;
  email: string;
  username: string;
  password: string;
  imapHost: string;
  imapPort: string;
  folder: string;
};

/** 表单初值：端口与文件夹用服务端默认值，其余留空由用户填写。 */
export const EMPTY_MAILBOX_FORM: MailboxFormState = {
  name: "",
  email: "",
  username: "",
  password: "",
  imapHost: "",
  imapPort: "993",
  folder: "INBOX",
};

/** 表单必填项的问题代码；调用方负责翻译成文案（与接口错误码一一对应）。 */
export type MailboxFormIssue = "email" | "username" | "password" | "imapHost" | "imapPort";

/**
 * 与邮箱接口 `normalizeMailboxConfig` 同一套校验规则：先在前端拦下，避免无谓的连接尝试。
 *
 * `passwordOptional`：编辑已有邮箱时密码留空表示"不修改"，因此不再是必填项。
 * 默认（新建）仍然必填，与服务端的 MAILBOX_PASSWORD_REQUIRED 一致。
 */
export function firstMailboxFormIssue(
  form: MailboxFormState,
  options: { passwordOptional?: boolean } = {}
): MailboxFormIssue | null {
  if (!/^\S+@\S+\.\S+$/.test(String(form?.email ?? "").trim())) return "email";
  if (!String(form?.username ?? "").trim()) return "username";
  if (!options.passwordOptional && !String(form?.password ?? "")) return "password";
  if (!String(form?.imapHost ?? "").trim()) return "imapHost";

  const imapPort = Number(form?.imapPort ?? "");
  if (!Number.isInteger(imapPort) || imapPort <= 0 || imapPort > 65535) return "imapPort";

  return null;
}

/** 新建邮箱的请求体。 */
export type MailboxCreatePayload = {
  name: string;
  email: string;
  username: string;
  imapHost: string;
  imapPort: number;
  folder: string;
  password?: string;
};

/**
 * 组装新建邮箱请求体（模块 B 陷阱 1）。
 *
 * 密码为空表示"未提供"：此时**不下发该字段**，而不是下发空串。创建路径下空密码会被
 * 服务端直接拒绝（MAILBOX_PASSWORD_REQUIRED），而下发空串还会让"没填"和"填了个空"
 * 变成同一件事。向导只新建、不更新，因此这里恒定走"未提供即省略"的语义。
 */
export function mailboxCreatePayload(form: MailboxFormState): MailboxCreatePayload {
  const payload: MailboxCreatePayload = {
    name: String(form?.name ?? "").trim(),
    email: String(form?.email ?? "").trim(),
    username: String(form?.username ?? "").trim(),
    imapHost: String(form?.imapHost ?? "").trim(),
    imapPort: Number(form?.imapPort) || 993,
    folder: String(form?.folder ?? "").trim() || "INBOX",
  };

  const password = String(form?.password ?? "");
  if (password) payload.password = password;

  return payload;
}

/** 编辑已有邮箱的请求体（模块 C 的 PUT）：字段与新建相同，密码语义不同。 */
export type MailboxUpdatePayload = MailboxCreatePayload & { password: string };

/**
 * 组装编辑邮箱请求体。
 *
 * 与 `mailboxCreatePayload` 的唯一差别：password **总是下发**，留空时是空串。
 * 服务端对空串的规则是"保留原凭据"（`resolveMailboxUpdate`），所以走这条路径时
 * 生产环境每次都在考验"空串不得覆盖密码"这条规则本身——它一旦退化，这里立刻失败，
 * 而不是因为省略了字段而被悄悄绕过。
 *
 * 已存密码永远不会回传前端，因此表单里的密码框始终是空的，不存在"看起来像原密码"的假值。
 */
export function mailboxUpdatePayload(form: MailboxFormState): MailboxUpdatePayload {
  return { ...mailboxCreatePayload(form), password: String(form?.password ?? "") };
}
