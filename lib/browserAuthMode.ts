let cookieAuth = false;
let logoutPending = false;
let generation = 0;
let authenticatedSession: { userId: number; expiresAt: number } | null = null;
export function isCookieAuthMode() { return cookieAuth; }
export function setCookieAuthMode(enabled: boolean) {
  cookieAuth = enabled;
  if (!enabled) authenticatedSession = null;
  if (enabled && typeof window !== "undefined") {
    localStorage.removeItem("ragent_token");
    localStorage.removeItem("ragent_logged_in");
  }
}
export function isLogoutPending() { return logoutPending; }
export function setLogoutPending(pending: boolean) {
  if (pending && !logoutPending) ++generation;
  logoutPending = pending;
}
export function getSessionGeneration() { return generation; }
export function getAuthenticatedSession() { return authenticatedSession; }
export function registerAuthenticatedSession(user: { id?: unknown; auth_session_expires_at?: unknown }) {
  if (!cookieAuth || logoutPending || !Number.isSafeInteger(user?.id) || Number(user.id) <= 0 ||
    typeof user.auth_session_expires_at !== "number" || !Number.isFinite(user.auth_session_expires_at)) return;
  if (authenticatedSession && authenticatedSession.userId !== user.id) ++generation;
  authenticatedSession = { userId: Number(user.id), expiresAt: user.auth_session_expires_at };
  if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent("auth:session-updated"));
}
