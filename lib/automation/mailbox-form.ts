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

/** 与邮箱接口 `normalizeInput` 同一套校验规则：先在前端拦下，避免无谓的连接尝试。 */
export function firstMailboxFormIssue(form: MailboxFormState): MailboxFormIssue | null {
  if (!/^\S+@\S+\.\S+$/.test(String(form?.email ?? "").trim())) return "email";
  if (!String(form?.username ?? "").trim()) return "username";
  if (!String(form?.password ?? "")) return "password";
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
 * 密码为空表示"未提供"：此时**不下发该字段**，而不是下发空串。服务端对空串会直接
 * 拒绝（MAILBOX_PASSWORD_REQUIRED），而在编辑路径（PUT，模块 C）下"空串"意味着把
 * 凭据覆盖为空、"未提供"意味着保留原凭据——两者必须可区分，否则一次保存就会清掉
 * 共享邮箱的密码。向导只新建、不更新，因此这里恒定走"未提供即省略"的语义。
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
