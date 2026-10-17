let cookieAuth = false;
export function isCookieAuthMode() {
  return cookieAuth;
}
export function setCookieAuthMode(enabled: boolean) {
  cookieAuth = enabled;
  if (enabled && typeof window !== "undefined") {
    localStorage.removeItem("ragent_token");
    localStorage.removeItem("ragent_logged_in");
  }
}

let logoutPending = false;
export function isLogoutPending() { return logoutPending; }
export function setLogoutPending(pending: boolean) { logoutPending = pending; }
