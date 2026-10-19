import { spawn, spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import {
  existsSync,
  readFileSync,
  lstatSync,
  mkdirSync,
  writeFileSync,
  renameSync,
  chmodSync,
  rmSync,
} from "node:fs";
import { createServer } from "node:net";
import { join, resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import { Writable } from "node:stream";
import { fileURLToPath } from "node:url";
import { parse } from "dotenv";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
export const envFiles = [".env", ".env.development", ".env.local", ".env.development.local"];
export function loadEnvironment(base, inherited = process.env) {
  const values = Object.assign(
    {},
    ...envFiles.map((name) =>
      existsSync(join(base, name)) ? parse(readFileSync(join(base, name))) : {}
    )
  );
  for (const [key, value] of Object.entries(values)) {
    if (inherited[key] !== undefined) continue;
    if (/(?<!\\)\$(?:[A-Za-z_{])/.test(value))
      throw Error(
        `Environment expansion in ${key} is not supported by dev:local. Provide its resolved value or escape literal dollars.`
      );
    values[key] = value.replace(/\\\$/g, "$");
  }
  return { ...values, ...inherited };
}
export function mergeText(text, values) {
  const pending = new Set(Object.keys(values));
  const result = text
    .split(/\r?\n/)
    .filter((line, i, rows) => i !== rows.length - 1 || line !== "")
    .flatMap((line) => {
      const match = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/.exec(line);
      if (!match || !Object.hasOwn(values, match[1])) return [line];
      if (!pending.delete(match[1])) return [];
      return [`${match[1]}=${JSON.stringify(values[match[1]])}`];
    });
  for (const key of pending) result.push(`${key}=${JSON.stringify(values[key])}`);
  return `${result.join("\n")}\n`;
}
export function mergeEnvironment(base, values) {
  const path = join(base, ".env.local");
  if (existsSync(path) && (!lstatSync(path).isFile() || lstatSync(path).isSymbolicLink()))
    throw Error(".env.local must be a regular file.");
  const previous = existsSync(path) ? readFileSync(path, "utf8") : "";
  const next = mergeText(previous, values);
  if (previous === next) return;
  const local = join(base, ".local");
  mkdirSync(local, { recursive: true, mode: 0o700 });
  if (lstatSync(local).isSymbolicLink()) throw Error(".local must not be a symlink.");
  const backups = join(local, "env-backups");
  mkdirSync(backups, { recursive: true, mode: 0o700 });
  if (lstatSync(backups).isSymbolicLink()) throw Error("Backup directory must not be a symlink.");
  chmodSync(backups, 0o700);
  if (existsSync(path)) {
    const backup = join(backups, `env.local-${Date.now()}-${randomBytes(4).toString("hex")}`);
    writeFileSync(backup, previous, { mode: 0o600, flag: "wx" });
  }
  const temporary = join(base, `.env.local-${randomBytes(8).toString("hex")}.tmp`);
  try {
    writeFileSync(temporary, next, { mode: 0o600, flag: "wx" });
    renameSync(temporary, path);
  } finally {
    rmSync(temporary, { force: true });
  }
}
async function available(port) {
  return new Promise((resolveResult) => {
    const server = createServer();
    server.once("error", () => resolveResult(false));
    server.listen(port, "0.0.0.0", () => server.close(() => resolveResult(true)));
  });
}
function execute(script, command, env) {
  const result = spawnSync(process.execPath, [join(root, "scripts", script), command], {
    cwd: root,
    env,
    stdio: "inherit",
  });
  if (result.error || result.status !== 0)
    throw Error(`Local setup command ${command} failed; Next.js was not started.`);
}
export async function configure(
  base,
  inherited = process.env,
  ask = null,
  runInit = (env) => execute("local-auth.mjs", "init", env)
) {
  const env = loadEnvironment(base, inherited);
  const additions = {};
  async function need(key, hidden = false) {
    if (env[key]) return;
    if (!ask)
      throw Error(
        `Missing ${key}. Set it in your environment or run pnpm dev:local in an interactive terminal.`
      );
    const value = await ask(key, hidden);
    if (!value || /[\r\n\0]/.test(value)) throw Error(`Missing or invalid ${key}.`);
    env[key] = value;
    additions[key] = value;
  }
  for (const [key, hidden] of [
    ["DATABASE_URL", true],
    ["JWT_SECRET", true],
    ["ONLYOFFICE_JWT_SECRET", true],
    ["EXTERNAL_API_BASE_URL", false],
  ])
    await need(key, hidden);
  if (!existsSync(join(base, ".local/auth/frontend.env"))) {
    await need("AUTH_BRIDGE_URL");
    await need("AUTH_BRIDGE_TOKEN", true);
  }
  // Bridge configuration belongs only to protected auth runtime, never frontend env.
  delete additions.AUTH_BRIDGE_URL;
  delete additions.AUTH_BRIDGE_TOKEN;
  runInit(env);
  const overlay = parse(readFileSync(join(base, ".local/auth/frontend.env")));
  const allowed = [
    "OIDC_ENABLED",
    "OIDC_ISSUER",
    "OIDC_CLIENT_ID",
    "OIDC_CLIENT_SECRET",
    "OIDC_REDIRECT_URI",
    "OIDC_TRANSACTION_KEY",
    "OIDC_ALLOW_INSECURE_LOCAL_HTTP",
  ];
  if (
    allowed.some((key) => !overlay[key]) ||
    Object.keys(overlay).some((key) => !allowed.includes(key))
  )
    throw Error("Invalid protected auth frontend overlay.");
  if (env.OIDC_ENABLED === "true" && env.OIDC_ISSUER && env.OIDC_ISSUER !== overlay.OIDC_ISSUER) {
    if (env.DEV_LOCAL_REPLACE_OIDC !== "true") {
      if (
        !ask ||
        (await ask(
          "A different enabled OIDC issuer is configured. Type replace to use local Docker auth",
          false
        )) !== "replace"
      )
        throw Error(
          "Existing OIDC issuer preserved. Set DEV_LOCAL_REPLACE_OIDC=true only to explicitly switch to local auth."
        );
    }
  }
  // Process env and development-local values override .env.local in Next.js.
  // Stop before merging if they would silently change the effective local credentials.
  const high = {
    ...(existsSync(join(base, ".env.development.local"))
      ? parse(readFileSync(join(base, ".env.development.local")))
      : {}),
    ...inherited,
  };
  if (allowed.some((key) => high[key] !== undefined && high[key] !== overlay[key]))
    throw Error(
      "Conflicting OIDC value in process environment or .env.development.local. Remove the conflicting override before local setup."
    );
  mergeEnvironment(base, { ...additions, ...overlay });
  const nextEnv = { ...env, ...overlay, NEXT_DEV_DIST_DIR: ".next-local" };
  delete nextEnv.AUTH_BRIDGE_TOKEN;
  delete nextEnv.AUTH_BRIDGE_URL;
  return nextEnv;
}
export async function startFrontend(
  env,
  { runCommand = execute, spawnNext = spawn, signals = process } = {}
) {
  runCommand("local-auth.mjs", "up", env);
  console.log(
    "Local auth ready. Starting frontend at http://127.0.0.1:3000 (Ctrl+C stops only this frontend; Docker auth stays running)."
  );
  const next = spawnNext(
    process.execPath,
    [
      join(root, "node_modules/next/dist/bin/next"),
      "dev",
      "--hostname",
      "0.0.0.0",
      "--port",
      "3000",
    ],
    { cwd: root, env, stdio: "inherit" }
  );
  const stop = () => next.kill("SIGINT");
  signals.on("SIGINT", stop);
  signals.on("SIGTERM", stop);
  next.on("error", () => {
    console.error("Could not start Next.js. Run pnpm install first.");
    process.exitCode = 1;
  });
  await new Promise((resolveDone) =>
    next.once("close", (code, signal) => {
      process.exitCode = signal === "SIGINT" ? 0 : (code ?? 1);
      resolveDone();
    })
  );
  signals.removeListener("SIGINT", stop);
  signals.removeListener("SIGTERM", stop);
}
export async function requireFreeFrontend(check = available) {
  if (!(await check(3000)))
    throw Error(
      "Port 3000 is occupied. Stop that frontend yourself before pnpm dev:local; no process was stopped."
    );
}
export async function checkAuthPort(env, { check = available, inspect = spawnSync } = {}) {
  const port = Number(new URL(env.OIDC_ISSUER).port);
  if (!(await check(port))) {
    const running = inspect(
      "docker",
      [
        "ps",
        "--filter",
        "label=com.docker.compose.project=ragent-public-auth",
        "--filter",
        "label=com.docker.compose.service=auth-proxy",
        "--format",
        "{{.ID}}",
      ],
      { encoding: "utf8" }
    );
    if (running.status !== 0 || !running.stdout.trim())
      throw Error(
        `Auth port ${port} is occupied by another service. Stop it yourself or use the existing matching auth setup.`
      );
  }
}
async function main() {
  let rl,
    muted = false;
  const ask =
    process.stdin.isTTY && process.stdout.isTTY
      ? async (label, hidden) => {
          if (!rl) {
            const output = new Writable({
              write(chunk, _encoding, done) {
                if (!muted) process.stdout.write(chunk);
                done();
              },
            });
            rl = createInterface({ input: process.stdin, output, terminal: true });
            rl.on("SIGINT", () => {
              rl.close();
              process.exit(130);
            });
          }
          process.stdout.write(`${label}${hidden ? " (hidden)" : ""}: `);
          muted = hidden;
          try {
            return await rl.question("");
          } finally {
            muted = false;
            if (hidden) process.stdout.write("\n");
          }
        }
      : null;
  try {
    await requireFreeFrontend();
    const env = await configure(root, process.env, ask);
    rl?.close();
    await checkAuthPort(env);
    await startFrontend(env);
  } finally {
    rl?.close();
  }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
