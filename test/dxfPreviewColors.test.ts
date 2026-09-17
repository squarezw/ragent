import assert from "node:assert/strict";
import { test } from "node:test";
import { visibleDxfColor } from "../lib/dxfPreviewColors.ts";

test("dark DXF colors receive readable luminance on black", () => {
  for (const color of [0, 0x101010, 0x333333, 0x000080, 0x004000]) {
    const corrected = visibleDxfColor(color);
    const rgb = [corrected >>> 16, (corrected >>> 8) & 255, corrected & 255];
    const linear = rgb.map(c => c / 255 <= 0.04045 ? c / 255 / 12.92 : ((c / 255 + 0.055) / 1.055) ** 2.4);
    assert.ok((linear[0] * .2126 + linear[1] * .7152 + linear[2] * .0722 + .05) / .05 >= 4.5);
  }
  assert.equal(visibleDxfColor(0xffffff), 0xffffff);
  assert.equal(visibleDxfColor(0x00ff00), 0x00ff00);
});
