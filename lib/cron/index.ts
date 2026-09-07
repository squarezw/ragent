import { initScheduler } from "./subscription-scheduler";
import { initAutomationScheduler } from "./automation-scheduler";

// Only run on server-side when ENABLE_CRON is true
if (typeof window === "undefined" && process.env.ENABLE_CRON === "true") {
  Promise.all([
    initScheduler(),
    initAutomationScheduler(),
  ]).catch(console.error);
}

export {
  initScheduler,
  scheduleApp,
  unscheduleApp,
  syncAppSchedule,
} from "./subscription-scheduler";

export { initAutomationScheduler } from "./automation-scheduler";
