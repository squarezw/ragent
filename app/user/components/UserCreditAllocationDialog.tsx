"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import axios from "@/lib/axios";
import { allocationAmount, allocationErrorKey } from "@/lib/userCreditAllocation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

interface Props {
  user: { id: number; username: string; nickname?: string; tenant_id?: number };
  onClose: () => void;
  onAllocated?: () => void;
}
interface AllocationPayload {
  user_id: number;
  amount: number;
  note: string | null;
  idempotency_key: string;
}

export default function UserCreditAllocationDialog({ user, onClose, onAllocated }: Props) {
  const t = useTranslations("user");
  const tc = useTranslations("common");
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [tenantBalance, setTenantBalance] = useState<number | null>(null);
  const [userBalance, setUserBalance] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const request = useRef<AllocationPayload | null>(null);
  const inFlight = useRef(false);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(false);
    try {
      const [tenantRes, userRes] = await Promise.all([
        axios.get(`/api/v1/billing/accounts?tenant_id=${user.tenant_id}`, {
          suppressErrorToast: true,
        }),
        axios.get(`/api/v1/billing/user-accounts?user_id=${user.id}`, { suppressErrorToast: true }),
      ]);
      const tenant = tenantRes.data?.items?.find(
        (item: { tenant_id: number }) => item.tenant_id === user.tenant_id
      );
      if (!tenant) throw new Error("No tenant balance returned");
      setTenantBalance(Number(tenant.balance));
      const account = userRes.data?.items?.[0];
      setUserBalance(account ? Number(account.balance) : null);
    } catch {
      setTenantBalance(null);
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }, [user.id, user.tenant_id]);

  useEffect(() => {
    void load();
  }, [load]);
  const parsed = allocationAmount(amount, tenantBalance);
  const submit = async () => {
    if (inFlight.current || (!request.current && parsed === null)) return;
    inFlight.current = true;
    setSubmitting(true);
    if (!request.current) {
      if (parsed === null) {
        inFlight.current = false;
        setSubmitting(false);
        return;
      }
      request.current = {
        user_id: user.id,
        amount: parsed,
        note: note.trim() || null,
        idempotency_key:
          typeof crypto !== "undefined" && crypto.randomUUID
            ? crypto.randomUUID()
            : `allocation-${Date.now()}-${Math.random().toString(36).slice(2, 12)}`,
      };
    }
    try {
      const res = await axios.post("/api/v1/billing/user-allocations", request.current, {
        suppressErrorToast: true,
      });
      toast.success(
        t("creditAllocationSuccess", { amount: res.data.amount, balance: res.data.user_balance })
      );
      request.current = null;
      setUncertain(false);
      onAllocated?.();
      onClose();
    } catch (error: unknown) {
      const hasResponse = Boolean((error as { response?: unknown })?.response);
      // A network failure may occur after commit. Keep exactly the same payload and key for retry.
      const knownFailure =
        hasResponse && Number((error as { response?: { status: number } }).response?.status) < 500;
      setUncertain(!knownFailure);
      if (knownFailure) {
        request.current = null;
        void load();
      }
      toast.error(t(knownFailure ? allocationErrorKey(error) : "creditAllocationUncertain"));
    } finally {
      inFlight.current = false;
      setSubmitting(false);
    }
  };
  const locked = submitting || uncertain;

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !locked) onClose();
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {t("creditAllocationTitle", { name: user.nickname || user.username })}
          </DialogTitle>
          <DialogDescription>{t("creditAllocationDescription")}</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          {loading ? (
            <p>{tc("loading")}</p>
          ) : loadError ? (
            <div role="alert" className="text-destructive text-sm">
              {t("creditBalanceLoadFailed")}
              <Button variant="ghost" onClick={load} disabled={locked}>
                {t("creditRetry")}
              </Button>
            </div>
          ) : (
            <div className="text-sm space-y-1">
              <p>{t("creditTenantBalance", { balance: (tenantBalance ?? 0).toFixed(2) })}</p>
              <p>
                {userBalance === null
                  ? t("creditSharedPool")
                  : t("creditUserBalance", { balance: userBalance.toFixed(2) })}
              </p>
            </div>
          )}
          <div>
            <Label htmlFor="user-credit-amount">{t("creditAmount")}</Label>
            <Input
              id="user-credit-amount"
              type="number"
              min="0.01"
              step="0.01"
              max={tenantBalance ?? undefined}
              value={amount}
              disabled={locked}
              onChange={(e) => setAmount(e.target.value)}
            />
            {amount && parsed === null && !loading && (
              <p className="text-destructive text-xs mt-1">{t("creditInvalidAmount")}</p>
            )}
          </div>
          <div>
            <Label htmlFor="user-credit-note">{t("creditNote")}</Label>
            <Input
              id="user-credit-note"
              value={note}
              maxLength={500}
              disabled={locked}
              onChange={(e) => setNote(e.target.value)}
            />
          </div>
          {uncertain && (
            <p role="alert" className="text-sm text-destructive">
              {t("creditAllocationUncertain")}
            </p>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={locked}>
            {tc("cancel")}
          </Button>
          <Button
            onClick={submit}
            disabled={submitting || (!uncertain && (loading || loadError || parsed === null))}
          >
            {submitting
              ? t("creditAllocating")
              : uncertain
                ? t("creditRetry")
                : t("creditConfirmAllocation")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
