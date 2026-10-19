import {
  rmSync,
  mkdtempSync,
  mkdirSync,
  copyFileSync,
  readFileSync,
  writeFileSync,
  statSync,
  existsSync,
  readdirSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import assert from "node:assert/strict";
const root = mkdtempSync(join(tmpdir(), "public-auth-check-"));
mkdirSync(join(root, "scripts"));
mkdirSync(join(root, "docker"));
copyFileSync(
  new URL("../scripts/local-auth.mjs", import.meta.url),
  join(root, "scripts/local-auth.mjs")
);
const token = `bridge-fixture-${"a".repeat(40)}`;
const run = (extra = {}) =>
  spawnSync(process.execPath, [join(root, "scripts/local-auth.mjs"), "init"], {
    env: {
      ...process.env,
      AUTH_BRIDGE_URL: "http://host.docker.internal:19022",
      AUTH_BRIDGE_TOKEN: token,
      AUTH_PORT: "18021",
      ...extra,
    },
    encoding: "utf8",
  });
for (const extra of [
  { AUTH_BRIDGE_TOKEN: "" },
  { AUTH_BRIDGE_URL: "http://localhost:9022" },
  { AUTH_BRIDGE_URL: "https://example.com/path" },
  { AUTH_PORT: "1" },
  { AUTH_PORT: "abc" },
  { AUTH_BRIDGE_TOKEN: `${"a".repeat(32)}\n` },
]) {
  assert.notEqual(run(extra).status, 0);
  assert(!existsSync(join(root, ".local/auth")));
}
writeFileSync(join(root, ".env"), "DO_NOT_CHANGE=1\n");
writeFileSync(join(root, ".env.local"), "DO_NOT_CHANGE=2\n");
const first = run();
assert.equal(first.status, 0);
assert(!first.stdout.includes(token));
assert(!first.stderr.includes(token));
const dir = join(root, ".local/auth");
assert.equal(statSync(dir).mode & 0o777, 0o700);
const before = Object.fromEntries(
  readdirSync(dir).map((n) => [n, readFileSync(join(dir, n), "utf8")])
);
for (const name of Object.keys(before)) assert.equal(statSync(join(dir, name)).mode & 0o777, 0o600);
assert.equal(run({ AUTH_BRIDGE_TOKEN: `changed-${"x".repeat(40)}` }).status, 0);
for (const [name, value] of Object.entries(before))
  assert.equal(readFileSync(join(dir, name), "utf8"), value);
assert.equal(readFileSync(join(root, ".env"), "utf8"), "DO_NOT_CHANGE=1\n");
assert.equal(readFileSync(join(root, ".env.local"), "utf8"), "DO_NOT_CHANGE=2\n");
const runtime = JSON.parse(before["runtime.json"]);
const client = JSON.parse(runtime.IDENTITY_CLIENTS)[0];
assert.equal(runtime.IDENTITY_ISSUER, "http://127.0.0.1:18021");
assert.equal(client.redirect_uris[0], "http://127.0.0.1:3000/api/auth/oidc/callback");
const secrets = [
  token,
  ...JSON.parse(runtime.IDENTITY_COOKIE_KEYS),
  client.client_secret,
  before["postgres-password"].trim(),
  before["frontend.env"].match(/OIDC_TRANSACTION_KEY=(.+)/)[1],
];
assert.equal(new Set(secrets).size, secrets.length);
assert.equal(JSON.parse(runtime.IDENTITY_JWKS).keys[0].kty, "RSA");
console.log(
  "PASS: 6 invalid cases, secret uniqueness, protected permissions, idempotence, env preservation, no secret output, issuer/client overlay consistency"
);

rmSync(root, { recursive: true, force: true });
