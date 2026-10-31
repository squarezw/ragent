import assert from "node:assert/strict";
import test from "node:test";
const { workspacePreviewSource } = await import(new URL("../lib/workspacePreviewSource.ts", import.meta.url).href);
const origins = ["http://127.0.0.1:3000"];
test("Office preview recognizes only same-app resource endpoints and preserves resource selection", () => {
  for (const path of [
    "/api/v1/skills/17/asset-content?path=docs%2Fdemo.xlsx&stage=published",
    "/api/v1/process-management/process-documents/doc_123-abc/file",
    "/api/oss/skill-artifacts/demo.docx",
    "/api/uploads/demo.docx?file_id=17",
  ]) {
    assert.equal(workspacePreviewSource(path, origins), path);
    assert.equal(workspacePreviewSource(origins[0] + path, origins), path);
  }
});
test("preview cannot forward an actor credential to arbitrary hosts or API routes", () => {
  for (const path of [
    "https://evil.example/api/v1/skills/17/asset-content?path=x",
    "//evil.example/api/oss/x.docx", "/api/user/list", "/api/v1/skills/17",
    "/api/v1/skills/17/asset-content", "/api/uploads/demo.docx",
    "http://user:password@127.0.0.1:3000/api/oss/x.docx",
    "/api/oss/../user/list", "/api/oss/x.docx#fragment",
  ]) assert.equal(workspacePreviewSource(path, origins), null, path);
});
test("preview capability uses its fixed tenant rather than caller-supplied URL selectors", () => {
  assert.equal(workspacePreviewSource("/api/v1/skills/17/asset-content?path=a.docx&workspace_tenant_id=99&stage=published", origins), "/api/v1/skills/17/asset-content?path=a.docx&stage=published");
});
