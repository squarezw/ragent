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
