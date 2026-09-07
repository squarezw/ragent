import { requireAuth } from "@/lib/auth";
import { logError } from "@/lib/logError";
import type { NextApiRequest, NextApiResponse } from "next";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (!requireAuth(req, res)) return;

  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  const { title, body, to, is_html = false, attachments } = req.body || {};

  if (!title || typeof title !== "string") {
    return res.status(400).json({ error: "Missing title" });
  }

  if (!body || typeof body !== "string") {
    return res.status(400).json({ error: "Missing body" });
  }

  if (!to || (typeof to !== "string" && !Array.isArray(to))) {
    return res.status(400).json({ error: "Missing to" });
  }

  try {
    const backendBaseUrl =
      process.env.EXTERNAL_API_BASE_URL || "http://localhost:8010";

    const authorization = req.headers.authorization;

    const safeAttachments = Array.isArray(attachments)
      ? attachments
          .filter((item: any) => item && typeof item.object_key === "string" && item.object_key.trim())
          .slice(0, 10)
      : [];
    const endpoint = safeAttachments.length > 0 ? "/api/v1/email/send-attachments" : "/api/v1/email/send";

    const response = await fetch(`${backendBaseUrl}${endpoint}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(authorization ? { Authorization: authorization } : {}),
      },
      body: JSON.stringify({
        title,
        body,
        to,
        is_html,
        ...(safeAttachments.length > 0 ? { attachments: safeAttachments } : {}),
      }),
    });

    const raw = await response.text();

    let data: any = null;
    try {
      data = raw ? JSON.parse(raw) : null;
    } catch {
      data = raw;
    }

    if (!response.ok) {
      return res.status(response.status).json({
        error: "Email sending failed",
        detail:
          typeof data === "object" && data?.detail
            ? data.detail
            : typeof data === "string"
              ? data
              : `Backend returned ${response.status}`,
      });
    }

    return res.status(200).json(data ?? { success: true });
  } catch (error: any) {
    console.error("[Automation Send Email API] Error:", error);
    logError(error);

    return res.status(500).json({
      error: "Email sending failed",
      detail:
        process.env.NODE_ENV === "development"
          ? error?.message || "Unknown error"
          : undefined,
    });
  }
}
