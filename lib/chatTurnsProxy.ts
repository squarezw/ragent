import type { NextApiRequest, NextApiResponse } from "next";
import { getUserIdFromRequest } from "@/lib/auth";
import { watchQaDisconnect, closeQaReader } from "@/lib/qaCancellation";
import { chatAttachmentPayload } from "@/lib/sessionAttachments";

export async function proxyChatTurn(
  req: NextApiRequest,
  res: NextApiResponse,
  action: "start" | "current" | "snapshot" | "events" | "stop"
) {
  res.setHeader("Cache-Control", "private, no-store");
  const method = action === "start" || action === "stop" ? "POST" : "GET";
  if (req.method !== method) {
    res.setHeader("Allow", method);
    return res.status(405).end();
  }
  if (!getUserIdFromRequest(req)) return res.status(401).json({ detail: "Unauthorized" });
  const tenant = req.headers["x-workspace-tenant-id"];
  if (typeof tenant !== "string" || !/^[1-9]\d*$/.test(tenant))
    return res.status(409).json({ detail: { code: "WORKSPACE_TENANT_REQUIRED" } });
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "X-Workspace-Tenant-ID": tenant,
  };
  if (typeof req.headers.authorization === "string")
    headers.Authorization = req.headers.authorization;
  else if (typeof req.headers["x-api-key"] === "string")
    headers["X-API-Key"] = req.headers["x-api-key"];
  else return res.status(401).json({ detail: "Unauthorized" });
  const id = req.query.id;
  if (
    !["start", "current"].includes(action) &&
    (typeof id !== "string" || !/^[a-zA-Z0-9_-]{1,100}$/.test(id))
  )
    return res.status(400).json({ detail: "Invalid run" });
  const query = new URLSearchParams();
  if (action === "current" && typeof req.query.session_id === "string")
    query.set("session_id", req.query.session_id);
  if (action === "current" && typeof req.query.client_request_id === "string")
    query.set("client_request_id", req.query.client_request_id);
  if (action === "events") {
    const after = req.query.after ?? req.headers["last-event-id"] ?? "0";
    if (typeof after !== "string" || !/^\d+$/.test(after) || !Number.isSafeInteger(Number(after)))
      return res.status(422).json({ detail: "Invalid cursor" });
    query.set("after", after);
  }
  const suffix =
    action === "start"
      ? ""
      : action === "current"
        ? "/current"
        : `/${encodeURIComponent(String(id))}${action === "snapshot" ? "" : `/${action}`}`;
  let body: string | undefined;
  if (action === "start") {
    const {
      question,
      datasetId,
      attachments,
      client_request_id,
      chat_id,
      app_id,
      enableWebSearch,
    } = req.body ?? {};
    if (typeof question !== "string" || !question.trim())
      return res.status(400).json({ detail: "Missing question" });
    // Preserve the old QA attachment manifest and inline text alongside authorized upload receipts.
    const messages: { role: string; content: string }[] = [];
    if (Array.isArray(attachments) && attachments.length) {
      const files = attachments.filter(
        (item): item is { filename: string; type?: string; content?: string } =>
          Boolean(item && typeof item.filename === "string")
      );
      const lines = files.map(
        (file) =>
          `- ${file.filename}（${file.type || "File"}）${file.content?.trim() ? "" : "：内容尚未读取"}`
      );
      messages.push({
        role: "system",
        content: [
          "用户本轮上传了以下附件：",
          ...lines,
          files.some((file) => !file.content?.trim())
            ? "需要读取文字时调用 extract_document_text(filename=...)；交给 skill 处理时无需先抽取，文件本身已在 inputs/ 下。"
            : "",
        ]
          .filter(Boolean)
          .join("\n"),
      });
      for (const file of files)
        if (typeof file.content === "string" && file.content.trim())
          messages.push({
            role: "system",
            content: `附件《${file.filename}》的内容：\n\n${file.content}`,
          });
    }
    messages.push({ role: "user", content: question });
    body = JSON.stringify({
      client_request_id,
      chat_id,
      app_id,
      enableWebSearch,
      messages,
      ...(datasetId ? { dataset_id: Array.isArray(datasetId) ? datasetId : [datasetId] } : {}),
      ...(Array.isArray(attachments) ? { attachments: chatAttachmentPayload(attachments) } : {}),
    });
  }
  const subscription = action === "events" ? watchQaDisconnect(req, res) : null;
  const controller = new AbortController();
  const timeout = action === "events" ? null : setTimeout(() => controller.abort(), 30000);
  try {
    const upstream = await fetch(
      `${process.env.EXTERNAL_API_BASE_URL || "http://localhost:8010"}/api/v1/chat/turns${suffix}${query.size ? `?${query}` : ""}`,
      {
        method,
        headers,
        body,
        signal: subscription?.signal ?? controller.signal,
      }
    );
    if (!upstream.ok || action !== "events") {
      const data = await upstream.json().catch(() => ({ detail: "Chat service unavailable" }));
      return res.status(upstream.status).json(data);
    }
    if (!upstream.body) return res.status(502).json({ detail: "Missing subscription" });
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("X-Accel-Buffering", "no");
    res.flushHeaders();
    const reader = upstream.body.getReader();
    try {
      while (!subscription?.signal.aborted) {
        const { done, value } = await reader.read();
        if (done) break;
        if (!res.destroyed && !res.writableEnded && subscription)
          await writeChatRunChunk(res, Buffer.from(value), subscription.signal);
      }
    } finally {
      await closeQaReader(reader);
    }
    if (!res.destroyed && !res.writableEnded) res.end();
  } catch {
    if (subscription?.signal.aborted || res.destroyed || res.writableEnded) return;
    if (res.headersSent) res.end();
    else res.status(502).json({ detail: "Chat service unavailable" });
  } finally {
    if (timeout) clearTimeout(timeout);
    subscription?.dispose();
  }
}

/** Bound buffering for slow subscribers; close/abort always releases a drain wait. */
export async function writeChatRunChunk(
  res: Pick<NextApiResponse, "write" | "once" | "off" | "destroyed" | "writableEnded">,
  chunk: Uint8Array,
  signal: AbortSignal
) {
  if (signal.aborted || res.destroyed || res.writableEnded || res.write(chunk)) return;
  await new Promise<void>((resolve) => {
    const finish = () => {
      res.off("drain", finish);
      res.off("close", finish);
      signal.removeEventListener("abort", finish);
      resolve();
    };
    res.once("drain", finish);
    res.once("close", finish);
    signal.addEventListener("abort", finish, { once: true });
    if (signal.aborted || res.destroyed || res.writableEnded) finish();
  });
}
