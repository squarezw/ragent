import type { NextApiRequest, NextApiResponse } from "next";
import jwt from "jsonwebtoken";
import { getUserIdFromRequest } from "@/lib/auth";
import { getDraftUpdatedAtForLatest } from "@/lib/documentFileVersions";
import { parseOnlyOfficeKey } from "@/lib/onlyofficeKey";
import { requireEnv } from "@/lib/env";

const ONLYOFFICE_SECRET = requireEnv("ONLYOFFICE_JWT_SECRET");
const ONLYOFFICE_URL =
  process.env.ONLYOFFICE_INTERNAL_URL || process.env.ONLYOFFICE_URL || "http://localhost:8443";

const DRAFT_CONFIRM_TIMEOUT_MS = 30_000;
const DRAFT_CONFIRM_POLL_MS = 200;

/** 轮询 document_drafts.updated_at（最新版 slot），直到 OnlyOffice callback 把新的 draft 落盘。 */
async function waitForDraftCommitted(documentId: string, before: Date | null): Promise<boolean> {
  const deadline = Date.now() + DRAFT_CONFIRM_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const current = await getDraftUpdatedAtForLatest(documentId);
    if (current && (!before || current.getTime() > before.getTime())) {
      return true;
    }
    await new Promise((r) => setTimeout(r, DRAFT_CONFIRM_POLL_MS));
  }
  return false;
}

/**
 * POST /api/internal/onlyoffice/force-save
 * Body: { key: string }
 *
 * Triggers a force-save via OnlyOffice Command Service, then (for doc keys)
 * waits until the async callback has persisted the draft to `document_drafts`
 * before returning success. This guarantees the caller that HTTP 200 means
 * the draft is durable.
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const userId = getUserIdFromRequest(req);
  if (!userId) return res.status(401).json({ detail: "Unauthorized" });

  if (req.method !== "POST") {
    return res.status(405).json({ detail: "Method not allowed" });
  }

  const { key } = req.body;
  if (!key || typeof key !== "string") {
    return res.status(400).json({ detail: "Missing document key" });
  }

  // Session keys upload to the handbook backend (no document_drafts row),
  // so the barrier only applies to doc keys.
  const { type: keyType, id: docId } = parseOnlyOfficeKey(key);
  const shouldConfirmDraft = keyType === "doc" && !!docId;
  const beforeUpdatedAt = shouldConfirmDraft ? await getDraftUpdatedAtForLatest(docId) : null;

  const payload = { c: "forcesave", key };
  const token = jwt.sign(payload, ONLYOFFICE_SECRET, { algorithm: "HS256" });

  const commandUrl = `${ONLYOFFICE_URL}/coauthoring/CommandService.ashx`;

  const resp = await fetch(commandUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...payload, token }),
  });

  const data = await resp.json();

  // error 0 = success, 4 = no changes to save (not a real error)
  if (data.error === 4) {
    return res.status(200).json({ success: true });
  }

  if (data.error !== 0) {
    console.error("OnlyOffice force-save command failed:", data);
    return res.status(502).json({ detail: "Force save failed", code: data.error });
  }

  if (shouldConfirmDraft) {
    const committed = await waitForDraftCommitted(docId, beforeUpdatedAt);
    if (!committed) {
      console.error(
        `force-save: draft commit timeout for doc=${docId} key=${key} (callback unreachable or failed)`
      );
      return res.status(504).json({
        detail: "保存未在规定时间内完成，OnlyOffice 回调可能无法到达服务端，请检查 callback 日志",
      });
    }
  }

  return res.status(200).json({ success: true });
}
