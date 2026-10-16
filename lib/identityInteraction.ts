export function interactionPath(uid: string) {
  if (!/^[a-zA-Z0-9_-]{1,128}$/.test(uid)) throw Error("Invalid identity interaction");
  return `/interaction/${uid}`;
}
export async function submitIdentityInteraction(
  uid: string,
  csrf: string,
  credentials: Record<string, string>,
  register = false,
  request: (
    input: string,
    init: RequestInit
  ) => Promise<{ ok: boolean; json: () => Promise<any> }> = fetch
) {
  if (!csrf) throw Error("Identity interaction unavailable");
  const response = await request(interactionPath(uid) + (register ? "/register" : ""), {
    method: "POST",
    credentials: "same-origin",
    redirect: "error",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body: new URLSearchParams({ ...credentials, csrf }).toString(),
  });
  const data = await response.json();
  if (!response.ok)
    throw Object.assign(Error("Identity authentication failed"), { response: { data } });
  const path = data.redirectTo;
  if (typeof path !== "string" || /[\\\x00-\x20]/.test(path) || /%2f|%5c/i.test(path))
    throw Error("Invalid identity redirect");
  const origin = typeof window !== "undefined" ? window.location.origin : "https://local.invalid";
  const target = new URL(path, origin);
  if (target.origin !== origin || !target.pathname.startsWith("/auth/"))
    throw Error("Invalid identity redirect");
  return target.pathname + target.search + target.hash;
}
