import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { resolveAutoSelectDatasets } from "../lib/appDatasets.ts";

test("绑了知识库时一定不是自动选择", () => {
  assert.equal(resolveAutoSelectDatasets({ auto_select_datasets: true }, ["ds-1"]), false);
  assert.equal(resolveAutoSelectDatasets(undefined, ["ds-1"]), false);
});

test("未绑知识库时以 settings 里存下的开关为准", () => {
  assert.equal(resolveAutoSelectDatasets({ auto_select_datasets: false }, []), false);
  assert.equal(resolveAutoSelectDatasets({ auto_select_datasets: true }, []), true);
  assert.equal(resolveAutoSelectDatasets({ auto_select_datasets: false }, undefined), false);
});

test("存量应用没存过开关时，空 dataset_ids 仍视为自动选择", () => {
  assert.equal(resolveAutoSelectDatasets({}, []), true);
  assert.equal(resolveAutoSelectDatasets(undefined, []), true);
  assert.equal(resolveAutoSelectDatasets(null, null), true);
});

test("应用编辑页保存并回填自动选择知识库开关", () => {
  const src = readFileSync(new URL("../app/apps/page.tsx", import.meta.url), "utf8");
  assert.match(src, /resolveAutoSelectDatasets/);
  assert.match(src, /auto_select_datasets:\s*autoSelectDatasets/);
  assert.doesNotMatch(
    src,
    /setAutoSelectDatasets\(datasetIds\.length === 0\)/,
    "不能再用空 dataset_ids 推断开关，否则取消勾选记不住"
  );
});
