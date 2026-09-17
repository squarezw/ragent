/**
 * 监听邮箱凭据的对称加解密（AES-256-GCM）。
 *
 * 为什么单独成模块：`mailboxes.ts` 依赖 `lib/db`，测试进程不连数据库，import 不到它；
 * 而「加解密往返」是 spec §七 明确要求覆盖的行为，必须是能真实失败断言，而不是对着
 * mock 断言。密钥由调用方传入（生产在 `mailboxes.ts` 里读 `AUTOMATION_MAILBOX_SECRET`，
 * 未配置时回退 `JWT_SECRET`），本模块不碰 process.env，因此零依赖、可直接 import。
 *
 * 密文格式：`v1:<iv base64>:<认证标签 base64>:<密文 base64>`。版本前缀是留给未来的算法
 * 升级位：解析不到 v1 前缀即判为无效，而不是拿旧格式硬解。
 */
import crypto from "node:crypto";

const CIPHER = "aes-256-gcm";
const VERSION = "v1";
/** GCM 的推荐 IV 长度（96 bit）。每次加密都必须是新的随机值，否则会泄露明文异或关系。 */
const IV_BYTES = 12;
/** 凭据无法解密（格式非法、密钥不符、密文被改动）时对外统一使用的错误码。 */
const CREDENTIAL_INVALID_ERROR = "MAILBOX_CREDENTIAL_INVALID";

/** 派生 32 字节密钥：密钥原文允许任意长度（JWT_SECRET 常常很长），统一 sha256 收敛。 */
function deriveKey(secret: string) {
  return crypto.createHash("sha256").update(String(secret)).digest();
}

export function encryptMailboxPassword(secret: string, value: string): string {
  const iv = crypto.randomBytes(IV_BYTES);
  const cipher = crypto.createCipheriv(CIPHER, deriveKey(secret), iv);
  const encrypted = Buffer.concat([cipher.update(String(value), "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${VERSION}:${iv.toString("base64")}:${tag.toString("base64")}:${encrypted.toString("base64")}`;
}

export function decryptMailboxPassword(secret: string, value: string): string {
  const [version, ivText, tagText, encryptedText] = String(value || "").split(":");
  if (version !== VERSION || !ivText || !tagText || !encryptedText) {
    throw new Error(CREDENTIAL_INVALID_ERROR);
  }

  // 认证失败（密钥不符、密文被改动）必须收敛成同一个可识别的错误码，而不是把 Node 的
  // 「Unsupported state or unable to authenticate data」抛出去：那句 OpenSSL 措辞既不在
  // 接口错误映射表里、也不在连接失败的启发式里，会一路落成 500（模块 E.3 说的正是这个场景
  // ——密钥被换过之后所有已存凭据失效，用户要看到的是一句能照做的话）。
  try {
    const decipher = crypto.createDecipheriv(
      CIPHER,
      deriveKey(secret),
      Buffer.from(ivText, "base64")
    );
    // 先设认证标签再解密：密钥不符或密文被改动时 final() 会抛错，不会返回脏明文。
    decipher.setAuthTag(Buffer.from(tagText, "base64"));
    return Buffer.concat([
      decipher.update(Buffer.from(encryptedText, "base64")),
      decipher.final(),
    ]).toString("utf8");
  } catch (error) {
    // 原始原因挂在 cause 上：运维排查（"是不是换过密钥"）需要它，用户不需要。
    throw new Error(CREDENTIAL_INVALID_ERROR, { cause: error });
  }
}
