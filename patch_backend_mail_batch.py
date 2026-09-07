from pathlib import Path
import re

path = Path('/app/app/api/v1/endpoints/email.py')
text = path.read_text(encoding='utf-8')
backup = Path('/app/app/api/v1/endpoints/email.py.before-email-server-batch-v1')
backup.write_text(text, encoding='utf-8')

patterns = [
    (r'new_uids\s*=\s*\[uid for uid in uids if uid > after_uid\]\[-10:\]',
     'new_uids = [uid for uid in uids if uid > after_uid][:20]'),
    (r'new_uids\s*=\s*\[uid for uid in uids if uid > int\(payload\.after_uid\)\]\[-20:\]',
     'new_uids = [uid for uid in uids if uid > int(payload.after_uid)][:20]'),
]

changed = 0
for pattern, replacement in patterns:
    text, count = re.subn(pattern, replacement, text)
    changed += count

if changed == 0:
    print('未发现旧的末尾截取写法；可能已经修过，无需修改。')
else:
    compile(text, str(path), 'exec')
    path.write_text(text, encoding='utf-8')
    print(f'邮件批量读取顺序已修复，共修改 {changed} 处。')
    print('现在会从游标之后最早的邮件开始分批读取，避免高峰期漏邮件。')
    print(f'备份：{backup}')
