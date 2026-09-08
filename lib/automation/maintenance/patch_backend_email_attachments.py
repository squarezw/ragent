from pathlib import Path

path = Path("/app/app/api/v1/endpoints/email.py")
text = path.read_text(encoding="utf-8")
marker = "# --- automation result email attachments v1 ---"

if marker in text:
    print("结果邮件附件接口已经存在，无需重复修改。")
    raise SystemExit(0)

# 复用现有系统 SMTP 配置读取函数；只新增独立接口，不改原 /send 行为。
if "_get_smtp_settings_from_db" not in text:
    old_import = "from app.services.email_service import send_email"
    new_import = "from app.services.email_service import send_email, _get_smtp_settings_from_db"
    if old_import not in text:
        raise SystemExit("未找到 email_service 导入位置，未修改文件。")
    text = text.replace(old_import, new_import, 1)

prefix = """
import mimetypes as _automation_mimetypes
import os as _automation_os
import smtplib as _automation_smtplib
import ssl as _automation_ssl
from email.header import Header as _AutomationHeader
from email.message import EmailMessage as _AutomationEmailMessage
from email.utils import formataddr as _automation_formataddr
from pathlib import Path as _AutomationPath
from pydantic import BaseModel as _AutomationAttachmentBaseModel
"""

addition = r'''
# --- automation result email attachments v1 ---

class _AutomationResultEmailAttachment(_AutomationAttachmentBaseModel):
    filename: str
    object_key: str
    content_type: str | None = None
    size: int | None = None


class _AutomationResultEmailPayload(_AutomationAttachmentBaseModel):
    title: str
    body: str
    to: str | list[str]
    is_html: bool = False
    attachments: list[_AutomationResultEmailAttachment] = []


def _automation_bool(value, default=False):
    if value is None:
        return default
    if isinstance(value, bool):
        return value
    return str(value).strip().lower() in {"1", "true", "yes", "on"}


def _automation_result_file_path(object_key: str) -> _AutomationPath:
    root = _AutomationPath(
        _automation_os.getenv("FILE_STORAGE_PREFIX") or "/app/uploads"
    ).resolve()

    clean_key = str(object_key or "").strip().lstrip("/\\")
    if not clean_key:
        raise ValueError("附件文件引用为空")

    # 某些历史引用可能带 uploads/ 前缀；FILE_STORAGE_PREFIX 本身已经指向 uploads 根目录。
    if clean_key.startswith("uploads/") or clean_key.startswith("uploads\\"):
        clean_key = clean_key[8:]

    candidate = (root / clean_key).resolve()
    if candidate != root and root not in candidate.parents:
        raise ValueError("附件文件引用不合法")
    if not candidate.is_file():
        raise FileNotFoundError(f"附件文件不存在：{clean_key}")
    return candidate


@router.post("/send-attachments")
def automation_send_email_with_attachments(
    payload: _AutomationResultEmailPayload,
    credentials: HTTPAuthorizationCredentials = Depends(security),
):
    token = credentials.credentials
    verify_bearer_token(token)

    settings = _get_smtp_settings_from_db()
    if not settings:
        raise HTTPException(status_code=500, detail="系统邮箱尚未配置")

    smtp_host = str(settings.get("SMTP_HOST") or "").strip()
    smtp_port = int(settings.get("SMTP_PORT") or 465)
    smtp_username = str(settings.get("SMTP_USERNAME") or "").strip()
    smtp_password = str(settings.get("SMTP_PASSWORD") or "").strip()
    smtp_use_ssl = _automation_bool(settings.get("SMTP_USE_SSL"), smtp_port == 465)
    smtp_starttls = _automation_bool(settings.get("SMTP_STARTTLS"), smtp_port == 587)
    from_email = str(settings.get("SMTP_FROM_EMAIL") or smtp_username).strip()
    from_name = str(settings.get("SMTP_FROM_NAME") or "Ragent").strip() or "Ragent"

    if not smtp_host or not smtp_username or not smtp_password or not from_email:
        raise HTTPException(status_code=500, detail="系统 SMTP 配置不完整")

    recipients = payload.to if isinstance(payload.to, list) else [payload.to]
    recipients = [str(item or "").strip() for item in recipients if str(item or "").strip()]
    if not recipients:
        raise HTTPException(status_code=400, detail="收件邮箱为空")

    attachments = list(payload.attachments or [])[:10]
    max_single = 10 * 1024 * 1024
    max_total = 20 * 1024 * 1024
    total_size = 0
    resolved = []

    try:
        for item in attachments:
            file_path = _automation_result_file_path(item.object_key)
            file_size = file_path.stat().st_size
            if file_size > max_single:
                raise ValueError(f"附件 {item.filename} 超过 10 MB")
            total_size += file_size
            if total_size > max_total:
                raise ValueError("单封结果邮件附件总大小超过 20 MB")
            resolved.append((item, file_path, file_size))
    except (ValueError, FileNotFoundError) as exc:
        raise HTTPException(status_code=400, detail=str(exc))

    message = _AutomationEmailMessage()
    message["From"] = _automation_formataddr(
        (str(_AutomationHeader(from_name, "utf-8")), from_email)
    )
    message["To"] = ", ".join(recipients)
    message["Subject"] = payload.title

    if payload.is_html:
        message.set_content("此邮件包含 HTML 内容，请使用支持 HTML 的邮件客户端查看。")
        message.add_alternative(payload.body, subtype="html")
    else:
        message.set_content(payload.body)

    for item, file_path, _ in resolved:
        content_type = str(item.content_type or "").strip()
        if "/" not in content_type:
            content_type = _automation_mimetypes.guess_type(item.filename or file_path.name)[0] or "application/octet-stream"
        maintype, subtype = content_type.split("/", 1)
        safe_name = _AutomationPath(item.filename or file_path.name).name
        message.add_attachment(
            file_path.read_bytes(),
            maintype=maintype,
            subtype=subtype,
            filename=safe_name,
        )

    server = None
    context = _automation_ssl.create_default_context()
    try:
        if smtp_use_ssl:
            server = _automation_smtplib.SMTP_SSL(
                smtp_host, smtp_port, timeout=20, context=context
            )
        else:
            server = _automation_smtplib.SMTP(smtp_host, smtp_port, timeout=20)
            server.ehlo()
            if smtp_starttls:
                server.starttls(context=context)
                server.ehlo()

        server.login(smtp_username, smtp_password)
        server.send_message(message)
        return {
            "success": True,
            "attachment_count": len(resolved),
            "attachments": [item.filename for item, _, _ in resolved],
        }
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"结果邮件发送失败：{exc}")
    finally:
        if server is not None:
            try:
                server.quit()
            except Exception:
                try:
                    server.close()
                except Exception:
                    pass
'''

candidate = text + "\n" + prefix + "\n" + addition
compile(candidate, str(path), "exec")

backup = Path("/app/app/api/v1/endpoints/email.py.before-automation-attachments-v1")
if not backup.exists():
    backup.write_text(path.read_text(encoding="utf-8"), encoding="utf-8")

path.write_text(candidate, encoding="utf-8")
print("结果邮件附件接口已加入：POST /api/v1/email/send-attachments")
