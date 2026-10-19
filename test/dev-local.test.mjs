import { EventEmitter } from "node:events";
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  readdirSync,
  statSync,
  rmSync,
  existsSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  configure,
  loadEnvironment,
  mergeText,
  startFrontend,
  requireFreeFrontend,
  checkAuthPort,
} from "../scripts/dev-local.mjs";
const overlay = {
  OIDC_ENABLED: "true",
  OIDC_ISSUER: "http://127.0.0.1:8021",
  OIDC_CLIENT_ID: "fixture",
  OIDC_CLIENT_SECRET: "fixture-client-secret-".repeat(2),
  OIDC_REDIRECT_URI: "http://127.0.0.1:3000/api/auth/oidc/callback",
  OIDC_TRANSACTION_KEY: "a".repeat(64),
  OIDC_ALLOW_INSECURE_LOCAL_HTTP: "true",
};
const basic = {
  ONLYOFFICE_JWT_SECRET: "fixture-onlyoffice",
  DATABASE_URL: "postgresql://fixture",
  JWT_SECRET: "fixture # quoted secret",
  EXTERNAL_API_BASE_URL: "http://127.0.0.1:8010",
};
function fixture() {
  const dir = mkdtempSync(join(tmpdir(), "dev-local-test-"));
  mkdirSync(join(dir, ".local/auth"), { recursive: true });
  writeFileSync(
    join(dir, ".local/auth/frontend.env"),
    Object.entries(overlay)
      .map(([k, v]) => `${k}=${v}`)
      .join("\n")
  );
  return dir;
}
test("precedence, quoted secrets, backup, unrelated keys, idempotence, no bridge reset", async () => {
  const dir = fixture();
  try {
    writeFileSync(
      join(dir, ".env"),
      'DATABASE_URL=postgresql://base\nJWT_SECRET="secret # spaces"\nEXTERNAL_API_BASE_URL=http://base\nONLYOFFICE_JWT_SECRET=fixture-onlyoffice\n'
    );
    writeFileSync(
      join(dir, ".env.local"),
      '# preserve\nOTHER="unchanged # value"\nEXTERNAL_API_BASE_URL=http://local\n'
    );
    let init = 0;
    const runInit = () => init++;
    const env = await configure(
      dir,
      {},
      () => {
        throw Error("unexpected prompt");
      },
      runInit
    );
    assert.equal(env.JWT_SECRET, "secret # spaces");
    assert.equal(env.EXTERNAL_API_BASE_URL, "http://local");
    assert.equal(env.NEXT_DEV_DIST_DIR, ".next-local");
    const first = readFileSync(join(dir, ".env.local"), "utf8");
    assert(first.includes('# preserve\nOTHER="unchanged # value"'));
    assert.equal(statSync(join(dir, ".env.local")).mode & 0o777, 0o600);
    const backupDir = join(dir, ".local/env-backups");
    assert.equal(readdirSync(backupDir).length, 1);
    assert.equal(statSync(join(backupDir, readdirSync(backupDir)[0])).mode & 0o777, 0o600);
    await configure(dir, {}, null, runInit);
    assert.equal(readFileSync(join(dir, ".env.local"), "utf8"), first);
    assert.equal(readdirSync(backupDir).length, 1);
    assert.equal(init, 2);
    assert.equal(
      loadEnvironment(dir, { JWT_SECRET: "process priority" }).JWT_SECRET,
      "process priority"
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
test("missing non-TTY values fail safely before processes or writes", async () => {
  const dir = fixture();
  try {
    await assert.rejects(
      configure(dir, {}, null, () => {
        throw Error("must not launch");
      }),
      /Missing DATABASE_URL/
    );
    assert(!existsSync(join(dir, ".env.local")));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
test("different enabled issuer is preserved until explicit confirmation", async () => {
  const dir = fixture();
  try {
    writeFileSync(
      join(dir, ".env.local"),
      "OIDC_ENABLED=true\nOIDC_ISSUER=https://auth.example.com\n"
    );
    const original = readFileSync(join(dir, ".env.local"), "utf8");
    await assert.rejects(
      configure(dir, basic, null, () => {}),
      /issuer preserved/
    );
    assert.equal(readFileSync(join(dir, ".env.local"), "utf8"), original);
    await configure(dir, { ...basic, DEV_LOCAL_REPLACE_OIDC: "true" }, null, () => {});
    assert(readFileSync(join(dir, ".env.local"), "utf8").includes(overlay.OIDC_ISSUER));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
test("higher-priority OIDC overrides fail before merge", async () => {
  const dir = fixture();
  try {
    await assert.rejects(
      configure(dir, { ...basic, OIDC_CLIENT_ID: "different" }, null, () => {}),
      /Conflicting OIDC/
    );
    assert(!existsSync(join(dir, ".env.local")));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
test("first-run questions use hidden secrets; bridge secrets never copied to frontend env", async () => {
  const dir = mkdtempSync(join(tmpdir(), "dev-local-first-"));
  try {
    const prompts = [];
    const answers = {
      ...basic,
      AUTH_BRIDGE_URL: "http://host.docker.internal:8022",
      AUTH_BRIDGE_TOKEN: "fixture-token-".repeat(4),
    };
    let initialized = false;
    const env = await configure(
      dir,
      {},
      async (key, hidden) => {
        prompts.push([key, hidden]);
        return answers[key];
      },
      (values) => {
        assert.equal(values.AUTH_BRIDGE_TOKEN, answers.AUTH_BRIDGE_TOKEN);
        initialized = true;
        mkdirSync(join(dir, ".local/auth"), { recursive: true });
        writeFileSync(
          join(dir, ".local/auth/frontend.env"),
          Object.entries(overlay)
            .map(([k, v]) => `${k}=${v}`)
            .join("\n")
        );
      }
    );
    assert(initialized);
    assert(prompts.some(([key, hidden]) => key === "JWT_SECRET" && hidden));
    assert(prompts.some(([key, hidden]) => key === "AUTH_BRIDGE_TOKEN" && hidden));
    assert(!readFileSync(join(dir, ".env.local"), "utf8").includes(answers.AUTH_BRIDGE_TOKEN));
    assert.equal(env.AUTH_BRIDGE_TOKEN, undefined);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
test("merge removes duplicate OIDC entries, retains unrelated comments", () => {
  const merged = mergeText("# hi\nOIDC_ENABLED=false\nexport OIDC_ENABLED=false\nOTHER=yes\n", {
    OIDC_ENABLED: "true",
  });
  assert.equal(merged.match(/OIDC_ENABLED/g).length, 1);
  assert(merged.includes("# hi"));
  assert(merged.includes("OTHER=yes"));
});

test("process stubs: Docker wait precedes Next, Ctrl+C signals only owned child", async () => {
  const calls = [];
  const signals = new EventEmitter();
  const child = new EventEmitter();
  child.kill = (signal) => {
    calls.push(signal);
    queueMicrotask(() => child.emit("close", null, signal));
  };
  const promise = startFrontend(basic, {
    signals,
    runCommand: (_script, command) => calls.push(command),
    spawnNext: (_cmd, args, options) => {
      calls.push("next");
      assert(args.includes("0.0.0.0"));
      assert.equal(options.env, basic);
      return child;
    },
  });
  signals.emit("SIGINT");
  await promise;
  assert.deepEqual(calls, ["up", "next", "SIGINT"]);
  assert.equal(signals.listenerCount("SIGINT"), 0);
});
test("process stubs: Docker failure prevents Next from starting", async () => {
  await assert.rejects(
    startFrontend(basic, {
      runCommand: () => {
        throw Error("fixture docker unavailable");
      },
      spawnNext: () => {
        throw Error("Next must not run");
      },
    }),
    /fixture docker unavailable/
  );
});

test("port stubs reject occupied frontend and unrelated auth, never stop a service", async () => {
  await assert.rejects(
    requireFreeFrontend(async () => false),
    /Port 3000 is occupied/
  );
  await assert.rejects(
    checkAuthPort(overlay, {
      check: async () => false,
      inspect: () => ({ status: 0, stdout: "" }),
    }),
    /occupied by another/
  );
  await checkAuthPort(overlay, {
    check: async () => false,
    inspect: () => ({ status: 0, stdout: "fixture-project-owned-container" }),
  });
});
test("unresolved dotenv references fail with key only; process resolved override accepted", () => {
  const dir = fixture();
  try {
    writeFileSync(join(dir, ".env"), `DATABASE_URL=\${PRIVATE_DATABASE}\n`);
    assert.throws(() => loadEnvironment(dir, {}), /Environment expansion in DATABASE_URL/);
    assert.equal(
      loadEnvironment(dir, { DATABASE_URL: "postgresql://resolved" }).DATABASE_URL,
      "postgresql://resolved"
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
