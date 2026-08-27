"use client";
import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  tenant: { id: number; name: string } | null;
  balance: number | null;
  onRecharge: (
    tenantId: number,
    amount: number,
    note: string,
    idempotencyKey: string
  ) => Promise<{ amount: number; balance: number; duplicate: boolean }>;
}

/**
 * 给租户预充积分。仅超管可见（调用方已按角色隐藏；后端另有 403 兜底 —— 
 * 藏起来的按钮不是权限，接口才是）。
 */
export default function TenantRechargeDialog({
  open,
  onOpenChange,
  tenant,
  balance,
  onRecharge,
}: Props) {
  const t = useTranslations("organization");
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [idemKey, setIdemKey] = useState("");

  // 幂等键在**打开对话框时**生成，不是提交时。
  // 提交时生成的话，双击会产生两个不同的 key —— 等于没有幂等，两笔都会到账。
  useEffect(() => {
    if (open) {
      setIdemKey(
        typeof crypto !== "undefined" && crypto.randomUUID
          ? crypto.randomUUID()
          : `rc-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
      );
      setAmount("");
      setNote("");
    }
  }, [open]);

  const parsed = Number(amount);
  const valid = amount.trim() !== "" && Number.isFinite(parsed) && parsed > 0;

  const submit = async () => {
    if (!tenant || !valid || submitting) return;
    setSubmitting(true);
    try {
      const res = await onRecharge(tenant.id, parsed, note.trim(), idemKey);
      toast.success(
        res.duplicate
          ? t("rechargeDuplicate", { balance: res.balance })
          : t("rechargeSuccess", { amount: res.amount, balance: res.balance })
      );
      onOpenChange(false);
    } catch (e: unknown) {
      const detail = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      toast.error(detail || t("rechargeFailed"));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("rechargeTitle", { name: tenant?.name ?? "" })}</DialogTitle>
          <DialogDescription>
            {balance === null
              ? t("rechargeDesc")
              : t("rechargeDescWithBalance", { balance })}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div>
            <Label htmlFor="recharge-amount">{t("rechargeAmount")}</Label>
            <Input
              id="recharge-amount"
              type="number"
              min="0.01"
              step="0.01"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder={t("rechargeAmountPlaceholder")}
              autoFocus
            />
          </div>
          <div>
            <Label htmlFor="recharge-note">{t("rechargeNote")}</Label>
            <Input
              id="recharge-note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder={t("rechargeNotePlaceholder")}
            />
            {/* 备注是对账时「这笔钱哪来的」的唯一线索 */}
            <p className="mt-1 text-xs text-muted-foreground">{t("rechargeNoteHint")}</p>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
            {t("cancel")}
          </Button>
          <Button onClick={submit} disabled={!valid || submitting}>
            {submitting ? t("recharging") : t("confirmRecharge")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
