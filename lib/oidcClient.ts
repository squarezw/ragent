import * as oidc from "openid-client";
import {
  readOidcSettings,
  sealTransaction,
  openTransaction,
  localSessionTtl,
  safeReturnTo,
} from "./oidcPolicy";
export {
  readOidcSettings,
  TRANSACTION_COOKIE,
  TRANSACTION_PATH,
  TRANSACTION_TTL,
} from "./oidcPolicy";
export async function oidcConfiguration(
  settings: NonNullable<ReturnType<typeof readOidcSettings>>
) {
  const config = await oidc.discovery(
    new URL(settings.issuer),
    settings.clientId,
    { token_endpoint_auth_method: "client_secret_basic" },
    oidc.ClientSecretBasic(settings.secret),
    {
      execute: [
        ...(settings.testHttp ? [oidc.allowInsecureRequests] : []),
        oidc.enableNonRepudiationChecks,
      ],
      timeout: 5,
    }
  );
  const metadata = config.serverMetadata();
  for (const name of ["authorization_endpoint", "token_endpoint", "jwks_uri"] as const) {
    const url = new URL(metadata[name]!);
    if (url.origin !== new URL(settings.issuer).origin)
      throw Error("OIDC endpoints must remain on configured issuer");
  }
  return config;
}
export async function startOidc(
  settings: NonNullable<ReturnType<typeof readOidcSettings>>,
  returnTo: unknown
) {
  const config = await oidcConfiguration(settings);
  const verifier = oidc.randomPKCECodeVerifier();
  const state = oidc.randomState();
  const nonce = oidc.randomNonce();
  const transaction = {
    verifier,
    state,
    nonce,
    returnTo: safeReturnTo(returnTo),
    createdAt: Math.floor(Date.now() / 1000),
  };
  const url = oidc.buildAuthorizationUrl(config, {
    redirect_uri: settings.redirectUri,
    response_type: "code",
    scope: "openid profile",
    code_challenge: await oidc.calculatePKCECodeChallenge(verifier),
    code_challenge_method: "S256",
    state,
    nonce,
  });
  return { redirectTo: url.href, cookie: sealTransaction(transaction, settings.transactionKey) };
}
export async function completeOidc(
  settings: NonNullable<ReturnType<typeof readOidcSettings>>,
  query: string,
  cookie: string
) {
  const transaction = openTransaction(cookie, settings.transactionKey);
  const current = new URL(settings.redirectUri);
  current.search = query;
  if (current.searchParams.has("access_token") || current.searchParams.has("id_token"))
    throw Error("URL tokens forbidden");
  const config = await oidcConfiguration(settings);
  const tokens = await oidc.authorizationCodeGrant(config, current, {
    pkceCodeVerifier: transaction.verifier,
    expectedState: transaction.state,
    expectedNonce: transaction.nonce,
    idTokenExpected: true,
  });
  const claims = tokens.claims();
  if (!claims || typeof claims.sub !== "string" || !claims.sub)
    throw Error("Verified subject required");
  return {
    sub: claims.sub,
    ttl: localSessionTtl(claims, tokens.expires_in),
    returnTo: transaction.returnTo,
  };
}
