import { getUserIdFromRequest } from "@/lib/auth";
import {
  listAutomationNotifications,
  markAutomationNotificationsRead,
} from "@/lib/automation/store";
import type { NextApiRequest, NextApiResponse } from "next";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    const userId = getUserIdFromRequest(req);
    if (!userId) return res.status(401).json({ error: "Unauthorized" });

    if (req.method === "GET") {
      const result = await listAutomationNotifications(userId);
      return res.status(200).json(result);
    }

    if (req.method === "POST") {
      const rawKeys = Array.isArray(req.body?.eventKeys) ? req.body.eventKeys : [];
      const eventKeys = rawKeys.map((value: unknown) => String(value || "").trim()).filter(Boolean);
      if (eventKeys.length === 0) {
        return res.status(400).json({ error: "Missing eventKeys" });
      }

      await markAutomationNotificationsRead(userId, eventKeys);
      const result = await listAutomationNotifications(userId);
      return res.status(200).json(result);
    }

    res.setHeader("Allow", "GET, POST");
    return res.status(405).json({ error: "Method Not Allowed" });
  } catch (error: any) {
    console.error("[Automation Notifications API] Error:", error);
    return res.status(500).json({
      error: "Automation notifications failed",
      detail:
        process.env.NODE_ENV === "development"
          ? error?.message || "Unknown error"
          : undefined,
    });
  }
}
