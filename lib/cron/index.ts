import { initAutomationScheduler } from "./automation-scheduler";

// Only run on server-side when ENABLE_CRON is true
if (typeof window === "undefined" && process.env.ENABLE_CRON === "true") {
  initAutomationScheduler().catch(console.error);
}

export { initAutomationScheduler } from "./automation-scheduler";
