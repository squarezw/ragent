import pool from "@/lib/db";
import { fetchMailboxUnread } from "@/lib/automation/mailbox-client";
import {
  decryptMailboxPassword,
  encryptMailboxPassword,
} from "@/lib/automation/mailbox-credentials";
import { mailboxLabelFromRow } from "@/lib/automation/mailbox-id";
import { mailboxErrorText } from "@/lib/automation/mailbox-health";
import { mailboxErrorDisplayText } from "@/lib/automation/mailbox-errors";
import {
  createMailboxCursorResetRequired,
  mailboxUpdateSuppliesPassword,
  normalizeMailboxConfig,
  resolveMailboxUpdate,
  type MailboxConfigInput,
  type MailboxIdentity,
} from "@/lib/automation/mailbox-input";
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

/**
 * 编辑邮箱的入参：全部字段可选——**未出现的字段保留原值**。
 * 与创建不同，这里不能对缺失字段套默认值，否则一次"只改密码"的保存会把主机、账号、
 * 文件夹一起改写。密码的语义见 `mailbox-input.ts` 的 `resolveMailboxUpdate`。
 */
export type AutomationMailboxUpdateInput = MailboxConfigInput;

let mailboxInitPromise: Promise<void> | null = null;

/**
 * 建表（幂等）。导出供 `store.ts` 的提醒派生使用：那种情况下要先按 `status='error'`
 * 查这张表，而"表还不存在"（本模块从未被调用过）不能变成一次 500。
 * 已存在的旧表补列在 `ensureAutomationTables()`（模块 E.1）里，不在这里重复。
 */
