import assert from "node:assert/strict";
import {test} from "node:test";
import {downloadPreviewMedia} from "../lib/downloadPreviewMedia.ts";

test("media download clicks a blob URL with a filename and removes the temporary link", async () => {
  const original = {fetch:globalThis.fetch, document:globalThis.document, timeout:globalThis.setTimeout, create:URL.createObjectURL, revoke:URL.revokeObjectURL};
  let clicked=false, removed=false, revoked=false;
  let cleanup: (()=>void) | undefined;
  const anchor = {href:"", download:"", click(){clicked=true; assert.equal(this.href,"blob:test-media"); assert.equal(this.download,"sample.wav");}, remove(){removed=true;}};
  try {
    globalThis.fetch = async url => {assert.equal(url,"/api/oss/example.wav?inline=1"); return new Response(new Blob(["audio bytes"]));};
    globalThis.document = {createElement:()=>anchor,body:{appendChild:()=>{}}} as any;
    URL.createObjectURL = blob => {assert.equal(blob.size,11); return "blob:test-media";};
    URL.revokeObjectURL = url => {assert.equal(url,"blob:test-media");revoked=true;};
    globalThis.setTimeout = ((fn:()=>void)=>{cleanup=fn;return 1;}) as any;
    await downloadPreviewMedia("/api/oss/example.wav?inline=1","sample.wav");
    assert.equal(clicked,true);assert.equal(removed,true);assert.equal(revoked,false);
    cleanup!();assert.equal(revoked,true);
  } finally {globalThis.fetch=original.fetch;globalThis.document=original.document;globalThis.setTimeout=original.timeout;URL.createObjectURL=original.create;URL.revokeObjectURL=original.revoke;}
});

test("failed download reports failure without creating a navigation link", async () => {
  const original=globalThis.fetch;
  try {
    globalThis.fetch=async()=>new Response("denied",{status:403});
    await assert.rejects(downloadPreviewMedia("/api/oss/denied.wav"),/HTTP 403/);
  } finally {globalThis.fetch=original;}
});
