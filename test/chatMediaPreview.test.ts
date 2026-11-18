import assert from "node:assert/strict";
import { test } from "node:test";
import { attachmentPreviewResource, toPreviewResource, isChatDownloadOnly } from "../lib/chatResourcePreview.ts";
import { sessionAttachmentMime } from "../lib/sessionAttachments.ts";

for (const [filename, kind, mime] of [["recording.WAV", "audio", "audio/wav"], ["clip.MP4", "video", "video/mp4"]]) {
  test(`${filename} uploads and signed reply links use the shared media panel`, () => {
    assert.equal(attachmentPreviewResource({filename, object_key: "attachments/object"})?.kind, kind);
    assert.equal(attachmentPreviewResource({filename, object_key: "attachments/object"})?.url, "/api/oss/attachments/object");
    assert.equal(toPreviewResource("url", `https://example.test/${filename}?signature=a`, "Play")?.kind, kind);
    assert.equal(toPreviewResource("url", `https://example.test/download?filename=${filename}`)?.kind, kind);
    assert.equal(isChatDownloadOnly(filename), false);
    assert.equal(sessionAttachmentMime({filename, objectKey: "attachments/object", contentType: "application/octet-stream"}), mime);
  });
}
test("extensionless media attachments use supported MIME values", () => {
  assert.equal(attachmentPreviewResource({filename: "recording", contentType: "audio/x-wav", url: "/api/oss/attachments/object"})?.kind, "audio");
  assert.equal(attachmentPreviewResource({filename: "clip", contentType: "video/mp4; codecs=avc1", url: "/api/oss/attachments/object"})?.kind, "video");
});
test("unsupported media and executable URLs retain existing restrictions", () => {
  assert.equal(isChatDownloadOnly("sound.flac"), true);
  assert.equal(isChatDownloadOnly("clip.mov"), true);
  for (const url of ["javascript:alert(1)", "data:video/mp4,a", "//example.test/file.mp4"]) {
    assert.equal(attachmentPreviewResource({filename: "clip.mp4", url}), null);
  }
});
