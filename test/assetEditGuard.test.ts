import assert from "node:assert/strict";
import { test } from "node:test";
import { canEditAsset, type AssetEditability } from "../lib/assetEditGuard.ts";

const ok: AssetEditability = {
  hasWritePermission: true,
  textLoaded: true,
  isImage: false,
  isOffice: false,
  truncated: false,
};

test("文本资产 + 有写权限 → 可编辑", () => {
  assert.equal(canEditAsset(ok), true);
});

test("截断的内容不可编辑 —— 这条最要紧", () => {
  // 保存截断的正文 = 把文件后半截抹掉，而且 PUT 成功、界面显示「已保存」。
  // 没有任何地方会报错，用户下次打开才发现文件短了一半。
  assert.equal(canEditAsset({ ...ok, truncated: true }), false);
});

test("图片不可当文本编辑", () => {
  // 二进制被当字符串读进来时字节已经毁了，写回去就是一份坏文件
  assert.equal(canEditAsset({ ...ok, isImage: true }), false);
});

test("Office 文档不可当文本编辑", () => {
  assert.equal(canEditAsset({ ...ok, isOffice: true }), false);
});

test("没有写权限不可编辑（内置技能、只读用户）", () => {
  assert.equal(canEditAsset({ ...ok, hasWritePermission: false }), false);
});

test("正文还没取回时不可编辑", () => {
  assert.equal(canEditAsset({ ...ok, textLoaded: false }), false);
});

test("多个条件同时不满足仍是 false", () => {
  assert.equal(
    canEditAsset({ hasWritePermission: false, textLoaded: false, isImage: true, isOffice: true, truncated: true }),
    false
  );
});
