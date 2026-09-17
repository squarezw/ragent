import assert from "node:assert/strict";
import { test } from "node:test";
import { toPreviewResource } from "../lib/chatResourcePreview.ts";

test("chat resource previews allow http(s) URLs only", () => {
  assert.deepEqual(toPreviewResource("url", "https://example.com/path.html"), {
    kind: "url",
    url: "https://example.com/path.html",
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

test("DXF links are detected before signed query strings", () => {
  assert.equal(toPreviewResource("url", "https://example.com/DRAWING.DXF?signature=x")?.kind, "dxf");
  assert.equal(toPreviewResource("url", "/api/oss/chat/test.dxf")?.kind, "dxf");
});

test("unsupported file links do not open empty web previews", () => {
  for (const name of ["notes.md", "README.MARKDOWN", "report.pdf", "sheet.xlsx", "data.csv", "archive.zip", "notes%2Emd"]) {
    assert.equal(toPreviewResource("url", `https://example.com/${name}?signature=abc`), null);
  }
  assert.equal(toPreviewResource("url", "https://example.com/download?filename=notes.md"), null);
  assert.equal(toPreviewResource("url", "https://example.com/page.html")?.kind, "url");
  assert.equal(toPreviewResource("url", "https://example.com/article"), null);
});
