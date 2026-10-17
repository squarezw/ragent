// Non-credential, host-only logout preference. Only explicit verified sign-in removes it.
export const LOCAL_LOGOUT_COOKIE = "ragent_signed_out";
export const LOCAL_LOGOUT_TTL = 365 * 24 * 60 * 60;
export function isLocallySignedOut(cookies: Record<string, string | undefined> = {}) {
  return process.env.OIDC_ENABLED === "true" && Boolean(cookies[LOCAL_LOGOUT_COOKIE]);
}
export function localLogoutCookie(clear = false, marker = "1") {
  return `${LOCAL_LOGOUT_COOKIE}=${clear ? "" : marker}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${clear ? 0 : LOCAL_LOGOUT_TTL}${process.env.NODE_ENV === "production" ? "; Secure" : ""}`;
}
