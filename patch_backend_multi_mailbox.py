from pathlib import Path

path = Path("/app/app/api/v1/endpoints/email.py")
text = path.read_text(encoding="utf-8")
marker = "# --- automation multi mailbox imap endpoint v1 ---"

if marker in text:
    print("多邮箱 IMAP 接口已经存在，无需重复修改。")
    raise SystemExit(0)

prefix_lines = []
if "import imaplib" not in text:
    prefix_lines.append("import imaplib")
if "from email import message_from_bytes" not in text:
    prefix_lines.append("from email import message_from_bytes")
if "from email.header import decode_header, make_header" not in text:
    prefix_lines.append("from email.header import decode_header, make_header")
if "from pydantic import BaseModel" not in text:
    prefix_lines.append("from pydantic import BaseModel")

if prefix_lines:
    text = "\n".join(prefix_lines) + "\n" + text

old_from = '\"from\": _automation_decode_mail_header(msg.get(\"From\")),'
if old_from in text and '\"to\": _automation_decode_mail_header(msg.get(\"To\")),' not in text:
    text = text.replace(
        old_from,
        old_from + '\n                \"to\": _automation_decode_mail_header(msg.get(\"To\")),',
    )

addition = """

# --- automation multi mailbox imap endpoint v1 ---

class AutomationMailboxUnreadRequest(BaseModel):
    after_uid: int | None = None
    imap_host: str
    imap_port: int = 993
    imap_secure: bool = True
    username: str
    password: str
    folder: str = \"INBOX\"


def _automation_multi_decode_header(value):
    if not value:
        return \"\"
    try:
        return str(make_header(decode_header(value)))
    except Exception:
        return str(value)


def _automation_multi_extract_body(msg):
    plain_parts = []
    html_parts = []
    parts = msg.walk() if msg.is_multipart() else [msg]
    for part in parts:
        disposition = (part.get(\"Content-Disposition\") or \"\").lower()
        if \"attachment\" in disposition:
            continue
        content_type = part.get_content_type()
        if content_type not in (\"text/plain\", \"text/html\"):
            continue
        payload = part.get_payload(decode=True)
        if payload is None:
            continue
        charset = part.get_content_charset() or \"utf-8\"
        try:
            content = payload.decode(charset, errors=\"replace\")
        except Exception:
            content = payload.decode(\"utf-8\", errors=\"replace\")
        if content_type == \"text/plain\":
            plain_parts.append(content)
        else:
            html_parts.append(content)
    plain = \"\\n\".join(x.strip() for x in plain_parts if x.strip()).strip()
    if plain:
        return plain
    return \"\\n\".join(x.strip() for x in html_parts if x.strip()).strip()


@router.post(\"/unread-config\")
def automation_get_new_emails_with_config(
    payload: AutomationMailboxUnreadRequest,
    credentials: HTTPAuthorizationCredentials = Depends(security),
):
    token = credentials.credentials
    verify_bearer_token(token)

    host = str(payload.imap_host or \"\").strip()
    username = str(payload.username or \"\").strip()
    password = str(payload.password or \"\")
    folder = str(payload.folder or \"INBOX\").strip() or \"INBOX\"
    port = int(payload.imap_port or (993 if payload.imap_secure else 143))

    if not host or not username or not password:
        raise HTTPException(status_code=400, detail=\"IMAP 连接参数不完整\")

    client = None
    try:
        if payload.imap_secure:
            client = imaplib.IMAP4_SSL(host, port, timeout=15)
        else:
            client = imaplib.IMAP4(host, port, timeout=15)

        client.login(username, password)
        status, _ = client.select(folder, readonly=True)
        if status != \"OK\":
            raise RuntimeError(f\"无法打开邮箱文件夹：{folder}\")

        status, data = client.uid(\"search\", None, \"ALL\")
        if status != \"OK\":
            raise RuntimeError(\"无法读取邮箱 UID\")

        uid_values = data[0].split() if data and data[0] else []
        uids = [int(value) for value in uid_values]
        latest_uid = max(uids) if uids else 0

        if payload.after_uid is None:
            return {\"success\": True, \"latest_uid\": latest_uid, \"messages\": []}

        new_uids = [uid for uid in uids if uid > int(payload.after_uid)][-20:]
        messages = []
        for uid in new_uids:
            status, fetch_data = client.uid(\"fetch\", str(uid), \"(RFC822)\")
            if status != \"OK\" or not fetch_data:
                continue

            raw_message = None
            for item in fetch_data:
                if isinstance(item, tuple) and len(item) >= 2:
                    raw_message = item[1]
                    break
            if not raw_message:
                continue

            msg = message_from_bytes(raw_message)
            attachments = []
            if msg.is_multipart():
                for part in msg.walk():
                    filename = part.get_filename()
                    if filename:
                        attachments.append(_automation_multi_decode_header(filename))

            messages.append({
                \"uid\": uid,
                \"message_id\": msg.get(\"Message-ID\") or \"\",
                \"from\": _automation_multi_decode_header(msg.get(\"From\")),
                \"to\": _automation_multi_decode_header(msg.get(\"To\")),
                \"subject\": _automation_multi_decode_header(msg.get(\"Subject\")),
                \"date\": msg.get(\"Date\") or \"\",
                \"body\": _automation_multi_extract_body(msg),
                \"attachments\": attachments,
            })

        return {\"success\": True, \"latest_uid\": latest_uid, \"messages\": messages}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f\"IMAP 收件失败: {e}\")
    finally:
        if client is not None:
            try:
                client.logout()
            except Exception:
                pass
"""

candidate = text + addition
compile(candidate, str(path), "exec")
backup = Path("/app/app/api/v1/endpoints/email.py.before-multimail-v1")
if not backup.exists():
    backup.write_text(path.read_text(encoding="utf-8"), encoding="utf-8")
path.write_text(candidate, encoding="utf-8")
print("多邮箱 IMAP 接口添加成功，并已通过 Python 语法检查。")
print("备份：/app/app/api/v1/endpoints/email.py.before-multimail-v1")
