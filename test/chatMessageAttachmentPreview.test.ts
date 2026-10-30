import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import test from "node:test";
import ts from "typescript";
import * as sessionAttachments from "../lib/sessionAttachments.ts";
import * as chatResourcePreview from "../lib/chatResourcePreview.ts";

const exports: any = {};
runInNewContext(
  ts.transpileModule(
    readFileSync(new URL("../lib/chatAttachmentPreview.ts", import.meta.url), "utf8"),
    {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
    }
  ).outputText,
  {
    exports,
    require: (name: string) => {
      if (name === "./sessionAttachments") return sessionAttachments;
      if (name === "./chatResourcePreview") return chatResourcePreview;
      throw new Error(name);
    },
  }
);
const preview = exports.chatAttachmentPreview;

test("current PDF MIME opens authenticated inline preview rather than download URL", () => {
  const target = preview({
    filename: "drawing.pdf",
    type: "application/pdf",
    objectKey: "attachments/user/drawing.pdf",
    url: "https://storage.example/download?signed=value",
  });
  assert.equal(target.kind, "preview");
  assert.equal(target.file.mimetype, "application/pdf");
  assert.equal(target.file.sourceUrl, "/api/oss/attachments/user/drawing.pdf?inline=1");
  assert.equal(target.file.originalname, "drawing.pdf");
});

test("history snake-case, missing URL, labels and absent MIME resolve to the same preview", () => {
  for (const type of [undefined, "PDF", "application/octet-stream"]) {
    const target = preview({
      filename: "REPORT.PDF",
      object_key: "attachments/report.pdf",
      content_type: type,
    });
    assert.equal(target.kind, "preview");
    assert.equal(target.file.mimetype, "application/pdf");
    assert.equal(target.file.sourceUrl, "/api/oss/attachments/report.pdf?inline=1");
  }
});

test("extensionless PDF uses stored MIME; query-bearing OSS URL uses existing inline helper", () => {
  const target = preview({
    filename: "document",
    type: "application/pdf",
    url: "/api/oss/uploads/file?view=current",
  });
  assert.equal(target.file.sourceUrl, "/api/oss/uploads/file?view=current&inline=1");
});

test("legacy signed HTTPS URL is preserved without modifying its signature", () => {
  const url = "https://storage.example/report.pdf?signature=unchanged";
  assert.equal(preview({ filename: "report.pdf", url }).file.sourceUrl, url);
});

test("existing document and image formats use the established preview dialog", () => {
  for (const filename of ["word.docx", "sheet.xlsx", "notes.txt", "notes.md", "image.png"]) {
    assert.equal(preview({ filename, objectKey: `attachments/${filename}` }).kind, "preview");
  }
});

test("download-only archives and DWG remain downloads; missing or unsafe locations do nothing", () => {
  for (const filename of ["archive.zip", "drawing.dwg", "design.ai"]) {
    assert.equal(preview({ filename, objectKey: `attachments/${filename}` }).kind, "download");
  }
  assert.equal(preview({ filename: "missing.pdf" }), null);
  assert.equal(preview({ filename: "unsafe.pdf", url: "javascript:alert(1)" }), null);
  assert.equal(preview({ filename: "unsafe.pdf", url: "//external.example/file" }), null);
});

test("message preview handler opens the dialog for PDF and keeps ZIP on the download action", () => {
  let previewFile: any = null;
  const downloads: string[] = [];
  let index = 0;
  const hook: any = {};
  const imports: Record<string, any> = {
    react: {
      useState: (initial: any) => {
        const slot = index++;
        return [
          initial,
          (value: any) => {
            if (slot === 3) previewFile = value;
          },
        ];
      },
      useRef: (value: any) => ({ current: value }),
    },
    "next-intl": { useTranslations: () => (key: string) => key },
    "@/lib/chatResourcePreview": { downloadChatLink: (url: string) => downloads.push(url) },
    "@/lib/chatAttachmentPreview": { chatAttachmentPreview: preview },
    "@/lib/axios": {},
    "@/lib/browserAuthMode": {},
    "@/lib/ossUpload": {},
    "@/lib/sessionAttachments": sessionAttachments,
    "@/lib/chatAttachments": {},
  };
  runInNewContext(
    ts.transpileModule(
      readFileSync(new URL("../app/chat/hooks/useFileAttachments.ts", import.meta.url), "utf8"),
      {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
      }
    ).outputText,
    {
      exports: hook,
      require: (name: string) => {
        assert.ok(name in imports, name);
        return imports[name];
      },
    }
  );
  const attachments = hook.useFileAttachments();
  attachments.handlePreviewAttachment({
    filename: "report.pdf",
    type: "application/pdf",
    objectKey: "attachments/report.pdf",
  });
  assert.equal(previewFile.sourceUrl, "/api/oss/attachments/report.pdf?inline=1");
  assert.equal(downloads.length, 0);
  attachments.handlePreviewAttachment({
    filename: "archive.zip",
    objectKey: "attachments/archive.zip",
  });
  assert.equal(downloads[0], "/api/oss/attachments/archive.zip");
});
