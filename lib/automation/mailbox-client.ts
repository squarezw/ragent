export type MailboxConnection = {
  email?: string;
  username: string;
  password: string;
  imapHost: string;
  imapPort: number;
  imapSecure: boolean;
  folder: string;
};

export async function fetchMailboxUnread(params: {
  authorization?: string;
  afterUid?: number;
  connection: MailboxConnection;
}) {
  const backendBaseUrl = (process.env.EXTERNAL_API_BASE_URL || "http://localhost:8010").replace(/\/+$/, "");

  const response = await fetch(`${backendBaseUrl}/api/v1/email/unread-config`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(params.authorization ? { Authorization: params.authorization } : {}),
    },
    body: JSON.stringify({
      after_uid: Number.isInteger(params.afterUid) ? params.afterUid : null,
      imap_host: params.connection.imapHost,
      imap_port: params.connection.imapPort,
      imap_secure: params.connection.imapSecure,
      username: params.connection.username,
      password: params.connection.password,
      folder: params.connection.folder || "INBOX",
    }),
  });

  const raw = await response.text();
  let data: any = null;
  try {
    data = raw ? JSON.parse(raw) : null;
  } catch {
    data = raw;
  }

  if (!response.ok) {
    const detail =
      typeof data === "object" && data?.detail
        ? data.detail
        : typeof data === "string" && data
          ? data
          : `Backend returned ${response.status}`;
    throw new Error(String(detail));
  }

  return data ?? { success: true, latest_uid: 0, messages: [] };
}
