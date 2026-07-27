import assert from "node:assert/strict";
import { test } from "node:test";
import { appSkillDiagnosticsKey, isAppSkillDiagnosticsKey } from "../lib/skillDiagnosticsCache.ts";

test("appSkillDiagnosticsKey matches the URL the diagnostics hook fetches", () => {
  assert.equal(appSkillDiagnosticsKey(1), "/api/v1/apps/1/skills/diagnostics");
  assert.equal(appSkillDiagnosticsKey(42), "/api/v1/apps/42/skills/diagnostics");
});

test("isAppSkillDiagnosticsKey accepts every app's diagnostics key", () => {
  assert.equal(isAppSkillDiagnosticsKey(appSkillDiagnosticsKey(1)), true);
  assert.equal(isAppSkillDiagnosticsKey(appSkillDiagnosticsKey(987)), true);
});

test("isAppSkillDiagnosticsKey rejects neighbouring keys so requires saves stay scoped", () => {
  for (const key of [
    "/api/v1/apps/1/skills",
    "/api/v1/apps/1/skills/diagnostics/extra",
    "/api/v1/apps/abc/skills/diagnostics",
    "/api/v1/apps/1/tools",
    "/api/v1/skills/1",
    "",
  ]) {
    assert.equal(isAppSkillDiagnosticsKey(key), false, key);
  }
});

test("isAppSkillDiagnosticsKey tolerates the non-string keys SWR passes to a filter", () => {
  for (const key of [null, undefined, 0, ["/api/v1/apps/1/skills/diagnostics"], {}]) {
    assert.equal(isAppSkillDiagnosticsKey(key), false);
  }
});
