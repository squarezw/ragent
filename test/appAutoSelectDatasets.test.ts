import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

test("knowledge binding controls moved out of the employee edit dialog", () => {
  const src = readFileSync(new URL("../app/apps/page.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(src, /id="auto-select-datasets"|resolveAutoSelectDatasets/);
  const detail = readFileSync(new URL("../app/apps/[id]/page.tsx", import.meta.url), "utf8");
  assert.match(detail, /canEditThisApp && <AppKnowledgeBindingsEditor/);
  assert.match(detail, /handleCleanupDatasets/);
});

test("Custom managers retain access to the knowledge editor with no existing bindings", () => {
  const detail = readFileSync(new URL("../app/apps/[id]/page.tsx", import.meta.url), "utf8");
  assert.match(detail, /appInfo\.app_type === "Custom" && \(canEditThisApp \|\| !!appInfo\.dataset_bindings\?\.length\) && knowledgeBindingsCard/);
});
