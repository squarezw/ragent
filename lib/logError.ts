import fs from "fs";
import path from "path";

export function logError(err: any) {
  const logDir = path.join(process.cwd(), "logs");
  if (!fs.existsSync(logDir)) fs.mkdirSync(logDir);
  const errorLog = path.join(logDir, "error.log");
  const msg = `[${new Date().toISOString()}] ${err?.stack || err}\n`;
  fs.appendFileSync(errorLog, msg);
}
