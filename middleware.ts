import { workspaceRoutePolicy } from "./lib/workspaceRoutePolicy";
import { LOCAL_LOGOUT_COOKIE } from "./lib/localLogout";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { defaultLocale, locales, type Locale } from "./i18n/config";

const LOCALE_COOKIE = "locale";

export function middleware(request: NextRequest) {
  const headers = new Headers(request.headers);
  const signedOut = process.env.OIDC_ENABLED === "true" && Boolean(request.cookies.get(LOCAL_LOGOUT_COOKIE)?.value);
  const token = signedOut ? undefined : request.cookies.get("ragent_token")?.value;
  if (signedOut) {
    headers.delete("authorization");
    const cookies = (headers.get("cookie") || "").split(";").filter((cookie) => cookie.trim().split("=", 1)[0] !== "ragent_token");
    headers.set("cookie", cookies.join(";"));
  }
  if (
    process.env.OIDC_ENABLED === "true" &&
    request.nextUrl.pathname.startsWith("/api/") &&
    !request.nextUrl.pathname.startsWith("/api/auth/") &&
    token
  ) {
    headers.set("authorization", `Bearer ${token}`);
  }
  if (process.env.WORKSPACE_TENANT_ENABLED === "true" && request.nextUrl.pathname.startsWith("/api/")) {
    const policy = workspaceRoutePolicy(request.nextUrl.pathname);
    if (policy === "blocked") return NextResponse.json({ detail: { code: "WORKSPACE_ROUTE_NOT_READY" } }, { status: 501 });
    if (policy === "covered") {
      const header = headers.get("x-workspace-tenant-id");
      const query = request.nextUrl.searchParams.get("workspace_tenant_id");
      if (header && query && header !== query) return NextResponse.json({ detail: { code: "WORKSPACE_TENANT_INVALID" } }, { status: 403 });
      const selected = header || query;
      if (!selected || !/^[1-9]\d*$/.test(selected)) return NextResponse.json({ detail: { code: "WORKSPACE_TENANT_REQUIRED" } }, { status: 409 });
      headers.set("x-workspace-tenant-id", selected);
    }
  }
  const response = NextResponse.next({ request: { headers } });
  if (process.env.WORKSPACE_TENANT_ENABLED === "true" && request.nextUrl.pathname.startsWith("/api/")) {
    response.headers.set("Cache-Control", "private, no-store");
    response.headers.set("Vary", "X-Workspace-Tenant-ID, Authorization, Cookie");
  }

  // Check if locale cookie exists
  const localeCookie = request.cookies.get(LOCALE_COOKIE)?.value as Locale | undefined;

  if (!localeCookie || !locales.includes(localeCookie)) {
    // Set default locale from Accept-Language header or fallback to default
    const acceptLanguage = request.headers.get("accept-language");
    let detectedLocale: Locale = defaultLocale;

    if (acceptLanguage) {
      const preferredLocale = acceptLanguage
        .split(",")
        .map((lang) => lang.split(";")[0].trim())
        .find((lang) => {
          // Match exact locale or language prefix
          if (locales.includes(lang as Locale)) return true;
          const langPrefix = lang.split("-")[0];
          return locales.some((l) => l.startsWith(langPrefix));
        });

      if (preferredLocale) {
        const exactMatch = locales.find((l) => l === preferredLocale);
        const prefixMatch = locales.find((l) => l.startsWith(preferredLocale.split("-")[0]));
        detectedLocale = (exactMatch || prefixMatch) as Locale;
      }
    }

    response.cookies.set(LOCALE_COOKIE, detectedLocale, {
      path: "/",
      maxAge: 60 * 60 * 24 * 365, // 1 year
      sameSite: "lax",
    });
  }

  return response;
}

export const config = {
  matcher: ["/api/:path*", "/((?!api|_next|.*\\..*).*)"],
};
