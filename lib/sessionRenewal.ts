import { getAuthenticatedSession, getSessionGeneration, isCookieAuthMode, isLogoutPending, registerAuthenticatedSession } from "./browserAuthMode";

type RenewalCode = "REAUTHENTICATION_REQUIRED" | "ACCOUNT_CHANGED" | "SESSION_UNAVAILABLE" | "SIGNED_OUT";
export class SessionRenewalError extends Error {
  constructor(public code: RenewalCode) { super(code); this.name = "SessionRenewalError"; }
}
let flight: Promise<void> | null = null;
let cancelFlight: (() => void) | null = null;
let proactiveTimer: ReturnType<typeof setTimeout> | undefined;
let blocked: RenewalCode | null = null;
let lastSuccess = 0;
const codes: RenewalCode[] = ["REAUTHENTICATION_REQUIRED", "ACCOUNT_CHANGED", "SESSION_UNAVAILABLE", "SIGNED_OUT"];
export function notifySessionExpired(code: RenewalCode = "REAUTHENTICATION_REQUIRED") {
  blocked = code;
  if (typeof window !== "undefined" && !isLogoutPending()) window.dispatchEvent(new CustomEvent("auth:session-expired", { detail: { code } }));
}
export function cancelSessionRenewal() {
  clearTimeout(proactiveTimer);
  blocked = "SIGNED_OUT";
  cancelFlight?.();
}
function schedule() {
  clearTimeout(proactiveTimer);
  const session = getAuthenticatedSession();
  if (!session || blocked || isLogoutPending()) return;
  const delay = Math.max(0, session.expiresAt * 1000 - Date.now() - 45_000);
  proactiveTimer = setTimeout(() => { void ensureSessionCurrent().catch(() => {}); }, delay);
}
function run(mode: "silent" | "popup"): Promise<void> {
  if (flight) return flight;
  const session = getAuthenticatedSession();
  if (!isCookieAuthMode() || !session) return Promise.resolve();
  if (isLogoutPending()) return Promise.reject(new SessionRenewalError("SIGNED_OUT"));
  if (mode === "silent" && blocked) return Promise.reject(new SessionRenewalError(blocked));
  const generation = getSessionGeneration();
  const requestId = Array.from(crypto.getRandomValues(new Uint8Array(16)), b => b.toString(16).padStart(2, "0")).join("");
  const url = `/api/auth/oidc/start?mode=${mode}&expectedUserId=${session.userId}&requestId=${requestId}`;
  let frame: HTMLIFrameElement | undefined;
  let popup: Window | null = null;
  let source: Window | null = null;
  let settled = false;
  let completing = false;
  let checkingFailure = false;
  const controller = new AbortController();
  let verificationTimer: ReturnType<typeof setTimeout> | undefined;
  const pending = new Promise<void>((resolve, reject) => {
    const finish = (code?: RenewalCode) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer); clearTimeout(fallbackTimer); clearTimeout(verificationTimer); clearInterval(closedTimer);
      controller.abort();
      window.removeEventListener("message", onMessage);
      frame?.remove(); popup?.close(); cancelFlight = null;
      if (code) {
        if (code !== "SIGNED_OUT") notifySessionExpired(code);
        reject(new SessionRenewalError(code));
      } else { blocked = null; lastSuccess = Date.now(); resolve(); }
    };
    const acceptUser = (user: { id: number; auth_session_expires_at: number }) => {
      if (settled) return;
      if (generation !== getSessionGeneration() || isLogoutPending()) return finish("SIGNED_OUT");
      registerAuthenticatedSession(user);
      window.dispatchEvent(new CustomEvent("auth:session-restored", { detail: { user } }));
      finish();
    };
    const recoverFailure = async (code: RenewalCode) => {
      if (settled || checkingFailure) return;
      if (code === "SIGNED_OUT" || code === "ACCOUNT_CHANGED") return finish(code);
      checkingFailure = true;
      clearTimeout(verificationTimer);
      verificationTimer = setTimeout(() => finish(code), 2_000);
      try {
        // Another tab may already have replaced the shared host cookie. Old expiry is not proof of renewal.
        const response = await fetch("/api/user/me", { credentials: "same-origin", cache: "no-store", signal: controller.signal });
        const user = response.ok ? await response.json() : null;
        if (settled) return;
        if (generation !== getSessionGeneration() || isLogoutPending()) return finish("SIGNED_OUT");
        if (user && user.id !== session.userId) return finish("ACCOUNT_CHANGED");
        if (user && Number.isFinite(user.auth_session_expires_at) && user.auth_session_expires_at > session.expiresAt && user.auth_session_expires_at * 1000 > Date.now() + 45_000) return acceptUser(user);
      } catch { /* Preserve the original recovery reason. */ }
      finish(code);
    };
    const onMessage = async (event: MessageEvent) => {
      if (settled || completing || event.origin !== window.location.origin || event.source !== source ||
        event.data?.type !== "ragent:session-renewal" || event.data.requestId !== requestId || typeof event.data.ok !== "boolean") return;
      completing = true;
      verificationTimer = setTimeout(() => finish("SESSION_UNAVAILABLE"), 3_000);
      if (generation !== getSessionGeneration() || isLogoutPending()) return finish("SIGNED_OUT");
      if (!event.data.ok) return recoverFailure(codes.includes(event.data.errorCode) ? event.data.errorCode : "SESSION_UNAVAILABLE");
      try {
        // Native fetch avoids recursively entering the protected axios interceptor.
        const response = await fetch("/api/user/me", { credentials: "same-origin", cache: "no-store", signal: controller.signal });
        if (settled) return;
        if (!response.ok) return recoverFailure(response.status === 401 || response.status === 403 ? "REAUTHENTICATION_REQUIRED" : "SESSION_UNAVAILABLE");
        const user = await response.json();
        if (settled) return;
        if (generation !== getSessionGeneration() || isLogoutPending()) return finish("SIGNED_OUT");
        if (user.id !== session.userId) return finish("ACCOUNT_CHANGED");
        if (typeof user.auth_session_expires_at !== "number" || user.auth_session_expires_at * 1000 <= Date.now() + 45_000) return finish("SESSION_UNAVAILABLE");
        acceptUser(user);
      } catch { if (!settled) void recoverFailure("SESSION_UNAVAILABLE"); }
    };
    // Silent renewal is automatic and short; an explicit popup needs time for human password/SMS entry.
    const timer = setTimeout(() => finish("REAUTHENTICATION_REQUIRED"), mode === "silent" ? 15_000 : 240_000);
    const fallbackTimer = mode === "silent" ? setTimeout(() => { void recoverFailure("REAUTHENTICATION_REQUIRED"); }, 13_000) : undefined;
    const closedTimer = setInterval(() => { if (popup?.closed && !completing) void recoverFailure("REAUTHENTICATION_REQUIRED"); }, 250);
    cancelFlight = () => finish("SIGNED_OUT");
    window.addEventListener("message", onMessage);
    if (mode === "popup") {
      popup = window.open(url, "ragent-session-renewal", "popup,width=520,height=720");
      source = popup;
      if (!popup) finish("REAUTHENTICATION_REQUIRED");
    } else {
      frame = document.createElement("iframe");
      frame.hidden = true; frame.title = "Session renewal"; frame.src = url;
      document.body.appendChild(frame); source = frame.contentWindow;
    }
  });
  flight = pending.finally(() => { flight = null; schedule(); });
  return flight;
}
export function ensureSessionCurrent(): Promise<void> {
  const session = getAuthenticatedSession();
  if (!isCookieAuthMode() || !session) return Promise.resolve();
  if (isLogoutPending()) return Promise.reject(new SessionRenewalError("SIGNED_OUT"));
  if (blocked) return Promise.reject(new SessionRenewalError(blocked));
  if (session.expiresAt * 1000 > Date.now() + 45_000) return Promise.resolve();
  return run("silent");
}
export function renewSession(): Promise<void> {
  if (!flight && !blocked && Date.now() - lastSuccess < 5_000) return Promise.resolve();
  return run("silent");
}
// Call directly from a click handler so popup blockers do not turn recovery into a reload.
export function reauthenticateSession(): Promise<void> { return run("popup"); }
if (typeof window !== "undefined") {
  window.addEventListener("auth:session-updated", schedule);
  window.addEventListener("auth:logout-start", cancelSessionRenewal);
  window.addEventListener("auth:logout-failed", () => { blocked = null; schedule(); });
  window.addEventListener("focus", () => { void ensureSessionCurrent().catch(() => {}); });
}
