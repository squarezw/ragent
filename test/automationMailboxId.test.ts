import assert from "node:assert/strict";
import { test } from "node:test";
import {
  MAILBOX_ID_REQUIRED,
  MAILBOX_LABEL_REQUIRED,
  MAILBOX_NEW_OPTION,
  MAILBOX_SYSTEM_RETIRED,
  automationMailboxLabel,
  defaultMailboxSelection,
  isMailboxSelectionUnresolved,
  mailboxGroupKey,
  mailboxOptionLabel,
  mailboxSelectValue,
  normalizeMailboxId,
  requireMailboxId,
  requireMailboxLabel,
  selectMailboxScopedAutomations,
  storedMailboxLabel,
  type MailboxOption,
} from "../lib/automation/mailbox-id.ts";

test("normalizeMailboxId: 正整数原样返回", () => {
  assert.equal(normalizeMailboxId(12), 12);
  assert.equal(normalizeMailboxId(1), 1);
  assert.equal(normalizeMailboxId(999999), 999999);
});

test("normalizeMailboxId: 遗留的 mailbox:<id> 字符串与 system 一律视为无效", () => {
  assert.equal(normalizeMailboxId("mailbox:12"), null);
  assert.equal(normalizeMailboxId("system"), null);
  assert.equal(normalizeMailboxId("12"), null);
});

test("normalizeMailboxId: 非正整数与其他类型一律视为无效", () => {
  const invalid = [
    0,
    -1,
    1.5,
    Number.NaN,
    Number.POSITIVE_INFINITY,
    "",
    null,
    undefined,
    true,
    {},
    [],
  ];
  for (const value of invalid) {
    assert.equal(normalizeMailboxId(value), null, `${String(value)} 应判定为无效`);
  }
});

test("requireMailboxId: 合法取值通过", () => {
  assert.equal(requireMailboxId(7), 7);
});

test("requireMailboxId: 缺失 mailboxId 时抛出可识别错误，而非回退 system", () => {
  for (const value of [undefined, null, "mailbox:7", 0, "7"]) {
    assert.throws(
      () => requireMailboxId(value),
      (error: Error) => error.message === MAILBOX_ID_REQUIRED,
      `${String(value)} 应抛错`
    );
  }
});

test("requireMailboxId: 错误信息指明缺失的 mailboxId 字段", () => {
  assert.throws(() => requireMailboxId(undefined), /MAILBOX_ID_REQUIRED/);
});

// ── 模块 A：系统邮箱下线 ──────────────────────────────────────────────

test("A.4 requireMailboxId: 提交已下线的系统邮箱哨兵值时抛 MAILBOX_SYSTEM_RETIRED", () => {
  // 单独一个错误码，接口据此回「系统邮箱已下线，请配置监听邮箱」，而不是通用的"缺少邮箱"。
  for (const value of ["system", " system ", "system "]) {
    assert.throws(
      () => requireMailboxId(value),
      (error: Error) => error.message === MAILBOX_SYSTEM_RETIRED,
      `${JSON.stringify(value)} 应判定为已下线的系统邮箱`
    );
  }
});

test("A.4 requireMailboxId: 其他非法值仍走通用错误码，不被哨兵值判断吞掉", () => {
  for (const value of [undefined, null, "mailbox:7", "systems", 0, ""]) {
    assert.throws(
      () => requireMailboxId(value),
      (error: Error) => error.message === MAILBOX_ID_REQUIRED,
      `${JSON.stringify(value ?? null)} 应走 MAILBOX_ID_REQUIRED`
    );
  }
});

test("A.5 requireMailboxLabel: 展示名缺失时抛错，不兜底成已下线的邮箱名", () => {
  assert.equal(requireMailboxLabel("销售部邮箱 · sales@corp.com"), "销售部邮箱 · sales@corp.com");
  assert.equal(requireMailboxLabel("  财务邮箱 · finance@corp.com  "), "财务邮箱 · finance@corp.com");

  for (const value of [undefined, null, "", "   "]) {
    assert.throws(
      () => requireMailboxLabel(value),
      (error: Error) => error.message === MAILBOX_LABEL_REQUIRED,
      `${JSON.stringify(value ?? null)} 应抛错`
    );
  }
});

test("A.5 storedMailboxLabel: 展示层缺失时返回 null，由调用方显示「未配置」", () => {
  assert.equal(storedMailboxLabel("销售部邮箱 · sales@corp.com"), "销售部邮箱 · sales@corp.com");
  assert.equal(storedMailboxLabel("  财务邮箱  "), "财务邮箱");

  for (const value of [undefined, null, "", "   "]) {
    assert.equal(storedMailboxLabel(value), null, `${JSON.stringify(value ?? null)} 应返回 null`);
  }
});