export async function ensureAutomationMailboxTable() {
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
      last_error TEXT,
      last_error_at TIMESTAMPTZ,
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

/** 加密密钥：优先专用密钥，未配置时回退 JWT_SECRET（轮换 JWT_SECRET 会让旧密文解不开）。 */
function encryptionSecret() {
  const secret = process.env.AUTOMATION_MAILBOX_SECRET || process.env.JWT_SECRET;
  if (!secret) {
    throw new Error("AUTOMATION_MAILBOX_SECRET_MISSING");
  }
  return secret;
}

function encryptPassword(value: string) {
  return encryptMailboxPassword(encryptionSecret(), value);
}

function decryptPassword(value: string) {
  return decryptMailboxPassword(encryptionSecret(), value);
}

/**
 * 游标表可用吗（存在**且已是 mailbox_id 结构**）。
 *
 * 游标表由 store.ts 的 `ensureAutomationTables()` 建出，而邮箱操作可能先于任何一次 store
 * 调用发生：新部署里先配置邮箱、后建自动化时表还不存在；从旧的字符串键升级上来、store 尚未
 * 被调用过时表还在、但列仍是 `mailbox_key`。两种情况下都没有可重置/可清理的游标行
 * （旧结构的表在重建前必然为空，否则 `ensureAutomationTables` 会直接抛错中止），
 * 因此这里一律跳过，而不是让一次邮箱更新/删除因为列不存在而 500。
 */
async function automationCursorTableIsReady() {
  const result = await pool.query(
    `SELECT 1 FROM information_schema.columns
      WHERE table_schema=current_schema()
        AND table_name='automation_email_mailbox_cursors'
        AND column_name='mailbox_id'
      LIMIT 1`,
  );
  return result.rows.length > 0;
}

/**
 * 模块 D.4：把游标打回未初始化，`last_uid` 也必须归零。
 *
 * `saveAutomationEmailMailboxCursor` 用 `GREATEST(旧值, 新值)` 写回，所以只置
 * `initialized=false` 是不够的：换主机后若新邮箱的 UID 空间更小（新机器最新只有 100，
 * 旧基线是 5000），重新建立基线时会保留 5000，随后所有新邮件都因为"UID 不大于 5000"
 * 被过滤掉——正是 D.4 要避免的漏邮件。归零后重新建立的基线恰好是新邮箱的最新 UID。
 */
async function resetAutomationMailboxCursor(userId: number, mailboxId: number) {
  if (!(await automationCursorTableIsReady())) return;
  await pool.query(
    `UPDATE automation_email_mailbox_cursors
       SET last_uid=0, initialized=FALSE, updated_at=NOW()
     WHERE created_by_user_id=$1 AND mailbox_id=$2`,
    [userId, mailboxId],
  );
}

/**
 * 模块 D.5：删掉邮箱记录时一并清游标，避免 id 复用把上一条记录的游标接到新邮箱上（游标串号）。
 * 主键含 `created_by_user_id`，删除范围必须同样带上它。
 */
async function deleteAutomationMailboxCursor(userId: number, mailboxId: number) {
  if (!(await automationCursorTableIsReady())) return;
  await pool.query(
    `DELETE FROM automation_email_mailbox_cursors
     WHERE created_by_user_id=$1 AND mailbox_id=$2`,
    [userId, mailboxId],
  );
}

export function mailboxRowToApi(row: any) {
  return {
    id: Number(row.id),
    name: row.name,
    email: row.email,
    username: row.username,
    imapHost: row.imap_host,
    imapPort: Number(row.imap_port || 993),
    imapSecure: row.imap_secure !== false,
    folder: row.folder || "INBOX",
    status: row.status || "connected",
    // 模块 E.1：连接失败的原因与时间。列表接口是抽屉「状态徽标 + 最后错误」的唯一数据源，
    // 因此这两列必须在这里露面——列有了但接口不下发，抽屉就永远显示"无"。
    lastError: row.last_error || undefined,
    lastErrorAt: row.last_error_at || undefined,
    label: mailboxLabelFromRow(row),
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

/** 既有行 → 身份三要素。与 PUT 路径共用 `mailboxIdentityChanged`，不另写比较。 */
function mailboxIdentityFromRow(row: {
  imap_host?: unknown;
  username?: unknown;
  folder?: unknown;
}): MailboxIdentity {
  return {
    imapHost: String(row.imap_host || ""),
    username: String(row.username || ""),
    folder: String(row.folder || "INBOX"),
  };
}

/** 按 upsert 的冲突目标 `(created_by_user_id, email)` 取既有行；没有则返回 null。 */
async function findAutomationMailboxByEmail(userId: number, email: string) {
  const result = await pool.query(
    `SELECT * FROM automation_mailboxes
     WHERE created_by_user_id=$1 AND email=$2
     LIMIT 1`,
    [userId, email],
  );
  return result.rows[0] || null;
}

export async function createAutomationMailbox(userId: number, input: AutomationMailboxInput) {
  await ensureAutomationMailboxTable();
  const tenantId = await getUserTenantId(userId);
  const config = normalizeMailboxConfig(input);
  const encrypted = encryptPassword(config.password);

  // 模块 D.4 对创建路径同样成立：本函数是按 `(created_by_user_id, email)` 的 upsert，
  // 用户重填一个已登记的地址、却换了主机/账号/文件夹时走的就是这条路径，既有记录的 UID
  // 基线当场失效。既有行必须在写入**之前**取出——upsert 之后旧身份就查不回来了。
  const existingRow = await findAutomationMailboxByEmail(userId, config.email);
  const cursorResetRequired = createMailboxCursorResetRequired(
    existingRow ? mailboxIdentityFromRow(existingRow) : null,
    config,
  );

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
      last_error=NULL,
      last_error_at=NULL,
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

  // 只有写成功了才动游标（与 PUT 路径同一顺序、同一理由）：写失败时基线必须原样保留。
  // 少了这一步的后果是静默的——旧高水位留在新服务器上，所有 `uid <= 旧值` 的邮件被
  // 无声丢弃，而状态仍显示「已连接」。
  if (cursorResetRequired) {
    await resetAutomationMailboxCursor(userId, Number(result.rows[0].id));
  }

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

/**
 * 模块 E.1：把邮箱标记为连接失败，并记下原因与时间。
 *
 * 这是「一次写入、三处亮起」的那一次写入——抽屉的状态徽标、抽屉的「最后错误」、
 * 通知中心里按 `status='error'` 派生的那条提醒，都来自这一行。
 *
 * **本函数不抛错**（失败只记日志）：它记录的是一个已经发生的失败，绝不能反过来把调用方
 * 手里那个原始错误盖掉，或让调度器的错误处理多出一条无关的堆栈。
 */
export async function markAutomationMailboxConnectionError(
  userId: number,
  mailboxId: number,
  error: unknown,
) {
  // 先翻译成用户可读文案再落库：`last_error` 是抽屉「最后错误」与通知中心的同一份文案来源，
  // 不能让 `MAILBOX_CREDENTIAL_INVALID` 这类错误码原样出现在界面上（模块 E.3 的一半价值
  // 就在于这句「请重新填写授权码」真的能被人看懂并照做）。
  const message = mailboxErrorText(mailboxErrorDisplayText(error)) || "邮箱连接失败";

  try {
    await ensureAutomationMailboxTable();
    await pool.query(
      `UPDATE automation_mailboxes
         SET status='error', last_error=$3, last_error_at=NOW(), updated_at=NOW()
       WHERE id=$1 AND created_by_user_id=$2`,
      [mailboxId, userId, message],
    );
  } catch (recordError) {
    console.error("[Automation Mailboxes] failed to record connection error:", recordError);
  }
}

/**
 * 模块 E.1：连接成功时恢复为 `connected` 并清掉上次的错误记录。
 *
 * 只在"当前不是 connected"时才该被调用（调度器按已取到的行判断），因此正常轮询——
 * 每 10 秒一次——不产生任何写库；这里的 `status <> 'connected'` 只是并发下的兜底。
 * 与写入同一个道理：恢复状态是副作用，不能让它把一次成功的轮询变成失败。
 */
export async function markAutomationMailboxConnected(userId: number, mailboxId: number) {
  try {
    await ensureAutomationMailboxTable();
    await pool.query(
      `UPDATE automation_mailboxes
         SET status='connected', last_error=NULL, last_error_at=NULL, updated_at=NOW()
       WHERE id=$1 AND created_by_user_id=$2 AND status <> 'connected'`,
      [mailboxId, userId],
    );
  } catch (error) {
    console.error("[Automation Mailboxes] failed to mark mailbox connected:", error);
  }
}

/**
 * 邮箱行 → 连接参数。
 *
 * `options.password` 用于**顶替**行内密文解出的密码，只在确实有新密码时传（见
 * `updateAutomationMailbox`）：传了就不去解密旧密文。不传则按原样解密，解不开即抛
 * `MAILBOX_CREDENTIAL_INVALID`。
 */
export function mailboxConnectionFromRow(row: any, options: { password?: string } = {}) {
  return {
    email: String(row.email || ""),
    username: String(row.username || ""),
    password: options.password ?? decryptPassword(String(row.password_ciphertext || "")),
    imapHost: String(row.imap_host || ""),
    imapPort: Number(row.imap_port || 993),
    imapSecure: row.imap_secure !== false,
    folder: String(row.folder || "INBOX"),
  };
}

/**
 * 编辑已有邮箱（模块 C 的新增后端能力）。
 *
 * 三件事必须一起发生，缺任何一个都会留下难查的坏状态：
 * 1. **先真实连一次 IMAP**，与创建一致——不可达的配置不落库；
 * 2. **密码留空保留原值**（判定在 `resolveMailboxUpdate` 里，空串与未提供都表示不修改）；
 * 3. **连接身份变了就重置游标**（模块 D.4），否则调度器会拿旧基线比新邮箱的 UID。
 *
 * 返回 null 表示该 id 不存在或不属于当前用户——两种情况都按 404 处理，不泄露他人资源的存在性。
 */
export async function updateAutomationMailbox(
  userId: number,
  mailboxId: number,
  input: AutomationMailboxUpdateInput,
  options: { authorization?: string } = {},
) {
  await ensureAutomationMailboxTable();
  const existingRow = await getAutomationMailboxForUser(userId, mailboxId);
  if (!existingRow) return null;

  const { config, cursorResetRequired } = resolveMailboxUpdate(
    {
      name: String(existingRow.name || ""),
      // 请求里带了新密码就不去解密旧密文：密钥被换过之后旧密文必然解不开，而用户此刻提交的
      // 正是"重新填写授权码"这件事本身。先解密的话，接口会一直报「凭据已失效」，用户照提示
      // 重填还是同一条错误——那是模块 E.3 承诺的唯一自救路径，不能是死循环。
      // 没带新密码时照旧解密（合并结果要用它），解不开就如实报 400 而不是 500。
      ...mailboxConnectionFromRow(
        existingRow,
        mailboxUpdateSuppliesPassword(input) ? { password: String(input.password) } : {},
      ),
    },
    input,
  );

  // 保存前先真实连接一次：既有凭据解不开、或新配置连不上，都在这里失败并保持原记录不变。
  await fetchMailboxUnread({
    authorization: options.authorization,
    connection: {
      email: config.email,
      username: config.username,
      password: config.password,
      imapHost: config.imapHost,
      imapPort: config.imapPort,
      imapSecure: config.imapSecure,
      folder: config.folder,
    },
  });

  const result = await pool.query(
    `UPDATE automation_mailboxes SET
       name=$3, email=$4, username=$5, password_ciphertext=$6,
       imap_host=$7, imap_port=$8, imap_secure=$9, folder=$10,
       status='connected', last_error=NULL, last_error_at=NULL, updated_at=NOW()
     WHERE id=$1 AND created_by_user_id=$2
     RETURNING *`,
    [
      mailboxId,
      userId,
      config.name,
      config.email,
      config.username,
      encryptPassword(config.password),
      config.imapHost,
      config.imapPort,
      config.imapSecure,
      config.folder,
    ],
  );

  if (result.rows.length === 0) return null;

  // 只有真的写成功了才动游标：写失败时基线必须原样保留。
  if (cursorResetRequired) await resetAutomationMailboxCursor(userId, mailboxId);

  return result.rows[0];
}

export async function deleteAutomationMailbox(userId: number, mailboxId: number) {
  await ensureAutomationMailboxTable();
  // 依赖检查认两种引用，两者都是"这条自动化绑着某个邮箱"：
  // 1. 键格式统一后的 `trigger_config.mailboxId`（整数，与 $2::text 比较）；
  // 2. **任何仍带 `mailboxKey` 的遗留行**。A.1 的清理只删 `mailboxKey='system'`，其余遗留键
  //    （`mailbox:<id>`）会原样留下，它们同样是邮件触发、同样依赖着某条邮箱记录。
  //    这里只做**键存在性**判断（jsonb 的 `?` 操作符），不取值、不解码：§十一 禁止的是字符串
  //    编解码，而不是"这一行有没有旧键"这个事实。遗留行无法归属到具体某个整数 id，因此按
  //    最保守的方向处理——算作每个邮箱的依赖，宁可拒删（409 有提示），不可漏判（删掉后
  //    那条自动化的邮箱就没了）。
  const dependentResult = await pool.query(
    `SELECT id, name FROM automation_tasks
     WHERE created_by_user_id=$1
       AND trigger_type='邮件触发'
       AND (
         trigger_config->>'mailboxId'=$2::text
         OR trigger_config ? 'mailboxKey'
       )
     ORDER BY id`,
    [userId, mailboxId],
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
  const deleted = result.rows.length > 0;

  // 依赖检查命中时会先返回 409、邮箱仍在库里，游标也就必须保留；只有删除真的发生才清理。
  if (deleted) await deleteAutomationMailboxCursor(userId, mailboxId);

  return { deleted, dependents: [] };
}
