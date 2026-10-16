import type { NextApiRequest, NextApiResponse } from "next";
import pool from "@/lib/db";
import { getUserIdFromRequest } from "@/lib/auth";
import { normalizePhone, verifyCloudbasePhone } from "@/lib/cloudbaseIdentity";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "POST") return res.status(405).end();
  const userId = getUserIdFromRequest(req);
  if (!userId) return res.status(401).json({ errorCode: "UNAUTHORIZED" });
  const body = req.body || {};
  if (
    ["id", "userId", "user_id", "targetId", "targetUserId", "phone"].some((key) =>
      Object.hasOwn(body, key)
    )
  ) {
    return res.status(400).json({ errorCode: "INVALID_PHONE_CHANGE_REQUEST" });
  }
  let failureStage = "verify_identity";
  try {
    const identity = await verifyCloudbasePhone(body.accessToken);
    failureStage = "connect_database";
    const client = await pool.connect();
    try {
      failureStage = "begin_transaction";
      await client.query("BEGIN");
      // Serialize changes to one account without taking a users row lock before phone locks.
      failureStage = "lock_account";
      await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`phone-user:${userId}`]);
      failureStage = "read_current_phone";
      const previous = await client.query("SELECT phone FROM users WHERE id=$1", [userId]);
      if (!previous.rowCount) throw new Error("USER_NOT_FOUND");
      const oldPhone = normalizePhone(previous.rows[0].phone);
      const phoneLocks = Array.from(
        new Set([identity.phone, ...(oldPhone ? [oldPhone] : [])])
      ).sort();
      failureStage = "lock_phone";
      for (const phone of phoneLocks) {
        // Same canonical phone lock used by SMS login and registration.
        await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [phone]);
      }
      failureStage = "lock_current_user";
      const current = await client.query("SELECT id, status FROM users WHERE id=$1 FOR UPDATE", [
        userId,
      ]);
      if (!current.rowCount) throw new Error("USER_NOT_FOUND");
      if (current.rows[0].status !== "active") throw new Error("ACCOUNT_DISABLED");
      failureStage = "check_phone_conflict";
      const occupied = await client.query(
        "SELECT id FROM users WHERE id<>$1 AND (regexp_replace(COALESCE(phone,''),'[[:space:]]','','g') IN ($2,$3) OR username IN ($2,$3))",
        [userId, identity.phone, `+86${identity.phone}`]
      );
      if (occupied.rowCount) throw new Error("PHONE_ALREADY_REGISTERED");
      failureStage = "check_identity_conflict";
      const bindings = await client.query(
        "SELECT user_id FROM user_phone_identities WHERE user_id<>$1 AND (phone=$2 OR (environment=$3 AND subject=$4)) FOR UPDATE",
        [userId, identity.phone, identity.env, identity.uid]
      );
      if (bindings.rowCount) throw new Error("PHONE_IDENTITY_CONFLICT");
      failureStage = "replace_identity";
      await client.query(
        `INSERT INTO user_phone_identities (user_id,environment,subject,phone) VALUES ($1,$2,$3,$4)
         ON CONFLICT (user_id) DO UPDATE SET environment=EXCLUDED.environment,subject=EXCLUDED.subject,phone=EXCLUDED.phone`,
        [userId, identity.env, identity.uid, identity.phone]
      );
      failureStage = "update_phone";
      await client.query("UPDATE users SET phone=$1, updated_at=NOW() WHERE id=$2", [
        identity.phone,
        userId,
      ]);
      failureStage = "commit_transaction";
      await client.query("COMMIT");
      return res.json({ phone: identity.phone });
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  } catch (error) {
    const pgCode = (error as { code?: string } | null)?.code;
    const code =
      pgCode === "58030"
        ? "DB_STORAGE_UNAVAILABLE"
        : pgCode === "23505"
          ? "PHONE_IDENTITY_CONFLICT"
          : pgCode === "42P01"
            ? "AUTH_SCHEMA_NOT_READY"
            : error instanceof Error
              ? error.message
              : "AUTH_UNAVAILABLE";
    const status: Record<string, number> = {
      USER_NOT_FOUND: 404,
      ACCOUNT_DISABLED: 403,
      INVALID_CREDENTIALS: 401,
      PHONE_IDENTITY_REQUIRED: 403,
      PHONE_ALREADY_REGISTERED: 409,
      PHONE_IDENTITY_CONFLICT: 409,
      AUTH_SCHEMA_NOT_READY: 503,
      DB_STORAGE_UNAVAILABLE: 503,
    };
    // Never log the raw exception, SQL parameters, phone, verification code or token.
    const diagnosticCode =
      typeof pgCode === "string" && /^[A-Z0-9]{5}$/.test(pgCode)
        ? pgCode
        : status[code]
          ? code
          : "UNEXPECTED_ERROR";
    console.error("Phone change failed", { errorCode: diagnosticCode, step: failureStage });
    return res
      .status(status[code] || 503)
      .json({ errorCode: status[code] ? code : "AUTH_UNAVAILABLE", failureStage });
  }
}
