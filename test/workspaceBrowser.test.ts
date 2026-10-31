import assert from "node:assert/strict";
import test, { before } from "node:test";
let beginWorkspaceRequest: any, getWorkspaceSnapshot: any, setWorkspaceOperation: any,
  workspaceBusy: any, workspaceRequestHeaders: any, workspaceUrl: any, workspaceStorageKey: any;
before(async () => {
  ({ beginWorkspaceRequest, getWorkspaceSnapshot, setWorkspaceOperation, workspaceBusy,
    workspaceRequestHeaders, workspaceUrl, workspaceStorageKey } = await import(new URL("../lib/workspaceBrowser.ts", import.meta.url).href));
});

test("operation tenant is separate from actor and changes cancel stale requests", () => {
  setWorkspaceOperation(true, 12, 100);
  const old = beginWorkspaceRequest();
  assert.equal(old.headers["X-Workspace-Tenant-ID"], "100");
  setWorkspaceOperation(true, 12, 200);
  assert.equal(old.signal.aborted, true);
  assert.equal(old.isCurrent(), false);
  assert.equal(getWorkspaceSnapshot().actorId, 12);
  assert.equal(workspaceRequestHeaders()["X-Workspace-Tenant-ID"], "200");
  old.finish();
});

test("concurrent writes keep switching blocked until all finish; finish is idempotent", () => {
  const a = beginWorkspaceRequest(true);
  const b = beginWorkspaceRequest(true);
  assert.equal(workspaceBusy(), true);
  b.finish(); b.finish();
  assert.equal(workspaceBusy(), true);
  a.finish();
  assert.equal(workspaceBusy(), false);
});

test("download context is per tab and leaves external signed URLs unchanged", () => {
  setWorkspaceOperation(true, 12, 300);
  assert.equal(workspaceUrl("/api/oss/file.pdf?inline=1"), "/api/oss/file.pdf?inline=1&workspace_tenant_id=300");
  const signed = "https://storage.example/file?signature=original";
  assert.equal(workspaceUrl(signed), signed);
  setWorkspaceOperation(false, 12, null);
  assert.equal(workspaceUrl("/api/oss/file.pdf"), "/api/oss/file.pdf");
  assert.deepEqual(workspaceRequestHeaders(), {});
});


test("DXF worker preview carries tenant context without changing the signed artifact", () => {
  const signed = "https://storage.example/part.dxf?X-Amz-Signature=original&expires=86400";
  const preview = `/api/chat/preview-dxf?url=${encodeURIComponent(signed)}`;
  setWorkspaceOperation(true, 12, 2);
  const request = new URL(workspaceUrl(preview), "https://workspace.invalid");
  assert.equal(request.searchParams.get("workspace_tenant_id"), "2");
  assert.equal(request.searchParams.get("url"), signed);
  setWorkspaceOperation(true, 12, 3);
  assert.equal(new URL(workspaceUrl(preview), "https://workspace.invalid").searchParams.get("workspace_tenant_id"), "3");
  setWorkspaceOperation(false, 12, null);
  assert.equal(workspaceUrl(preview), preview);
});


test("persistent selections are partitioned by real actor and operation tenant", () => {
  setWorkspaceOperation(true, 12, 2);
  const a = workspaceStorageKey("process-selected");
  setWorkspaceOperation(true, 12, 3);
  assert.notEqual(workspaceStorageKey("process-selected"), a);
  setWorkspaceOperation(true, 13, 2);
  assert.notEqual(workspaceStorageKey("process-selected"), a);
  setWorkspaceOperation(false, 12, null);
  assert.equal(workspaceStorageKey("process-selected"), "process-selected");
});
