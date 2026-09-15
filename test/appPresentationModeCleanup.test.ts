import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("App 页面与代理不再接入 App 专属订阅链路", () => {
  for (const path of ["app/apps/page.tsx", "pages/api/v1/apps/[id].ts"]) {
    assert.doesNotMatch(read(path), /subscription-agent|subscription-scheduler/);
  }
});

test("cron 仅保留自动化调度器", () => {
  const cronIndex = read("lib/cron/index.ts");
  assert.match(cronIndex, /initAutomationScheduler/);
  assert.doesNotMatch(cronIndex, /subscription-scheduler|initScheduler|scheduleApp|unscheduleApp/);
});

test("自动化定时和邮件能力仍然存在", () => {
  assert.match(read("lib/cron/automation-scheduler.ts"), /initAutomationScheduler/);
  assert.match(read("lib/automation/store.ts"), /email/);
});