test("mailboxGroupKey: 分组键为 userId:mailboxId", () => {
  assert.equal(mailboxGroupKey(3, 12), "3:12");
});

test("mailboxGroupKey: 不再出现 mailbox: 字符串编码", () => {
  assert.equal(mailboxGroupKey(3, 12).includes("mailbox:"), false);
});

test("mailboxGroupKey: 不同用户或不同邮箱不会落进同一分组", () => {
  const keys = new Set([mailboxGroupKey(1, 2), mailboxGroupKey(1, 3), mailboxGroupKey(2, 2)]);
  assert.equal(keys.size, 3);
});

// ── 模块 B / D.7：向导邮箱下拉的选择与展示派生 ──────────────────────────

test("mailboxSelectValue: 选中已保存邮箱时下拉落在该 id 上", () => {
  assert.equal(mailboxSelectValue(12, false), "12");
  assert.equal(mailboxSelectValue(12, true), MAILBOX_NEW_OPTION);
});

test("mailboxSelectValue: 未选择邮箱或正在配置新邮箱时落在「＋ 配置新邮箱…」", () => {
  assert.equal(mailboxSelectValue(null, false), MAILBOX_NEW_OPTION);
  assert.equal(mailboxSelectValue(null, true), MAILBOX_NEW_OPTION);
  assert.equal(mailboxSelectValue(0, false), MAILBOX_NEW_OPTION);
  assert.equal(mailboxSelectValue(1.5, false), MAILBOX_NEW_OPTION);
});

test("mailboxOptionLabel: 优先用接口 label，缺失时按 name · email 派生", () => {
  assert.equal(mailboxOptionLabel({ id: 7, label: "销售部邮箱 · sales@corp.com" }), "销售部邮箱 · sales@corp.com");
  assert.equal(mailboxOptionLabel({ id: 8, name: "财务邮箱", email: "finance@corp.com" }), "财务邮箱 · finance@corp.com");
  assert.equal(mailboxOptionLabel({ id: 9, name: "finance@corp.com", email: "finance@corp.com" }), "finance@corp.com");
});

const mailboxOptions: MailboxOption[] = [
  { id: 7, label: "销售部邮箱 · sales@corp.com", name: "销售部邮箱", email: "sales@corp.com" },
  { id: 8, label: "售后邮箱 · support@corp.com", name: "售后邮箱", email: "support@corp.com" },
];

test("D.7 selectMailboxScopedAutomations: 只返回同一监听邮箱下正在运行的邮件自动化", () => {
  const scoped = selectMailboxScopedAutomations(
    [
      { id: 1, trigger: "邮件触发", status: "running", mailboxId: 7 },
      { id: 2, trigger: "邮件触发", status: "running", mailboxId: 8 },
      { id: 3, trigger: "邮件触发", status: "paused", mailboxId: 7 },
      { id: 4, trigger: "定时触发", status: "running", mailboxId: 7 },
      { id: 5, trigger: "邮件触发", status: "running", mailboxId: 7 },
    ],
    { mailboxId: 7 },
  );

  assert.deepEqual(scoped.map((item) => item.id), [1, 5]);
});

test("D.7 selectMailboxScopedAutomations: 不同邮箱的自动化互不算冲突", () => {
  const items = [
    { id: 1, trigger: "邮件触发", status: "running", mailboxId: 7 },
    { id: 2, trigger: "邮件触发", status: "running", mailboxId: 8 },
  ];

  assert.deepEqual(selectMailboxScopedAutomations(items, { mailboxId: 7 }).map((item) => item.id), [1]);
  assert.deepEqual(selectMailboxScopedAutomations(items, { mailboxId: 8 }).map((item) => item.id), [2]);
});

test("D.7 selectMailboxScopedAutomations: 未选择邮箱时没有候选", () => {
  const items = [{ id: 1, trigger: "邮件触发", status: "running", mailboxId: 7 }];

  assert.deepEqual(selectMailboxScopedAutomations(items, { mailboxId: null }), []);
  assert.deepEqual(selectMailboxScopedAutomations(items, { mailboxId: 0 }), []);
});

test("D.7 selectMailboxScopedAutomations: 遗留行（无整数 mailboxId）不参与任何分组", () => {
  const scoped = selectMailboxScopedAutomations(
    [
      { id: 1, trigger: "邮件触发", status: "running", mailboxId: null },
      { id: 2, trigger: "邮件触发", status: "running" },
      { id: 3, trigger: "邮件触发", status: "running", mailboxId: 7 },
    ],
    { mailboxId: 7 },
  );

  assert.deepEqual(scoped.map((item) => item.id), [3]);
});

