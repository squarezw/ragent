import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import {
  attachmentPreviewUrl,
  normalizeSessionAttachments,
  sessionAttachmentMime,
} from "../lib/sessionAttachments.ts";

const REPO = path.resolve(import.meta.dirname, "..");
const read = (rel: string) => fs.readFileSync(path.join(REPO, rel), "utf8");

test("只保留能取回文件的附件", () => {
  assert.deepEqual(
    normalizeSessionAttachments([
      {
        object_key: "attachments/202609/a.pdf",
        filename: "图纸.pdf",
        content_type: "application/pdf",
        size: 12,
      },
      { object_key: "", filename: "取不回的.pdf" },
      { filename: "没有 key.png" },
      null,
    ]),
    [
      {
        filename: "图纸.pdf",
        objectKey: "attachments/202609/a.pdf",
        contentType: "application/pdf",
        size: 12,
      },
    ]
  );
});

test("也认 camelCase，避免前后端各写一套字段名", () => {
  assert.deepEqual(
    normalizeSessionAttachments([{ objectKey: "attachments/x.dxf", filename: "图.dxf" }]),
    [{ filename: "图.dxf", objectKey: "attachments/x.dxf" }]
  );
});

test("空值和非法输入都当成没有附件", () => {
  assert.deepEqual(normalizeSessionAttachments(null), []);
  assert.deepEqual(normalizeSessionAttachments(undefined), []);
  assert.deepEqual(normalizeSessionAttachments({}), []);
});

test("会话里记下的是展示标签时，预览仍按扩展名识别 PDF", () => {
  assert.equal(
    sessionAttachmentMime({
      filename: "双中心线试验圆角.pdf",
      objectKey: "attachments/202609/双中心线试验圆角_1f7749.pdf",
      contentType: "PDF",
    }),
    "application/pdf"
  );
});

test("会话附件预览走 inline，避免对象存储的 attachment 头触发下载", () => {
  assert.equal(
    attachmentPreviewUrl("/api/oss/attachments/202609/a.pdf"),
    "/api/oss/attachments/202609/a.pdf?inline=1"
  );
  assert.equal(attachmentPreviewUrl("https://example.com/a.pdf"), "https://example.com/a.pdf");
});

test("预览用 MIME：有有效类型就用，否则按扩展名补", () => {
  assert.equal(
    sessionAttachmentMime({
      filename: "a.pdf",
      objectKey: "k",
      contentType: "application/pdf",
    }),
    "application/pdf"
  );
  assert.equal(sessionAttachmentMime({ filename: "图.dxf", objectKey: "k" }), "application/dxf");
  assert.equal(
    sessionAttachmentMime({
      filename: "图.dxf",
      objectKey: "k",
      contentType: "application/octet-stream",
    }),
    "application/dxf"
  );
});

const DETAILS_API = read("pages/api/chat/sessions/[id]/details.ts");
const ADMIN_PAGE = read("app/chat-sessions/page.tsx");
const CHAT_PAGE = read("app/chat/page.tsx");

test("详情接口查出 attachments 并规范化后返回", () => {
  const select = DETAILS_API.match(/SELECT[\s\S]*?FROM chat_session_detail/);
  assert.ok(select, "找不到 chat_session_detail 的 SELECT");
  assert.ok(select[0].includes("attachments"), "SELECT 漏了 attachments");
  assert.match(DETAILS_API, /normalizeSessionAttachments\(detail\.attachments\)/);
});

test("会话详情在问题下面渲染附件", () => {
  assert.match(ADMIN_PAGE, /detail\.attachments/);
  assert.match(ADMIN_PAGE, /t\("attachments"\)/);
});

test("加载历史会话时把附件挂回用户消息", () => {
  assert.match(CHAT_PAGE, /attachments: toHistoryAttachments\(detail\.attachments\)/);
});
