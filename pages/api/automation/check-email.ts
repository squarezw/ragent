import { requireAuth } from "@/lib/auth";
import { logError } from "@/lib/logError";
import type { NextApiRequest, NextApiResponse } from "next";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (!requireAuth(req, res)) return;

  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  const rawAfterUid = req.query.after_uid;
  let afterUid: string | undefined;

  if (typeof rawAfterUid === "string" && rawAfterUid.trim() !== "") {
    const parsed = Number(rawAfterUid);

    if (!Number.isInteger(parsed) || parsed < 0) {
      return res.status(400).json({ error: "Invalid after_uid" });
    }

    afterUid = String(parsed);
  }

  try {
    const backendBaseUrl =
      process.env.EXTERNAL_API_BASE_URL || "http://localhost:8010";

    const authorization = req.headers.authorization;

    const params = new URLSearchParams();
    if (afterUid !== undefined) {
      params.set("after_uid", afterUid);
    }

    const url = `${backendBaseUrl}/api/v1/email/unread${
      params.toString() ? `?${params.toString()}` : ""
    }`;

    const response = await fetch(url, {
      method: "GET",
      headers: {
        ...(authorization ? { Authorization: authorization } : {}),
      },
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
        error: "Email check failed",
        detail:
          typeof data === "object" && data?.detail
            ? data.detail
            : typeof data === "string"
              ? data
              : `Backend returned ${response.status}`,
      });
    }

    return res.status(200).json(
      data ?? {
        success: true,
        latest_uid: 0,
        messages: [],
      },
    );
  } catch (error: any) {
    console.error("[Automation Check Email API] Error:", error);
    logError(error);

    return res.status(500).json({
      error: "Email check failed",
      detail:
        process.env.NODE_ENV === "development"
          ? error?.message || "Unknown error"
          : undefined,
    });
  }
}
