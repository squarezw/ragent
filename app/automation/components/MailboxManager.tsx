"use client";

import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import axios from "@/lib/axios";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { getApiErrorMessage } from "@/lib/apiError";
import {
  EMPTY_MAILBOX_FORM,
  firstMailboxFormIssue,
  mailboxUpdatePayload,
  type MailboxFormIssue,
  type MailboxFormState,
} from "@/lib/automation/mailbox-form";
import { normalizeMailboxId, type MailboxOption } from "@/lib/automation/mailbox-id";

/**
 * 邮箱列表项：`GET /api/v1/automation-mailboxes` 的返回形状。
 *
 * `lastError` 目前由接口决定是否下发（列归属模块 E.1）：本任务只渲染拿到的东西，
 * 有值才显示，不去发明一个服务端还没有的字段。
 */
export type MailboxManagerItem = MailboxOption & { lastError?: string };

type MailboxManagerProps = {
  open: boolean;
  onClose: () => void;
  /**
   * 编辑 / 删除成功后通知宿主页刷新它的邮箱名单。
   *
   * 向导的名单只在页面挂载时拉一次（有意为之：反复重拉会把用户正在做的选择冲掉），
   * 不通知的话抽屉里改完、向导里还是旧数据，用户会以为没保存成功。
   */
  onMailboxesChanged?: () => void;
};

const MAILBOX_ENDPOINT = "/api/v1/automation-mailboxes";

/** 编辑表单初值：只回填可编辑字段，**密码恒为空**（服务端从不回传已存密码）。 */
function formFromItem(item: MailboxManagerItem): MailboxFormState {
  return {
    name: String(item?.name ?? ""),
    email: String(item?.email ?? ""),
    username: String(item?.username ?? ""),
    password: "",
    imapHost: String(item?.imapHost ?? ""),
    imapPort: String(item?.imapPort ?? 993),
    folder: String(item?.folder ?? "INBOX"),
  };
}

