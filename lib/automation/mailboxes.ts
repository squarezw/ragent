import crypto from "crypto";
import pool from "@/lib/db";
import { getUserTenantId } from "@/lib/tenantMapping";

export type AutomationMailboxInput = {
  name?: string;
  email: string;
  username?: string;
  password: string;
  imapHost: string;
  imapPort?: number;
  imapSecure?: boolean;
  folder?: string;
};

let mailboxInitPromise: Promise<void> | null = null;

async function ensureAutomationMailboxTable() {
  if (mailboxInitPromise) return mailboxInitPromise;

  mailboxInitPromise = pool.query(`
    CREATE TABLE IF NOT EXISTS automation_mailboxes (
      id SERIAL PRIMARY KEY,
      tenant_id INTEGER,
      created_by_user_id INTEGER NOT NULL,
      name VARCHAR(200) NOT NULL,
      email VARCHAR(320) NOT NULL,
      username VARCHAR(320) NOT NULL,
      password_ciphertext TEXT NOT NULL,
      imap_host VARCHAR(255) NOT NULL,
      imap_port INTEGER NOT NULL DEFAULT 993,
      imap_secure BOOLEAN NOT NULL DEFAULT TRUE,
      folder VARCHAR(255) NOT NULL DEFAULT 'INBOX',
      status VARCHAR(20) NOT NULL DEFAULT 'connected',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(created_by_user_id, email)
    );

    CREATE INDEX IF NOT EXISTS idx_automation_mailboxes_owner
      ON automation_mailboxes(created_by_user_id, created_at DESC);
  `).then(() => undefined).catch((error) => {
    mailboxInitPromise = null;
    throw error;
  });

  return mailboxInitPromise;
}

function encryptionKey() {
  const secret = process.env.AUTOMATION_MAILBOX_SECRET || process.env.JWT_SECRET;
  if (!secret) {
    throw new Error("AUTOMATION_MAILBOX_SECRET_MISSING");
  }
  return crypto.createHash("sha256").update(secret).digest();
}

function encryptPassword(value: string) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1:${iv.toString("base64")}:${tag.toString("base64")}:${encrypted.toString("base64")}`;
}

function decryptPassword(value: string) {
  const [version, ivText, tagText, encryptedText] = String(value || "").split(":");
  if (version !== "v1" || !ivText || !tagText || !encryptedText) {
    throw new Error("MAILBOX_CREDENTIAL_INVALID");
  }

  const decipher = crypto.createDecipheriv(
    "aes-256-gcm",
    encryptionKey(),
    Buffer.from(ivText, "base64"),
  );
  decipher.setAuthTag(Buffer.from(tagText, "base64"));
  return Buffer.concat([
    decipher.update(Buffer.from(encryptedText, "base64")),
    decipher.final(),
  ]).toString("utf8");
}

function normalizeInput(input: AutomationMailboxInput) {
  const email = String(input.email || "").trim().toLowerCase();
  const username = String(input.username || email).trim();
  const password = String(input.password || "");
  const imapHost = String(input.imapHost || "").trim().toLowerCase();
  const imapPort = Number(input.imapPort || 993);
  const imapSecure = input.imapSecure !== false;
  const folder = String(input.folder || "INBOX").trim() || "INBOX";
  const name = String(input.name || email).trim() || email;

  if (!email || !/^\S+@\S+\.\S+$/.test(email)) throw new Error("MAILBOX_EMAIL_INVALID");
  if (!username) throw new Error("MAILBOX_USERNAME_REQUIRED");
  if (!password) throw new Error("MAILBOX_PASSWORD_REQUIRED");
  if (!imapHost) throw new Error("MAILBOX_IMAP_HOST_REQUIRED");
  if (!Number.isInteger(imapPort) || imapPort <= 0 || imapPort > 65535) {
    throw new Error("MAILBOX_IMAP_PORT_INVALID");
  }

  return { name, email, username, password, imapHost, imapPort, imapSecure, folder };
}

export function mailboxRowToApi(row: any) {
  return {
    id: Number(row.id),
    key: `mailbox:${row.id}`,
    name: row.name,
    email: row.email,
    username: row.username,
    imapHost: row.imap_host,
    imapPort: Number(row.imap_port || 993),
    imapSecure: row.imap_secure !== false,
    folder: row.folder || "INBOX",
    status: row.status || "connected",
    label: row.name && row.name !== row.email ? `${row.name} · ${row.email}` : row.email,
    createdAt: row.created_at,
    updatedAt: row.updated_at || row.created_at,
  };
}

export async function listAutomationMailboxes(userId: number) {
  await ensureAutomationMailboxTable();
  const result = await pool.query(
    `SELECT * FROM automation_mailboxes
     WHERE created_by_user_id=$1
     ORDER BY created_at DESC, id DESC`,
    [userId],
  );
  return result.rows;
}

export async function createAutomationMailbox(userId: number, input: AutomationMailboxInput) {
  await ensureAutomationMailboxTable();
  const tenantId = await getUserTenantId(userId);
  const config = normalizeInput(input);
  const encrypted = encryptPassword(config.password);

  const result = await pool.query(
    `INSERT INTO automation_mailboxes (
      tenant_id, created_by_user_id, name, email, username,
      password_ciphertext, imap_host, imap_port, imap_secure, folder, status
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'connected')
    ON CONFLICT (created_by_user_id, email) DO UPDATE SET
      name=EXCLUDED.name,
      username=EXCLUDED.username,
      password_ciphertext=EXCLUDED.password_ciphertext,
      imap_host=EXCLUDED.imap_host,
      imap_port=EXCLUDED.imap_port,
      imap_secure=EXCLUDED.imap_secure,
      folder=EXCLUDED.folder,
      status='connected',
      updated_at=NOW()
    RETURNING *`,
    [
      tenantId,
      userId,
      config.name,
      config.email,
      config.username,
      encrypted,
      config.imapHost,
      config.imapPort,
      config.imapSecure,
      config.folder,
    ],
  );
  return result.rows[0];
}

export async function getAutomationMailboxForUser(userId: number, mailboxId: number) {
  await ensureAutomationMailboxTable();
  const result = await pool.query(
    `SELECT * FROM automation_mailboxes
     WHERE id=$1 AND created_by_user_id=$2
     LIMIT 1`,
    [mailboxId, userId],
  );
  return result.rows[0] || null;
}

export function mailboxConnectionFromRow(row: any) {
  return {
    email: String(row.email || ""),
    username: String(row.username || ""),
    password: decryptPassword(String(row.password_ciphertext || "")),
    imapHost: String(row.imap_host || ""),
    imapPort: Number(row.imap_port || 993),
    imapSecure: row.imap_secure !== false,
    folder: String(row.folder || "INBOX"),
  };
}

export async function deleteAutomationMailbox(userId: number, mailboxId: number) {
  await ensureAutomationMailboxTable();
  const mailboxKey = `mailbox:${mailboxId}`;
  const dependentResult = await pool.query(
    `SELECT id, name FROM automation_tasks
     WHERE created_by_user_id=$1
       AND trigger_type='邮件触发'
       AND trigger_config->>'mailboxKey'=$2
     ORDER BY id`,
    [userId, mailboxKey],
  );

  if (dependentResult.rows.length > 0) {
    return { deleted: false, dependents: dependentResult.rows };
  }

  const result = await pool.query(
    `DELETE FROM automation_mailboxes
     WHERE id=$1 AND created_by_user_id=$2
     RETURNING id`,
    [mailboxId, userId],
  );
  return { deleted: result.rows.length > 0, dependents: [] };
}
