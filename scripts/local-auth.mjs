import { spawnSync } from "node:child_process";
import { generateKeyPairSync, randomBytes } from "node:crypto";
import { existsSync, lstatSync, mkdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const dir = join(root, ".local/auth");
const secret = () => randomBytes(32).toString("hex");
const write = (base, name, value) =>
  writeFileSync(join(base, name), value, { mode: 0o600, flag: "wx" });
function bridgeOrigin(value) {
  const url = new URL(value);
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== "/"
  )
    throw Error();
  if (
    url.protocol === "http:" &&
    !["host.docker.internal", "127.0.0.1", "localhost", "[::1]"].includes(url.hostname)
  )
    throw Error();
  if (["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)) throw Error();
  return url.origin;
}
function init() {
  if (existsSync(dir)) {
    const stat = lstatSync(dir);
    if (!stat.isDirectory() || stat.isSymbolicLink() || stat.mode & 0o077) throw Error();
    if (
      !["runtime.json", "postgres-password", "frontend.env", "compose.env"].every((name) =>
        existsSync(join(dir, name))
      )
    )
      throw Error();
    console.log("Local auth configuration already exists; left unchanged.");
    return;
  }
  const bridge = bridgeOrigin(process.env.AUTH_BRIDGE_URL);
  const token = process.env.AUTH_BRIDGE_TOKEN;
  if (
    !token ||
    token.length < 32 ||
    [...token].some((char) => char.charCodeAt(0) <= 32 || char.charCodeAt(0) === 127)
  )
    throw Error();
  const port = process.env.AUTH_PORT || "8021";
  if (!/^\d+$/.test(port) || +port < 1024 || +port > 65535) throw Error();
  const cloudbase = process.env.AUTH_CLOUDBASE_ENV_ID || "";
  if (cloudbase && !/^[a-z0-9-]+$/i.test(cloudbase)) throw Error();
  const password = secret(),
    client = secret();
  const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const jwk = {
    ...privateKey.export({ format: "jwk" }),
    kid: randomBytes(16).toString("hex"),
    use: "sig",
    alg: "RS256",
  };
  const issuer = `http://127.0.0.1:${port}`;
  const callback = "http://127.0.0.1:3000/api/auth/oidc/callback";
  const runtime = {
    NODE_ENV: "development",
    IDENTITY_ENABLED: "true",
    IDENTITY_BIND_HOST: "0.0.0.0",
    IDENTITY_PORT: "8020",
    IDENTITY_ISSUER: issuer,
    IDENTITY_ACCOUNT_BASE_URL: bridge,
    IDENTITY_SERVICE_TOKEN: token,
    IDENTITY_COOKIE_KEYS: JSON.stringify([secret(), secret()]),
    IDENTITY_JWKS: JSON.stringify({ keys: [jwk] }),
    IDENTITY_CLIENTS: JSON.stringify([
      {
        client_id: "ragent-local",
        client_secret: client,
        redirect_uris: [callback],
      },
    ]),
    IDENTITY_DATABASE_URL: `postgresql://auth:${password}@auth-db:5432/auth_protocol`,
    IDENTITY_INTERACTION_UI_PATH: "/identity-login",
    CLOUDBASE_ENV_ID: cloudbase,
  };
  mkdirSync(join(root, ".local"), { recursive: true, mode: 0o700 });
  const staging = join(root, `.local/auth-init-${randomBytes(8).toString("hex")}`);
  mkdirSync(staging, { mode: 0o700 });
  try {
    write(staging, "runtime.json", `${JSON.stringify(runtime, null, 2)}\n`);
    write(staging, "postgres-password", `${password}\n`);
    write(staging, "compose.env", `AUTH_PORT=${port}\n`);
    write(
      staging,
      "frontend.env",
      `# Merge explicitly into your frontend environment; contains secrets.\nOIDC_ENABLED=true\nOIDC_ISSUER=${issuer}\nOIDC_CLIENT_ID=ragent-local\nOIDC_CLIENT_SECRET=${client}\nOIDC_REDIRECT_URI=${callback}\nOIDC_TRANSACTION_KEY=${secret()}\nOIDC_ALLOW_INSECURE_LOCAL_HTTP=true\n`
    );
    renameSync(staging, dir);
  } finally {
    rmSync(staging, { recursive: true, force: true });
  }
  console.log(
    "Created protected .local/auth configuration. Merge frontend.env explicitly, then restart the frontend."
  );
}
function compose(command) {
  if (!existsSync(join(dir, "compose.env"))) throw Error();
  const args = {
    up: ["up", "-d", "--wait"],
    down: ["down"],
    logs: ["logs", "--tail", "100", "-f"],
    status: ["ps"],
  }[command];
  if (!args) throw Error();
  const result = spawnSync(
    "docker",
    [
      "compose",
      "--project-name",
      "ragent-public-auth",
      "--env-file",
      join(dir, "compose.env"),
      "-f",
      join(root, "docker/compose.auth.yml"),
      ...args,
    ],
    { stdio: "inherit", cwd: root }
  );
  if (result.error) throw Error();
  process.exitCode = result.status ?? 1;
}
try {
  const command = process.argv[2];
  if (command === "init") init();
  else compose(command);
} catch {
  console.error(
    "Local auth command failed. Check Docker, protected configuration, and AUTH_BRIDGE_URL / AUTH_BRIDGE_TOKEN (matching the existing bridge, >=32 characters). Never paste secrets into reports."
  );
  process.exitCode = 1;
}