export default function MailboxManager({ open, onClose, onMailboxesChanged }: MailboxManagerProps) {
  const t = useTranslations("automation");

  function issueText(issue: MailboxFormIssue) {
    if (issue === "email") return t("mailboxManagerIssueEmail");
    if (issue === "username") return t("mailboxManagerIssueUsername");
    if (issue === "imapHost") return t("mailboxManagerIssueImapHost");
    return t("mailboxManagerIssueImapPort");
  }

  const [items, setItems] = useState<MailboxManagerItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState("");

  const [editingId, setEditingId] = useState<number | null>(null);
  const [editForm, setEditForm] = useState<MailboxFormState>(EMPTY_MAILBOX_FORM);
  const [editIssue, setEditIssue] = useState<MailboxFormIssue | null>(null);
  const [editError, setEditError] = useState("");
  const [saving, setSaving] = useState(false);

  const [confirmingDeleteId, setConfirmingDeleteId] = useState<number | null>(null);
  const [deletingId, setDeletingId] = useState<number | null>(null);

  const loadMailboxes = useCallback(async () => {
    setLoading(true);
    setLoadError("");
    try {
      const response = await axios.get(MAILBOX_ENDPOINT, { suppressErrorToast: true } as never);
      const list = Array.isArray(response.data?.items) ? response.data.items : [];
      // 拿不到合法 id 的行不渲染：它们点不动、也编辑不了。
      setItems(list.filter((item: MailboxManagerItem) => normalizeMailboxId(item?.id) !== null));
    } catch (error) {
      setLoadError(getApiErrorMessage(error, t("mailboxManagerLoadFailed")));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    if (!open) return;
    // 每次打开都重新拉：这个抽屉的职责就是看当前状态，展示缓存比展示空更糟。
    setEditingId(null);
    setConfirmingDeleteId(null);
    void loadMailboxes();
  }, [open, loadMailboxes]);

  function startEdit(item: MailboxManagerItem) {
    const mailboxId = normalizeMailboxId(item?.id);
    if (mailboxId === null) return;
    setEditingId(mailboxId);
    setEditForm(formFromItem(item));
    setEditIssue(null);
    setEditError("");
    setConfirmingDeleteId(null);
  }

  function cancelEdit() {
    setEditingId(null);
    setEditIssue(null);
    setEditError("");
  }

  function updateField(field: keyof MailboxFormState, value: string) {
    setEditForm((current) => ({ ...current, [field]: value }));
  }

  async function saveEdit() {
    if (editingId === null) return;

    // 密码可留空（留空＝不修改）；其余字段与新建同一套规则。
    const issue = firstMailboxFormIssue(editForm, { passwordOptional: true });
    setEditIssue(issue);
    setEditError("");
    if (issue) return;

    setSaving(true);
    try {
      const response = await axios.put(
        `${MAILBOX_ENDPOINT}/${editingId}`,
        mailboxUpdatePayload(editForm),
        { suppressErrorToast: true } as never
      );
      const updated = response.data as MailboxManagerItem;
      setItems((current) =>
        current.map((item) =>
          normalizeMailboxId(item.id) === editingId ? { ...item, ...updated } : item
        )
      );
      setEditingId(null);
      toast.success(t("mailboxManagerUpdated"));
      onMailboxesChanged?.();
    } catch (error) {
      // 接口在写入前会真实连一次 IMAP，连接失败的原因（主机、端口、授权码）原样显示。
      setEditError(getApiErrorMessage(error, t("mailboxManagerSaveFailed")));
    } finally {
      setSaving(false);
    }
  }

  async function removeMailbox(mailboxId: number) {
    setDeletingId(mailboxId);
    try {
      await axios.delete(`${MAILBOX_ENDPOINT}/${mailboxId}`, {
        suppressErrorToast: true,
      } as never);
      setItems((current) => current.filter((item) => normalizeMailboxId(item.id) !== mailboxId));
      setConfirmingDeleteId(null);
      if (editingId === mailboxId) setEditingId(null);
      toast.success(t("mailboxManagerDeleted"));
      onMailboxesChanged?.();
    } catch (error) {
      const dependents = (error as { response?: { data?: { dependents?: unknown } } })?.response
        ?.data?.dependents;
      if (Array.isArray(dependents)) {
        // 409 + 依赖清单：本地化文案比原文更清楚，且能把数量说进句子里。
        toast.error(t("mailboxManagerDeleteBlocked", { count: dependents.length }));
      } else {
        toast.error(getApiErrorMessage(error, t("mailboxManagerDeleteFailed")));
      }
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <SheetContent
        side="right"
        className="flex w-full flex-col gap-4 overflow-y-auto sm:max-w-2xl"
      >
        <SheetHeader>
          <SheetTitle>{t("mailboxManagerTitle")}</SheetTitle>
          <SheetDescription>{t("mailboxManagerDescription")}</SheetDescription>
        </SheetHeader>

        {loading && (
          <div className="py-8 text-center text-sm text-muted-foreground">
            {t("mailboxManagerLoading")}
          </div>
        )}

        {!loading && loadError && (
          <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {loadError}
          </div>
        )}

        {!loading && !loadError && items.length === 0 && (
          <div className="rounded-lg border border-dashed px-4 py-8 text-center">
            <div className="text-sm font-medium">{t("mailboxManagerEmpty")}</div>
            <div className="mt-1 text-xs text-muted-foreground">{t("mailboxManagerEmptyHint")}</div>
          </div>
        )}

        <div className="flex flex-col gap-3">
          {items.map((item) => {
            const mailboxId = normalizeMailboxId(item.id);
            if (mailboxId === null) return null;

            const status = String(item.status ?? "connected");
            const isError = status === "error";
            const lastError = String(item.lastError ?? "").trim();
            const editing = editingId === mailboxId;
            const confirming = confirmingDeleteId === mailboxId;
            const busy = deletingId === mailboxId;

            return (
              <div key={mailboxId} className="rounded-lg border p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="truncate text-sm font-semibold">
                        {String(item.name || item.email || "")}
                      </span>
                      <Badge variant={isError ? "destructive" : "secondary"}>
                        {isError
                          ? t("mailboxManagerStatusError")
                          : t("mailboxManagerStatusConnected")}
                      </Badge>
                    </div>
                    <div className="mt-1 truncate text-xs text-muted-foreground">{item.email}</div>
                    <div className="mt-0.5 truncate text-xs text-muted-foreground">
                      {t("mailboxManagerImapServer")}: {item.imapHost}:{item.imapPort}
                      {item.folder ? ` · ${item.folder}` : ""}
                    </div>
                    <div className="mt-0.5 text-xs text-muted-foreground">
                      {t("mailboxManagerLastError")}: {lastError || t("mailboxManagerNoError")}
                    </div>
                  </div>

                  <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
                    {confirming ? (
                      <>
                        <span className="text-xs text-destructive">
                          {t("mailboxManagerDeleteConfirm")}
                        </span>
                        <Button
                          type="button"
                          variant="destructive"
                          size="sm"
                          disabled={busy}
                          onClick={() => void removeMailbox(mailboxId)}
                        >
                          {t("mailboxManagerDelete")}
                        </Button>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          disabled={busy}
                          onClick={() => setConfirmingDeleteId(null)}
                        >
                          {t("mailboxManagerCancel")}
                        </Button>
                      </>
                    ) : (
                      <>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => (editing ? cancelEdit() : startEdit(item))}
                        >
                          {editing ? t("mailboxManagerCancel") : t("mailboxManagerEdit")}
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="text-destructive hover:text-destructive"
                          onClick={() => setConfirmingDeleteId(mailboxId)}
                        >
                          {t("mailboxManagerDelete")}
                        </Button>
                      </>
                    )}
                  </div>
                </div>

                {editing && (
                  <div className="mt-4 border-t pt-4">
                    <div className="grid gap-3 sm:grid-cols-2">
                      <div className="flex flex-col gap-1.5">
                        <Label htmlFor={`mailbox-${mailboxId}-name`}>
                          {t("mailboxManagerFieldName")}
                        </Label>
                        <Input
                          id={`mailbox-${mailboxId}-name`}
                          value={editForm.name}
                          onChange={(event) => updateField("name", event.target.value)}
                        />
                      </div>

                      <div className="flex flex-col gap-1.5">
                        <Label htmlFor={`mailbox-${mailboxId}-email`}>
                          {t("mailboxManagerFieldEmail")}
                        </Label>
                        <Input
                          id={`mailbox-${mailboxId}-email`}
                          value={editForm.email}
                          onChange={(event) => updateField("email", event.target.value)}
                        />
                      </div>

                      <div className="flex flex-col gap-1.5">
                        <Label htmlFor={`mailbox-${mailboxId}-username`}>
                          {t("mailboxManagerFieldUsername")}
                        </Label>
                        <Input
                          id={`mailbox-${mailboxId}-username`}
                          value={editForm.username}
                          onChange={(event) => updateField("username", event.target.value)}
                        />
                      </div>

                      <div className="flex flex-col gap-1.5">
                        <Label htmlFor={`mailbox-${mailboxId}-password`}>
                          {t("mailboxManagerFieldPassword")}
                        </Label>
                        <Input
                          id={`mailbox-${mailboxId}-password`}
                          type="password"
                          autoComplete="new-password"
                          value={editForm.password}
                          onChange={(event) => updateField("password", event.target.value)}
                        />
                        <span className="text-xs text-muted-foreground">
                          {t("mailboxManagerPasswordHint")}
                        </span>
                      </div>

                      <div className="flex flex-col gap-1.5">
                        <Label htmlFor={`mailbox-${mailboxId}-imap-host`}>
                          {t("mailboxManagerFieldImapHost")}
                        </Label>
                        <Input
                          id={`mailbox-${mailboxId}-imap-host`}
                          value={editForm.imapHost}
                          onChange={(event) => updateField("imapHost", event.target.value)}
                        />
                      </div>

                      <div className="flex flex-col gap-1.5">
                        <Label htmlFor={`mailbox-${mailboxId}-imap-port`}>
                          {t("mailboxManagerFieldImapPort")}
                        </Label>
                        <Input
                          id={`mailbox-${mailboxId}-imap-port`}
                          value={editForm.imapPort}
                          onChange={(event) => updateField("imapPort", event.target.value)}
                        />
                      </div>

                      <div className="flex flex-col gap-1.5">
                        <Label htmlFor={`mailbox-${mailboxId}-folder`}>
                          {t("mailboxManagerFieldFolder")}
                        </Label>
                        <Input
                          id={`mailbox-${mailboxId}-folder`}
                          value={editForm.folder}
                          onChange={(event) => updateField("folder", event.target.value)}
                        />
                      </div>
                    </div>

                    <p className="mt-3 text-xs text-muted-foreground">
                      {t("mailboxManagerCursorHint")}
                    </p>

                    {editIssue && (
                      <p className="mt-2 text-xs text-destructive">{issueText(editIssue)}</p>
                    )}
                    {editError && <p className="mt-2 text-xs text-destructive">{editError}</p>}

                    <div className="mt-3 flex justify-end gap-2">
                      <Button type="button" variant="outline" size="sm" onClick={cancelEdit}>
                        {t("mailboxManagerCancel")}
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        disabled={saving}
                        onClick={() => void saveEdit()}
                      >
                        {saving ? t("mailboxManagerSaving") : t("mailboxManagerSave")}
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </SheetContent>
    </Sheet>
  );
}
