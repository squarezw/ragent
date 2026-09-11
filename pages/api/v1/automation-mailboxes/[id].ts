import type { NextApiRequest, NextApiResponse } from "next";
import { getUserIdFromRequest } from "@/lib/auth";
import { respondMailboxApiError } from "@/lib/automation/mailbox-errors";
import {
  deleteAutomationMailbox,
  mailboxRowToApi,
  updateAutomationMailbox,
  type AutomationMailboxUpdateInput,
} from "@/lib/automation/mailboxes";

function parseId(value: string | string[] | undefined) {
  const raw = Array.isArray(value) ? value[0] : value;
  const id = Number(raw);
  return Number.isInteger(id) && id > 0 ? id : null;
}

/**
 * 只收下请求里**真正出现过**的字段。
 *
 * 与 POST 的差别就在这里：创建时缺失字段各有默认值，编辑时缺失字段表示"保留原值"。
 * 密码尤其如此——未提供与空串在服务端都表示不修改既有凭据，但一个把字段补齐成空串的
 * 中间层会让"未提供"这条信息彻底消失，所以这里不做任何补齐（见 mailbox-input.ts）。
 */
function parseUpdateInput(body: unknown): AutomationMailboxUpdateInput {
  const source: Record<string, unknown> =
    body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  const input: AutomationMailboxUpdateInput = {};

  const text = (key: string) => {
    const value = source[key];
    return typeof value === "string" ? value : undefined;
  };

  const name = text("name");
  if (name !== undefined) input.name = name;
  const email = text("email");
  if (email !== undefined) input.email = email;
  const username = text("username");
  if (username !== undefined) input.username = username;
  const password = text("password");
  if (password !== undefined) input.password = password;
  const imapHost = text("imapHost");
  if (imapHost !== undefined) input.imapHost = imapHost;
  const folder = text("folder");
  if (folder !== undefined) input.folder = folder;

  const imapPort = source.imapPort;
  if (imapPort !== undefined && imapPort !== null && imapPort !== "") {
    input.imapPort = Number(imapPort);
  }
  if (typeof source.imapSecure === "boolean") input.imapSecure = source.imapSecure;

  return input;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const userId = getUserIdFromRequest(req);
  if (!userId) return res.status(401).json({ detail: "Unauthorized" });
  const mailboxId = parseId(req.query.id);
  if (!mailboxId) return res.status(400).json({ detail: "Invalid mailbox id" });

  if (req.method === "PUT") {
    try {
      const row = await updateAutomationMailbox(userId, mailboxId, parseUpdateInput(req.body), {
        authorization: req.headers.authorization,
      });
      if (!row) return res.status(404).json({ detail: "邮箱不存在" });
      return res.status(200).json(mailboxRowToApi(row));
    } catch (error) {
      return respondMailboxApiError(res, error);
    }
  }

  if (req.method === "DELETE") {
    try {
      const result = await deleteAutomationMailbox(userId, mailboxId);
      if (!result.deleted && result.dependents.length > 0) {
        return res.status(409).json({
          detail: `该邮箱仍被 ${result.dependents.length} 个自动化使用，请先修改这些自动化的监听邮箱`,
          dependents: result.dependents,
        });
      }
      if (!result.deleted) return res.status(404).json({ detail: "邮箱不存在" });
      return res.status(200).json({ deleted: true });
    } catch (error) {
      console.error("[Automation Mailbox Delete API] error:", error);
      return res.status(500).json({ detail: "删除邮箱失败" });
    }
  }

  res.setHeader("Allow", ["PUT", "DELETE"]);
  return res.status(405).json({ detail: "Method Not Allowed" });
}
