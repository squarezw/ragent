# 故障排除指南

## PostgreSQL JSON 转换错误

### 错误信息
```
"details": {
    "length": 248,
    "name": "error",
    "severity": "ERROR",
    "code": "22P05",
    "detail": "\\u0000 cannot be converted to text.",
    "where": "JSON data, line 1: ...软件退关及保税仓储业务拓展\\n\\u0000...",
    "file": "jsonfuncs.c",
    "line": "645",
    "routine": "json_errsave_error"
}
```

### 问题原因
这个错误是因为数据中包含了空字符（`\u0000`），PostgreSQL 无法将其转换为 JSON 文本格式。这通常发生在：

1. **PDF 文件解析**：PDF 文件转换为文本时可能包含空字符
2. **二进制文件处理**：某些文件格式包含不可见字符
3. **文本编码问题**：不同编码格式转换时产生的问题

### 解决方案

#### 1. 预防措施（已实施）
我们已经在以下 API 中添加了文本清理功能：

- **文件上传** (`/api/knowledge/upload.ts`)：PDF 文本提取时自动清理
- **向量化** (`/api/knowledge/vectorize.ts`)：分段存储时自动清理
- **SOP 管理** (`/api/sop/detail.ts`)：内容存储时自动清理
- **知识图谱** (`/api/knowledge/graph.ts`)：文本处理时自动清理

#### 2. 清理现有数据（如果需要）
如果数据库中已经存在包含空字符的数据，可以使用以下 SQL 手动清理：

```sql
-- 清理知识库分段表
UPDATE knowledge_segments 
SET segment_text = regexp_replace(segment_text, '[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]', '', 'g')
WHERE segment_text ~ '[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]';

-- 清理 SOP 详情表
UPDATE sop_detail 
SET content = regexp_replace(content, '[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]', '', 'g')
WHERE content ~ '[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]';

-- 清理知识库文件表的 meta 字段
UPDATE knowledge_files 
SET meta = jsonb_set(meta, '{text}', to_jsonb(regexp_replace(meta->>'text', '[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]', '', 'g')))
WHERE meta->>'text' ~ '[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]';
```



### 文本清理函数
我们提供了 `cleanText` 函数来清理文本中的不可见字符：

```typescript
import { cleanText } from '@/lib/utils';

// 清理文本
const cleanedText = cleanText(originalText);
```

这个函数会移除：
- 空字符 (`\u0000`)
- 控制字符（除了换行符和制表符）
- 零宽字符
- 其他不可见字符
- 多余的空格

### 预防措施
为了避免将来出现类似问题：

1. **文件上传时**：确保所有文本内容都经过 `cleanText` 函数处理
2. **数据库插入前**：检查文本内容是否包含不可见字符
3. **API 响应时**：确保返回的文本数据已经清理

### 监控和日志
建议定期检查日志文件，查看是否有类似的错误信息。如果发现问题，及时运行清理脚本。

### 相关文件
- `lib/utils.ts` - 文本清理函数
- `pages/api/knowledge/vectorize.ts` - 向量化 API
- `pages/api/knowledge/upload.ts` - 文件上传 API
- `pages/api/sop/detail.ts` - SOP 详情 API 