test("D.7 selectMailboxScopedAutomations: 正在编辑的自动化自身不进入候选", () => {
  const items = [
    { id: 1, trigger: "邮件触发", status: "running", mailboxId: 7 },
    { id: 2, trigger: "邮件触发", status: "running", mailboxId: 7 },
  ];

  assert.deepEqual(selectMailboxScopedAutomations(items, { mailboxId: 7, excludeId: 2 }).map((item) => item.id), [1]);
  assert.deepEqual(selectMailboxScopedAutomations(items, { mailboxId: 7, excludeId: null }).map((item) => item.id), [1, 2]);
});

test("automationMailboxLabel: 按 id 现查名单，邮箱改名后展示名同步更新", () => {
  assert.equal(
    automationMailboxLabel({ mailboxId: 7, mailboxLabel: "旧名字 · sales@corp.com" }, mailboxOptions),
    "销售部邮箱 · sales@corp.com",
  );
});

test("automationMailboxLabel: 名单里查不到时退回服务端派生的存储名", () => {
  assert.equal(
    automationMailboxLabel({ mailboxId: 7, mailboxLabel: "销售部邮箱 · sales@corp.com" }, []),
    "销售部邮箱 · sales@corp.com",
  );
});

test("automationMailboxLabel: 遗留行不再回退到「系统邮箱」", () => {
  // 遗留行没有整数 mailboxId；它旧的存储名（哪怕正是"系统邮箱"）也不作为展示来源。
  assert.equal(automationMailboxLabel({ mailboxId: null, mailboxLabel: "系统邮箱" }, mailboxOptions), null);
  assert.equal(automationMailboxLabel({ mailboxId: undefined }, mailboxOptions), null);
  assert.equal(automationMailboxLabel({ mailboxId: 0 }, mailboxOptions), null);
  assert.equal(automationMailboxLabel({ mailboxId: 7 }, mailboxOptions), "销售部邮箱 · sales@corp.com");
});

// ── 名单加载后的默认选择与"查不到"判定（评审修复：绝不静默改绑） ──────────

test("defaultMailboxSelection: 还没有选择时才用名单第一条", () => {
  assert.equal(defaultMailboxSelection(null, mailboxOptions), 7);
  assert.equal(defaultMailboxSelection(null, []), null);
});

test("defaultMailboxSelection: 已有选择一律原样保留，即使名单里查不到", () => {
  // 回归：老实现在这里会返回名单第一条（7），把自动化静默改绑到另一个收件箱。
  assert.equal(defaultMailboxSelection(99, mailboxOptions), 99);
  assert.equal(defaultMailboxSelection(99, []), 99);
  assert.equal(defaultMailboxSelection(8, mailboxOptions), 8);
});

test("defaultMailboxSelection: 非法选择按未选择处理", () => {
  assert.equal(defaultMailboxSelection(0, mailboxOptions), 7);
  assert.equal(defaultMailboxSelection(1.5, mailboxOptions), 7);
});

test("isMailboxSelectionUnresolved: 名单加载完且查不到该邮箱时判定为未解析", () => {
  assert.equal(isMailboxSelectionUnresolved(99, mailboxOptions, true), true);
  // 名单拉取失败（已加载但为空）时同样判为未解析：此时无法确认选择，必须让用户重选。
  assert.equal(isMailboxSelectionUnresolved(99, [], true), true);
});

test("isMailboxSelectionUnresolved: 名单里存在该邮箱时不算未解析", () => {
  assert.equal(isMailboxSelectionUnresolved(7, mailboxOptions, true), false);
  assert.equal(isMailboxSelectionUnresolved("7", mailboxOptions, true), false);
});

test("isMailboxSelectionUnresolved: 名单未加载完时一律不算未解析", () => {
  // 加载窗口里"查不到"只说明数据还没到，据此展开表单会误伤正常用户。
  assert.equal(isMailboxSelectionUnresolved(99, [], false), false);
  assert.equal(isMailboxSelectionUnresolved(99, mailboxOptions, false), false);
});

test("isMailboxSelectionUnresolved: 未选择或非法选择不算未解析", () => {
  assert.equal(isMailboxSelectionUnresolved(null, mailboxOptions, true), false);
  assert.equal(isMailboxSelectionUnresolved(0, mailboxOptions, true), false);
  assert.equal(isMailboxSelectionUnresolved(undefined as unknown as number | null, mailboxOptions, true), false);
});
