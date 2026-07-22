export async function register() {
  // Only initialize cron scheduler on Node.js runtime (not Edge)
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("./lib/cron");
  }
}
