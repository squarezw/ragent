import { readFileSync } from "node:fs";

try {
  const values = JSON.parse(readFileSync("/run/auth/runtime.json", "utf8"));
  if (Object.values(values).some((value) => typeof value !== "string")) throw Error();
  Object.assign(process.env, values);
  process.setgid(1000);
  process.setuid(1000);
  await import(process.argv[2] === "migrate" ? "/app/scripts/migrate.js" : "/app/src/main.js");
} catch {
  console.error("Auth initialization failed; check protected configuration.");
  process.exitCode = 1;
}
