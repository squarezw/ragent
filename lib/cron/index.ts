import { initScheduler } from "./subscription-scheduler";

// Only run on server-side when ENABLE_CRON is true
if (typeof window === "undefined" && process.env.ENABLE_CRON === "true") {
  initScheduler().catch(console.error);
}

export {
  initScheduler,
  scheduleApp,
  unscheduleApp,
  syncAppSchedule,
} from "./subscription-scheduler";
