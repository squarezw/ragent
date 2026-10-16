"use client";
import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import axios from "@/lib/axios";
import { loadCloudbaseAuth, type VerificationInfo } from "@/lib/cloudbaseClient";

export function PhoneChangeForm({ onChanged }: { onChanged: () => Promise<void> }) {
  const t = useTranslations("settings");
  const [open, setOpen] = useState(false);
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [env, setEnv] = useState<string>();
  const [info, setInfo] = useState<VerificationInfo>();
  const [busy, setBusy] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open) return;
    axios
      .get("/api/user/phone-config")
      .then((response) => {
        setEnv(response.data.envId || undefined);
      })
      .catch(() => setError(t("phoneServiceUnavailable")));
  }, [open, t]);

  useEffect(() => {
    if (!cooldown) return;
    const timer = setTimeout(() => setCooldown(cooldown - 1), 1000);
    return () => clearTimeout(timer);
  }, [cooldown]);

  const errorMessage = (failure: unknown, fallback: string) => {
    const code = (failure as { response?: { data?: { errorCode?: string } } } | null)?.response
      ?.data?.errorCode;
    const keys: Record<string, string> = {
      PHONE_ALREADY_REGISTERED: "phoneOccupied",
      PHONE_IDENTITY_CONFLICT: "phoneBindingConflict",
      INVALID_CREDENTIALS: "phoneVerificationExpired",
      PHONE_IDENTITY_REQUIRED: "phoneVerificationFailed",
      AUTH_SCHEMA_NOT_READY: "phoneServiceUnavailable",
      DB_STORAGE_UNAVAILABLE: "phoneStorageUnavailable",
      AUTH_UNAVAILABLE: "phoneServiceUnavailable",
      ACCOUNT_DISABLED: "phoneAccountDisabled",
      UNAUTHORIZED: "phoneLoginRequired",
    };
    return t((code && keys[code]) || fallback);
  };

  const sendCode = async () => {
    setError("");
    if (!/^1\d{10}$/.test(phone)) {
      setError(t("phoneInvalid"));
      return;
    }
    setBusy(true);
    try {
      const client = await loadCloudbaseAuth(env);
      setInfo(await client.getVerification({ phone_number: `+86 ${phone}` }));
      setCooldown(60);
    } catch (failure) {
      setError(errorMessage(failure, "phoneSendFailed"));
    } finally {
      setBusy(false);
    }
  };

  const confirmChange = async () => {
    setError("");
    if (!info || !/^\d{6}$/.test(code)) {
      setError(t("phoneCodeRequired"));
      return;
    }
    setBusy(true);
    try {
      const client = await loadCloudbaseAuth(env);
      await client.signInWithSms({
        phoneNum: `+86 ${phone}`,
        verificationCode: code,
        verificationInfo: info,
      });
      const { accessToken } = await client.getAccessToken();
      // No target id or client-declared phone: the API uses the current session and verified identity.
      await axios.post("/api/user/change-phone", { accessToken }, { suppressErrorToast: true });
      await client.signOut().catch(() => {});
      setOpen(false);
      setInfo(undefined);
      setPhone("");
      setCode("");
      await onChanged();
    } catch (failure) {
      setError(errorMessage(failure, "phoneChangeFailed"));
    } finally {
      setBusy(false);
    }
  };

  if (!open)
    return (
      <Button
        type="button"
        variant="outline"
        className="mt-2"
        onClick={() => {
          setError("");
          setOpen(true);
        }}
      >
        {t("changePhone")}
      </Button>
    );
  return (
    <div className="mt-3 space-y-3 rounded-lg border p-3">
      <p className="text-sm text-muted-foreground">{t("phoneChangeDescription")}</p>
      <div className="space-y-2">
        <Label htmlFor="new-phone">{t("newPhone")}</Label>
        <Input
          id="new-phone"
          type="tel"
          autoComplete="tel-national"
          inputMode="tel"
          maxLength={11}
          value={phone}
          disabled={busy}
          placeholder={t("phonePlaceholder")}
          onChange={(event) => {
            setPhone(event.target.value);
            setCode("");
            setInfo(undefined);
            setError("");
          }}
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="new-phone-code">{t("phoneCode")}</Label>
        <div className="flex flex-wrap gap-2">
          <Input
            id="new-phone-code"
            className="min-w-0 flex-1"
            autoComplete="one-time-code"
            inputMode="numeric"
            maxLength={6}
            value={code}
            disabled={busy}
            placeholder={t("phoneCodePlaceholder")}
            onChange={(event) => setCode(event.target.value.replace(/\D/g, ""))}
          />
          <Button
            type="button"
            variant="outline"
            disabled={busy || !env || cooldown > 0 || !/^1\d{10}$/.test(phone)}
            onClick={sendCode}
          >
            {cooldown ? t("phoneResendCountdown", { seconds: cooldown }) : t("phoneSendCode")}
          </Button>
        </div>
      </div>
      {!env && (
        <p className="text-sm text-muted-foreground" role="status">
          {t("phoneServiceUnavailable")}
        </p>
      )}
      {error && (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      )}
      <div className="flex gap-2">
        <Button
          type="button"
          onClick={confirmChange}
          disabled={busy || !env || !info || !/^\d{6}$/.test(code)}
        >
          {busy ? t("saving") : t("phoneConfirmChange")}
        </Button>
        <Button
          type="button"
          variant="outline"
          disabled={busy}
          onClick={() => {
            setOpen(false);
            setInfo(undefined);
            setCode("");
          }}
        >
          {t("phoneCancelChange")}
        </Button>
      </div>
    </div>
  );
}
