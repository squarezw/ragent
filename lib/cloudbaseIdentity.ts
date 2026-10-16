export function normalizePhone(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const phone = value.replace(/\s/g, "");
  return /^(?:\+86)?1\d{10}$/.test(phone) ? phone.replace(/^\+86/, "") : null;
}
export async function verifyCloudbasePhone(accessToken: unknown) {
  const env = process.env.CLOUDBASE_ENV_ID;
  if (!env || !/^[a-z0-9-]+$/i.test(env)) throw new Error("AUTH_UNAVAILABLE");
  if (typeof accessToken !== "string" || accessToken.length > 8192 || !accessToken)
    throw new Error("INVALID_CREDENTIALS");
  const response = await fetch(`https://${env}.api.tcloudbasegateway.com/auth/v1/user/me`, {
    headers: { Authorization: `Bearer ${accessToken}` },
    signal: AbortSignal.timeout(10000),
    redirect: "error",
  });
  if (!response.ok)
    throw new Error(response.status < 500 ? "INVALID_CREDENTIALS" : "AUTH_UNAVAILABLE");
  const profile = await response.json();
  const phone = normalizePhone(profile.phone_number);
  if (!phone || typeof profile.sub !== "string" || !profile.sub || profile.sub.length > 64)
    throw new Error("PHONE_IDENTITY_REQUIRED");
  return { phone, uid: profile.sub, env };
}
