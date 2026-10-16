# Optional unified identity client

`OIDC_ENABLED=false` preserves legacy username/password and phone login. Enable only after the identity account and protocol migrations, static confidential client registration and HTTPS proxy configuration are ready. In OIDC mode, legacy `/api/user/login`, `/api/user/phone` and `/api/user/register` return 410 so authentication/account creation cannot bypass the center. Account profile and verified phone-change settings still use the existing shared RAgent account authority; the central phone UI obtains CloudBase proof directly and never needs the disabled legacy login endpoints. This change does not configure or deploy a running identity center.

## Runtime configuration

Set `OIDC_ISSUER`, `OIDC_CLIENT_ID`, an independent `OIDC_CLIENT_SECRET` (at least 32 characters), exact `OIDC_REDIRECT_URI` ending `/api/auth/oidc/callback`, and `OIDC_TRANSACTION_KEY` (32 random bytes encoded as 64 hex characters, separate from JWT_SECRET and client secret). These are server runtime settings, never NEXT_PUBLIC variables. Production requires HTTPS. `NODE_ENV=test` and the explicit `OIDC_ALLOW_INSECURE_TEST_HTTP=true` allow loopback HTTP for fixtures only. For an explicitly enabled local developer instance, `NODE_ENV=development` plus `OIDC_ALLOW_INSECURE_LOCAL_HTTP=true` allow only localhost/127.0.0.1 HTTP issuer and callback; production always rejects HTTP regardless of either switch.

The static issuer client must use `authorization_code`, `code` responses, `client_secret_basic` and the exact callback. `openid-client` 6.8.8 performs discovery, token exchange and claim validation; explicit `enableNonRepudiationChecks` requires JWKS signature verification even over TLS. Authorization, token and JWKS URLs must share the configured issuer origin.

## Browser and BFF flow

The runtime `/api/auth/methods` response selects identity mode. The app clears legacy localStorage credentials before validating its HttpOnly cookie. Unauthenticated visitors redirect through `/api/auth/oidc/start`. Each attempt generates state, nonce and S256 PKCE and stores them in a five-minute AES-GCM encrypted HttpOnly/SameSite=Lax transaction cookie. Only safe local `returnTo` paths are accepted. Parallel login tabs can invalidate an earlier attempt; retry sign-in rather than retaining multiple browser transactions.

The callback validates the proof using the fixed configured callback, maps verified `sub` through `identity_subjects` to an active `users` row and creates a RAgent-only JWT. It neither creates an account nor trusts a client asserted user ID. JWT and cookie lifetime are capped by ID-token expiry, token response lifetime and one hour. `/api/user/me` cookie synchronization cannot extend JWT expiry. OIDC access/ID/refresh tokens are never returned to browser JavaScript or saved in localStorage. No OIDC token is accepted in callback URLs.

Only while OIDC is enabled, middleware copies the existing host-only session cookie into the Bearer request header for legacy Next API proxies. It makes no resource permission decision. Existing tenant/role/ownership policies remain authoritative; a pending user remains pending. This transport bridge is excluded from `/api/auth/*`. Browser upload prechecks recognize cookie mode rather than requiring a localStorage token.

`POST /api/auth/logout` clears the local HttpOnly cookie after same-origin validation. Logout clears old localStorage/caches and shows an explicit sign-in action instead of silently signing back in through the center. This is local logout, not global center/client revocation. New OIDC sessions expire within the validated bounds; no promise of instant global logout is made.

## Existing login UI at the center

`/identity-login?uid=...` reuses `components/login-page.tsx`, including original password/SMS/register layout and CloudBase SDK. The route bypasses the app AuthGate and layout. It obtains CSRF and the public CloudBase environment from same-origin `GET /interaction/{uid}/context`. Password, verified phone token and registration are URL-encoded POSTs to the issuer interaction endpoint with CSRF, browser Origin and `Accept: application/json`. Successful same-origin issuer resume URLs cause top-level navigation. This mode never calls legacy finishLogin, sets a local JWT or stores a RAgent token. Machine bridge credentials stay exclusively in the issuer.

Set the identity provider `IDENTITY_INTERACTION_UI_PATH=/identity-login`. At the **same issuer host**, proxy `/identity-login`, `/_next/*`, `/api/system` (public branding), required `/api/oss/system/*` logo paths and favicon assets plus `/forgot-password`, `/reset-password` and the existing password-reset service routes to this Next frontend; keep `/interaction/*`, `/auth/*`, `/token`, discovery/JWKS and protocol endpoints on the Node issuer. Do not proxy app auth callbacks to the issuer. Branding requests need access to the app database as before. Existing custom branding HTML/assets need their explicit public proxy routes; do not broadly proxy business APIs.

## Verification

Targeted tests cover encrypted transaction expiry/tamper rejection, safe return paths, active subject mapping, default-off errors, bounded cookie/JWT expiry, cookie transport, URL-encoded CSRF interaction, identical legacy/central component markup and real openid-client HTTP/JWKS validation of signature, issuer, audience, nonce, state and expiry. Component fixtures mock external hooks and CloudBase; they do not send SMS. Full browser cross-domain/TLS/Safari and production account flows require separate environment acceptance.

Official API references: https://github.com/panva/openid-client/tree/v6.8.8 and https://github.com/panva/openid-client/blob/v6.8.8/examples/oauth.ts .
