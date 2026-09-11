import assert from "node:assert/strict";
import { test } from "node:test";
import { toPreviewResource } from "../lib/chatResourcePreview.ts";

test("chat resource previews allow http(s) URLs only", () => {
  assert.deepEqual(toPreviewResource("url", "https://example.com/path"), {
    kind: "url",
    url: "https://example.com/path",
  });
  assert.equal(toPreviewResource("url", "javascript:alert(1)"), null);
  assert.equal(toPreviewResource("url", "/reports/output.html"), null);
  assert.equal(toPreviewResource("url", "file:///tmp/report.html"), null);
});

test("image preview resources preserve accessible alternative text", () => {
  assert.deepEqual(toPreviewResource("image", "https://example.com/diagram.png", "Diagram"), {
    kind: "image",
    url: "https://example.com/diagram.png",
    alt: "Diagram",
  });
});

test("signed skill artifact HTML delivery links can use the web preview", () => {
  assert.deepEqual(
    toPreviewResource(
      "url",
      "https://oss.example.com/skill-artifacts/topology.html?signature=temporary-token"
    ),
    {
      kind: "url",
      url: "https://oss.example.com/skill-artifacts/topology.html?signature=temporary-token",
    }
  );
});
