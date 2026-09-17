/**
 * `POST /api/v1/email/unread-config`：读一个监听邮箱里「游标之后」的邮件。
 *
 * 薄路由：真正的实现在 `lib/automation/imap-client.ts`，调度器与「保存前试连」
 * 都是直接调用那个函数、不走 HTTP（每 10 秒一次的轮询没必要自我回调一次）。
 *
 * 入参用 `mailboxId` 而不是原始连接信息：服务端按 `getAutomationMailboxForUser` 查库取
 * 凭据（归属已校验），否则任何登录用户都能让服务器拿任意主机 + 凭据发起 IMAP 连接。
 *
 * ```
 * 请求  { mailboxId: number, afterUid?: number }   // 游标未初始化时不传 afterUid
 * 响应  { success: true, latest_uid: number, messages: [...8 个字段] }
 * ```
 */
import type { NextApiRequest, NextApiResponse } from "next";
import { getUserIdFromRequest } from "@/lib/auth";
import { fetchMailboxUnread } from "@/lib/automation/imap-client";
import { respondMailboxApiError } from "@/lib/automation/mailbox-errors";
import { getAutomationMailboxForUser, mailboxConnectionFromRow } from "@/lib/automation/mailboxes";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const userId = getUserIdFromRequest(req);
  if (!userId) return res.status(401).json({ detail: "Unauthorized" });

  if (req.method !== "POST") {
    res.setHeader("Allow", ["POST"]);
    return res.status(405).json({ detail: "Method Not Allowed" });
  }

  const mailboxId = Number(req.body?.mailboxId);
  if (!Number.isInteger(mailboxId) || mailboxId <= 0) {
    return res.status(400).json({ detail: "缺少 mailboxId" });
  }

  try {
    const mailbox = await getAutomationMailboxForUser(userId, mailboxId);
    if (!mailbox) return res.status(404).json({ detail: "邮箱不存在" });

    const data = await fetchMailboxUnread({
      // 非整数（含缺省）一律当作「游标尚未建立」：此时只回报 latest_uid，不取信。
      afterUid: Number.isInteger(req.body?.afterUid) ? Number(req.body.afterUid) : undefined,
      connection: mailboxConnectionFromRow(mailbox),
    });

    return res.status(200).json(data);
  } catch (error) {
    // 连接类失败（主机、授权码、证书）沿用原文映射成 400，其余按错误码处理。
    return respondMailboxApiError(res, error);
  }
}
