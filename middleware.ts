import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { defaultLocale, locales, type Locale } from "./i18n/config";

const LOCALE_COOKIE = "locale";

export function middleware(request: NextRequest) {
  const headers = new Headers(request.headers);
  const token = request.cookies.get("ragent_token")?.value;
  if (
    process.env.OIDC_ENABLED === "true" &&
    request.nextUrl.pathname.startsWith("/api/") &&
    !request.nextUrl.pathname.startsWith("/api/auth/") &&
    token
  ) {
    headers.set("authorization", `Bearer ${token}`);
  }
  const response = NextResponse.next({ request: { headers } });

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
