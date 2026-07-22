import type { NextApiRequest, NextApiResponse } from "next";
import fs from "fs";
import path from "path";
import { requireAuth } from "@/lib/auth";

export default function handler(req: NextApiRequest, res: NextApiResponse) {
  if (!requireAuth(req, res)) return;
  const logPath = path.join(process.cwd(), "logs", "error.log");
  if (!fs.existsSync(logPath)) {
    res.status(200).json({ lines: [] });
    return;
  }
  const content = fs.readFileSync(logPath, "utf-8");
  // 只取最新的 100 行
  const lines = content.trim().split("\n").slice(-100);
  res.status(200).json({ lines });
}
