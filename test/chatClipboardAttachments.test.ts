import assert from "node:assert/strict";
import test from "node:test";
import { pasteChatAttachments } from "../app/chat/clipboardAttachments.ts";

function fixture(files: File[], text = "", items: any[] = []) {
  let prevented = 0;
  const batches: File[][] = [];
  const changes: string[] = [];
  const target = {
    value: "before SELECT after",
    selectionStart: 7,
    selectionEnd: 13,
    setRangeText(value: string, start: number, end: number, mode: string) {
      assert.equal(mode, "end");
      this.value = this.value.slice(0, start) + value + this.value.slice(end);
    },
  };
  const event = {
    clipboardData: {
      files: files as unknown as FileList,
      items: items as unknown as DataTransferItemList,
      getData: (format: string) => {
        assert.equal(format, "text/plain");
        return text;
      },
    },
    currentTarget: target,
    preventDefault: () => {
      prevented += 1;
    },
  };
  return {
    run: () =>
      pasteChatAttachments(
        event,
        (batch) => batches.push(batch),
        (value) => changes.push(value)
      ),
    batches,
    changes,
    target,
    prevented: () => prevented,
  };
}

test("image and PDF go to the existing file callback once without duplicate items", () => {
  const image = new File(["image"], "image.png", { type: "image/png" });
  const pdf = new File(["pdf"], "document.pdf", { type: "application/pdf" });
  const f = fixture([image, pdf], "", [
    {
      kind: "file",
      getAsFile: () => {
        throw new Error("must prefer files");
      },
    },
  ]);
  assert.equal(f.run(), true);
  assert.deepEqual(f.batches, [[image, pdf]]);
  assert.equal(f.prevented(), 1);
  assert.deepEqual(f.changes, []);
});

test("falls back to file items and ignores null and string entries", () => {
  const pdf = new File(["pdf"], "report.pdf");
  const f = fixture([], "", [
    {
      kind: "string",
      getAsFile: () => {
        throw new Error("not a file");
      },
    },
    { kind: "file", getAsFile: () => null },
    { kind: "file", getAsFile: () => pdf },
  ]);
  assert.equal(f.run(), true);
  assert.deepEqual(f.batches, [[pdf]]);
});

for (const text of ["ordinary text", "https://example.com/file.pdf", "/Users/me/file.pdf"]) {
  test(`native text paste is untouched: ${text}`, () => {
    const f = fixture([], text);
    assert.equal(f.run(), false);
    assert.equal(f.prevented(), 0);
    assert.deepEqual(f.batches, []);
    assert.deepEqual(f.changes, []);
  });
}

test("mixed file and text replaces the selection exactly once", () => {
  const image = new File(["image"], "image.png");
  const f = fixture([image], "caption");
  f.run();
  assert.deepEqual(f.changes, ["before caption after"]);
  assert.equal(f.prevented(), 1);
  assert.deepEqual(f.batches, [[image]]);
});

test("unsupported files still enter the shared validator, without a separate paste policy", () => {
  const file = new File(["exe"], "program.exe");
  const f = fixture([file]);
  f.run();
  assert.deepEqual(f.batches, [[file]]);
});
