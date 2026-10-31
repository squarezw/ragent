import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import ts from "typescript";

test("tag selection controls never nest a native button inside another button", () => {
  const source = fs.readFileSync("components/TagSelect.tsx", "utf8");
  const file = ts.createSourceFile("TagSelect.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let toggleFound = false;
  function visit(node: ts.Node, insideButton = false) {
    let button = false;
    if (ts.isJsxElement(node)) {
      button = node.openingElement.tagName.getText(file) === "button";
      if (button) {
        assert.equal(insideButton, false, "nested button would cause a hydration error");
        const attributes = node.openingElement.attributes.getText(file);
        if (attributes.includes("handleSelectTag(tag)")) {
          toggleFound = true;
          assert.match(attributes, /aria-pressed=\{isSelected\}/);
          assert.match(attributes, /disabled=\{disabled\}/);
        }
      }
    }
    ts.forEachChild(node, child => visit(child, insideButton || button));
  }
  visit(file);
  assert.equal(toggleFound, true, "keep one accessible native button for each tag toggle");
});
