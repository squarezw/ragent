import type { NextApiRequest, NextApiResponse } from "next";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import pool from "@/lib/db";
import { setAuthCookie } from "@/lib/auth";
import { verifyCloudbasePhone } from "@/lib/cloudbaseIdentity";
import { requireEnv } from "@/lib/env";
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "POST") return res.status(405).end();
  try {
    const { mode, password, username } = req.body || {};
    if (!["register", "login", "verify"].includes(mode))
      return res.status(400).json({ errorCode: "INVALID_MODE" });
    if (
      mode === "register" &&
      (typeof username !== "string" || !/^[A-Za-z0-9_]{3,32}$/.test(username))
    )
      return res.status(400).json({ errorCode: "INVALID_USERNAME" });
    const identity = await verifyCloudbasePhone(req.body.accessToken);
    if (mode === "verify") return res.json({ verified: true });
    if (mode === "register" && (typeof password !== "string" || password.length < 6))
      return res.status(400).json({ errorCode: "PASSWORD_LENGTH" });
    if (mode === "register" && Buffer.byteLength(password) > 72)
      return res.status(400).json({ errorCode: "PASSWORD_TOO_LONG" });
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      // Serialize same-phone registration, including against legacy account conflicts.
      await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [identity.phone]);
      let result = await client.query(
        `SELECT u.* FROM users u JOIN user_phone_identities i ON i.user_id=u.id WHERE i.environment=$1 AND i.subject=$2 AND i.phone=$3`,
        [identity.env, identity.uid, identity.phone]
      );
      if (mode === "register") {
        const exists = await client.query(
          "SELECT id FROM users WHERE phone=$1 OR phone=$2 OR username=$3 OR username=$1 OR username=$2 OR phone=$3",
          [identity.phone, `+86${identity.phone}`, username]
        );
        if (result.rowCount || exists.rowCount) throw new Error("PHONE_ALREADY_REGISTERED");
        const hash = await bcrypt.hash(password, 12);
        result = await client.query(
          `INSERT INTO users (username,nickname,password,phone,email,tenant_id,dept_id,status,created_at,updated_at) VALUES ($1,$1,$2,$3,NULL,NULL,NULL,'active',NOW(),NOW()) RETURNING *`,
          [username, hash, identity.phone]
        );
        await client.query("INSERT INTO user_roles (user_id,role_id) VALUES ($1,4)", [
          result.rows[0].id,
        ]);
        await client.query(
          "INSERT INTO user_phone_identities (user_id,environment,subject,phone) VALUES ($1,$2,$3,$4)",
          [result.rows[0].id, identity.env, identity.uid, identity.phone]
        );
      }
      if (!result.rowCount && mode === "login") {
        // The upstream identity proves phone ownership; never accept a client-declared phone.
        // Existing accounts keep their original username, password, role and tenant.
        const legacy = await client.query(
          "SELECT id, status FROM users WHERE regexp_replace(COALESCE(phone,''),'[[:space:]]','','g') IN ($1,$2) FOR UPDATE",
          [identity.phone, `+86${identity.phone}`]
        );
        if (legacy.rowCount && legacy.rowCount > 1) throw new Error("PHONE_ACCOUNT_AMBIGUOUS");
        if (legacy.rowCount === 1) {
          const existingUser = legacy.rows[0];
          if (existingUser.status !== "active") throw new Error("ACCOUNT_DISABLED");
          const bindings = await client.query(
            "SELECT user_id FROM user_phone_identities WHERE user_id=$1 OR phone=$2 OR (environment=$3 AND subject=$4) FOR UPDATE",
            [existingUser.id, identity.phone, identity.env, identity.uid]
          );
          if (bindings.rowCount) throw new Error("PHONE_IDENTITY_CONFLICT");
          await client.query(
            "INSERT INTO user_phone_identities (user_id,environment,subject,phone) VALUES ($1,$2,$3,$4)",
            [existingUser.id, identity.env, identity.uid, identity.phone]
          );
          result = legacy;
        }
      }
      if (!result.rowCount) throw new Error("PHONE_NOT_REGISTERED");
      const user = result.rows[0];
      if (user.status !== "active") throw new Error("ACCOUNT_DISABLED");
      const token = jwt.sign({ userId: user.id }, requireEnv("JWT_SECRET"), { expiresIn: "7d" });
      await client.query("COMMIT");
      setAuthCookie(res, token);
      return res.status(mode === "register" ? 201 : 200).json({ token });
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  } catch (error) {
    const databaseCode = (error as { code?: string } | null)?.code;
    const code =
      databaseCode === "42P01"
        ? "AUTH_SCHEMA_NOT_READY"
        : databaseCode === "23505"
          ? req.body?.mode === "login"
            ? "PHONE_IDENTITY_CONFLICT"
            : "PHONE_ALREADY_REGISTERED"
          : error instanceof Error
            ? error.message
            : "AUTH_UNAVAILABLE";
    const known = [
      "INVALID_CREDENTIALS",
      "PHONE_IDENTITY_REQUIRED",
      "PHONE_ALREADY_REGISTERED",
      "PHONE_NOT_REGISTERED",
      "ACCOUNT_DISABLED",
      "PHONE_ACCOUNT_AMBIGUOUS",
      "PHONE_IDENTITY_CONFLICT",
      "AUTH_SCHEMA_NOT_READY",
    ];
    return res
      .status(
        code === "AUTH_SCHEMA_NOT_READY"
          ? 503
          : code === "PHONE_ALREADY_REGISTERED"
            ? 409
            : known.includes(code)
              ? 403
              : 503
      )
      .json({ errorCode: known.includes(code) ? code : "AUTH_UNAVAILABLE" });
  }
}
