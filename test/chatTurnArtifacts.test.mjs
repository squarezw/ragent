import assert from "node:assert/strict";
import test from "node:test";
import { turnArtifacts, relativeArtifactUrl } from "../lib/chatTurnArtifacts.ts";

const id = "00000000-0000-4000-8000-000000000001";
const other = "00000000-0000-4000-8000-000000000002";

test("a successful receipt alone supplies a card, regardless of model text", () => {
  const files = turnArtifacts("3", [{ id, filename: "输出/客户 报表.xlsx", url: "https://untrusted.example/" }]);
  assert.deepEqual(files, [{ id, filename: "输出/客户 报表.xlsx",
    url: `/api/chat/sessions/3/artifacts/${id}/download?filename=${encodeURIComponent("客户 报表.xlsx")}` }]);
  assert.equal(relativeArtifactUrl("./输出/客户%20报表.xlsx", files), files[0].url);
  assert.equal(relativeArtifactUrl("客户%20报表.xlsx", files), files[0].url);
});

test("missing, ambiguous and unsafe local references cannot select another receipt", () => {
  const files = turnArtifacts(3, [
    { id, filename: "a/qr.png" }, { id: other, filename: "b/qr.png" },
    { id, filename: "stale.png" }, { id: "invalid", filename: "x" },
  ]);
  assert.equal(files.length, 2);
  for (const raw of ["qr.png", "old.png", "../a/qr.png", "wrong/qr.png"]) {
    assert.equal(relativeArtifactUrl(raw, files), null);
  }
  assert.equal(relativeArtifactUrl("a/qr.png", files), files[0].url);
  assert.equal(relativeArtifactUrl("https://example.com/qr.png", files), undefined);
  assert.equal(relativeArtifactUrl("/logo.png", files), undefined);
  assert.equal(relativeArtifactUrl("old.png", undefined), undefined);
  assert.deepEqual(turnArtifacts(3, null), []);
});
