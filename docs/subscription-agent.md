# StreamCache API 文档

Subscription Agent 是一个 RSS 聚合服务，支持 YouTube 频道和 Twitter 用户订阅，并提供 AI 生成的内容摘要。

## 基础信息

- **Base URL**: `http://your-server:3000`
- **Content-Type**: `application/json`
- **API Version**: `2.0.0`

---

## 认证

所有 `/api/*` 端点需要 Bearer Token 认证。

### 请求头

```
Authorization: Bearer <API_KEY>
```

### 示例

```bash
curl -H "Authorization: Bearer your-api-key" \
  http://localhost:3000/api/feeds
```

### 认证失败响应

```json
{
  "code": "UNAUTHORIZED",
  "message": "Unauthorized"
}
```

**HTTP Status**: `401`

---

## 根端点

### API 信息

**GET** `/`

返回 API 基本信息和可用端点列表。

#### 成功响应 (200)

```json
{
  "name": "StreamCache API",
  "version": "2.0.0",
  "description": "RSS aggregation service for YouTube and Twitter content with LLM-powered summaries",
  "endpoints": {
    "health": "/health",
    "feeds": "/api/feeds",
    "fetch": "/api/fetch",
    "content_processing": "/api/feed-items/process",
    "summaries": "/api/summaries",
    "daily_summary": "/api/summaries/generate/today",
    "weekly_summary": "/api/summaries/generate/week",
    "summary_stats": "/api/summaries/stats"
  }
}
```

---

## 公开端点（无需认证）

### 健康检查

| 方法 | 端点 | 说明 |
|------|------|------|
| GET | `/health` | 基础健康检查 |
| GET | `/health/detailed` | 详细健康检查（含依赖状态） |
| GET | `/health/ready` | Kubernetes 就绪探针 |
| GET | `/health/live` | Kubernetes 存活探针 |

#### GET /health - 基础健康检查

```json
{
  "status": "ok",
  "timestamp": "2024-01-01T00:00:00.000Z"
}
```

#### GET /health/detailed - 详细健康检查

```json
{
  "status": "healthy",
  "timestamp": "2024-01-01T00:00:00.000Z",
  "checks": {
    "database": {
      "status": "ok",
      "latency": 5
    },
    "rsshub": {
      "status": "ok",
      "latency": 120
    },
    "scheduler": {
      "status": "running"
    }
  }
}
```

| 字段 | 说明 |
|------|------|
| status | `healthy` 或 `degraded`（有依赖不可用时） |
| checks.database.status | `ok` 或 `error` |
| checks.database.latency | 数据库响应延迟（毫秒） |
| checks.rsshub.status | `ok` 或 `error` |
| checks.rsshub.latency | RSSHub 响应延迟（毫秒） |
| checks.scheduler.status | `running` 或 `stopped` |

**HTTP Status**: `200`（healthy）或 `503`（degraded）

#### GET /health/ready - 就绪探针

```json
{
  "ready": true,
  "timestamp": "2024-01-01T00:00:00.000Z"
}
```

失败时（503）:
```json
{
  "ready": false,
  "timestamp": "2024-01-01T00:00:00.000Z",
  "error": "Database not ready"
}
```

#### GET /health/live - 存活探针

```json
{
  "alive": true,
  "timestamp": "2024-01-01T00:00:00.000Z"
}
```

---

## 订阅管理

### 创建订阅

**POST** `/api/feeds`

创建一个新的 RSS 订阅。如果订阅已存在，返回已有的订阅记录。

#### 请求体

```json
{
  "url": "https://www.youtube.com/channel/UCxxxxxx"
}
```

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| url | string | 是 | YouTube 频道 URL 或 Twitter 用户 URL |

**支持的 URL 格式**：
- YouTube: `https://www.youtube.com/channel/UCxxxxxx`（仅支持 `/channel/` 格式）
- Twitter: `https://twitter.com/username` 或 `https://x.com/username`

#### 成功响应 (200)

```json
{
  "id": "550e8400-e29b-41d4-a716-446655440000",
  "platform": "youtube",
  "source_url": "https://www.youtube.com/channel/UCxxxxxx",
  "rsshub_route": "/youtube/channel/UCxxxxxx",
  "status": "active",
  "subscribed_at": "2024-01-01T00:00:00.000Z",
  "last_fetch_at": null,
  "last_fetch_status": null
}
```

| 字段 | 类型 | 说明 |
|------|------|------|
| id | UUID | 订阅唯一标识 |
| platform | string | 平台类型：`youtube` 或 `twitter` |
| source_url | string | 原始订阅 URL |
| rsshub_route | string | RSSHub 路由路径 |
| status | string | 状态：`active` / `disabled` / `error` |
| subscribed_at | ISO8601 | 订阅时间 |
| last_fetch_at | ISO8601 \| null | 最后抓取时间 |
| last_fetch_status | string \| null | 最后抓取状态：`success` / `fail` / `null` |

#### 错误响应 (400)

```json
{
  "code": "invalid_url",
  "message": "不支持的 YouTube URL 格式",
  "platform": "youtube",
  "url_help": "请使用「分享频道」获取正确的 URL 格式：https://www.youtube.com/channel/UCxxxxxx"
}
```

---

### 订阅列表

**GET** `/api/feeds`

获取所有订阅列表。

#### 查询参数

| 参数 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| page | number | 1 | 页码（最小 1） |
| pageSize | number | 20 | 每页数量（1-100） |

#### 成功响应 (200)

```json
{
  "data": [
    {
      "id": "550e8400-e29b-41d4-a716-446655440000",
      "platform": "youtube",
      "source_url": "https://www.youtube.com/channel/UCxxxxxx",
      "rsshub_route": "/youtube/channel/UCxxxxxx",
      "status": "active",
      "subscribed_at": "2024-01-01T00:00:00.000Z",
      "last_fetch_at": "2024-01-01T12:00:00.000Z",
      "last_fetch_status": "success"
    }
  ],
  "pagination": {
    "page": 1,
    "pageSize": 20,
    "total": 1
  }
}
```

---

### 订阅详情

**GET** `/api/feeds/:id`

获取单个订阅的详细信息。

#### 路径参数

| 参数 | 类型 | 说明 |
|------|------|------|
| id | UUID | 订阅 ID |

#### 成功响应 (200)

```json
{
  "id": "550e8400-e29b-41d4-a716-446655440000",
  "platform": "youtube",
  "source_url": "https://www.youtube.com/channel/UCxxxxxx",
  "rsshub_route": "/youtube/channel/UCxxxxxx",
  "rsshub_query": null,
  "status": "active",
  "subscribed_at": "2024-01-01T00:00:00.000Z",
  "last_fetch_at": "2024-01-01T12:00:00.000Z",
  "last_fetch_status": "success"
}
```

| 字段 | 类型 | 说明 |
|------|------|------|
| rsshub_query | object \| null | RSSHub 额外查询参数 |

#### 错误响应 (400)

```json
{
  "code": "invalid_id",
  "message": "Invalid feed ID format"
}
```

#### 错误响应 (404)

```json
{
  "code": "not_found",
  "message": "Feed not found"
}
```

---

### 删除订阅

**DELETE** `/api/feeds/:id`

删除一个订阅。

#### 路径参数

| 参数 | 类型 | 说明 |
|------|------|------|
| id | UUID | 订阅 ID |

#### 查询参数

| 参数 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| hard | string | "false" | `"true"` 为硬删除（删除所有关联内容），`"false"` 为软删除（标记为 disabled） |

#### 成功响应 (200)

```json
{
  "message": "Feed deleted successfully",
  "hard": false
}
```

| 字段 | 类型 | 说明 |
|------|------|------|
| message | string | 操作结果消息 |
| hard | boolean | 是否为硬删除 |

---

### 订阅内容列表

**GET** `/api/feeds/:id/items`

获取订阅下的已抓取内容。

#### 路径参数

| 参数 | 类型 | 说明 |
|------|------|------|
| id | UUID | 订阅 ID |

#### 查询参数

| 参数 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| from | ISO8601 | - | 起始时间（可选） |
| to | ISO8601 | - | 结束时间（可选） |
| page | number | 1 | 页码（最小 1） |
| pageSize | number | 50 | 每页数量（1-100） |

#### 成功响应 (200)

```json
{
  "items": [
    {
      "id": "item-uuid",
      "title": "Video Title",
      "link": "https://www.youtube.com/watch?v=xxxxx",
      "summary": "Video description...",
      "author": "Channel Name",
      "published_at": "2024-01-01T10:00:00.000Z",
      "fetched_at": "2024-01-01T12:00:00.000Z"
    }
  ],
  "pagination": {
    "page": 1,
    "pageSize": 50,
    "total": 100
  },
  "query": {
    "from": "2024-01-01T00:00:00.000Z",
    "to": null
  }
}
```

| 字段 | 类型 | 说明 |
|------|------|------|
| items | array | 内容项列表 |
| items[].id | UUID | 内容项 ID |
| items[].title | string | 标题 |
| items[].link | string | 原始链接 |
| items[].summary | string \| null | 摘要/描述 |
| items[].author | string \| null | 作者 |
| items[].published_at | ISO8601 | 发布时间 |
| items[].fetched_at | ISO8601 | 抓取时间 |
| query.from | ISO8601 \| null | 请求的起始时间 |
| query.to | ISO8601 \| null | 请求的结束时间 |

#### 数据不完整警告

当请求的时间范围早于订阅时间时，响应会包含警告：

```json
{
  "items": [...],
  "pagination": {...},
  "query": {...},
  "warning": {
    "code": "data_incomplete",
    "message": "请求的时间范围部分在订阅时间之前，该时段数据可能不完整",
    "subscribed_at": "2024-01-01T00:00:00.000Z",
    "incomplete_range": {
      "from": "2023-12-01T00:00:00.000Z",
      "to": "2024-01-01T00:00:00.000Z"
    }
  }
}
```

---

## 报告管理

### 生成日报

**POST** `/api/summaries/generate/today`

手动触发生成过去 24 小时的日报。**立即返回，后台异步处理。**

#### 请求体（可选）

```json
{
  "feedIds": ["550e8400-e29b-41d4-a716-446655440000"]
}
```

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| feedIds | UUID[] | 否 | 指定要汇总的订阅 ID 数组。不传或传空数组则汇总所有订阅。 |

#### 成功响应 (200)

```json
{
  "type": "daily",
  "status": "pending",
  "summaryId": "550e8400-e29b-41d4-a716-446655440001",
  "feedIds": ["550e8400-e29b-41d4-a716-446655440000"],
  "period": {
    "start": "2024-01-01T00:00:00.000Z",
    "end": "2024-01-02T00:00:00.000Z"
  },
  "message": "Daily summary generation started in background"
}
```

| 字段 | 类型 | 说明 |
|------|------|------|
| type | string | 报告类型：`daily` |
| status | string | 初始状态：`pending` |
| summaryId | UUID | 报告 ID，可用于查询状态 |
| feedIds | UUID[] \| null | 指定的订阅 ID，`null` 表示所有订阅 |
| period.start | ISO8601 | 统计周期开始时间 |
| period.end | ISO8601 | 统计周期结束时间 |
| message | string | 操作说明 |

#### 错误响应 (400)

```json
{
  "code": "validation_error",
  "message": "Invalid request body",
  "errors": [...]
}
```

---

### 生成周报

**POST** `/api/summaries/generate/week`

手动触发生成过去 7 天的周报。**立即返回，后台异步处理。**

#### 请求体（可选）

```json
{
  "feedIds": ["550e8400-e29b-41d4-a716-446655440000"]
}
```

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| feedIds | UUID[] | 否 | 指定要汇总的订阅 ID 数组。不传或传空数组则汇总所有订阅。 |

#### 成功响应 (200)

```json
{
  "type": "weekly",
  "status": "pending",
  "summaryId": "550e8400-e29b-41d4-a716-446655440001",
  "feedIds": ["550e8400-e29b-41d4-a716-446655440000"],
  "period": {
    "start": "2023-12-25T00:00:00.000Z",
    "end": "2024-01-01T00:00:00.000Z"
  },
  "message": "Weekly summary generation started in background"
}
```

---

### 报告列表

**GET** `/api/summaries`

获取所有报告列表（支持分页和筛选）。

#### 查询参数

| 参数 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| type | string | - | 报告类型：`daily` 或 `weekly` |
| status | string | - | 状态：`pending` / `processing` / `completed` / `failed` |
| feedIds | string | - | 逗号分隔的订阅 ID 列表（筛选包含这些订阅的报告） |
| page | number | 1 | 页码（最小 1） |
| pageSize | number | 20 | 每页数量（1-100） |

#### 成功响应 (200)

```json
{
  "data": [
    {
      "id": "summary-uuid",
      "type": "daily",
      "status": "completed",
      "period_start": "2024-01-01T00:00:00.000Z",
      "period_end": "2024-01-02T00:00:00.000Z",
      "platform_filter": "all",
      "item_count": 25,
      "triggered_by": "scheduled",
      "created_at": "2024-01-02T10:00:00.000Z"
    }
  ],
  "pagination": {
    "page": 1,
    "pageSize": 20,
    "total": 10
  }
}
```

| 字段 | 类型 | 说明 |
|------|------|------|
| data[].id | UUID | 报告 ID |
| data[].type | string | 类型：`daily` / `weekly` |
| data[].status | string | 状态：`pending` / `processing` / `completed` / `failed` |
| data[].period_start | ISO8601 | 统计周期开始 |
| data[].period_end | ISO8601 | 统计周期结束 |
| data[].platform_filter | string | 平台筛选：`all` / `youtube` / `twitter` |
| data[].item_count | number | 包含的内容数量 |
| data[].triggered_by | string | 触发方式：`scheduled` / `manual` |
| data[].created_at | ISO8601 | 创建时间 |

---

### 报告详情

**GET** `/api/summaries/:id`

获取单个报告的完整内容。

#### 路径参数

| 参数 | 类型 | 说明 |
|------|------|------|
| id | UUID | 报告 ID |

#### 成功响应 (200)

```json
{
  "id": "summary-uuid",
  "type": "daily",
  "status": "completed",
  "period": {
    "start": "2024-01-01T00:00:00.000Z",
    "end": "2024-01-02T00:00:00.000Z"
  },
  "platform_filter": "all",
  "item_count": 25,
  "summary_text": "# 日报摘要\n\n## YouTube\n\n...",
  "highlights": [
    {
      "platform": "youtube",
      "title": "重要视频标题",
      "link": "https://...",
      "summary": "视频要点..."
    }
  ],
  "llm_model": "qwen-max",
  "llm_tokens_input": 5000,
  "llm_tokens_output": 1200,
  "triggered_by": "manual",
  "created_at": "2024-01-02T10:00:00.000Z",
  "updated_at": "2024-01-02T10:05:00.000Z"
}
```

| 字段 | 类型 | 说明 |
|------|------|------|
| id | UUID | 报告 ID |
| type | string | 类型：`daily` / `weekly` |
| status | string | 状态 |
| period.start | ISO8601 | 周期开始 |
| period.end | ISO8601 | 周期结束 |
| platform_filter | string | 平台筛选 |
| item_count | number | 内容数量 |
| summary_text | string \| null | 生成的摘要（Markdown 格式） |
| highlights | array \| null | 结构化高亮内容 |
| llm_model | string | 使用的 LLM 模型 |
| llm_tokens_input | number \| null | 输入 token 数 |
| llm_tokens_output | number \| null | 输出 token 数 |
| triggered_by | string | 触发方式 |
| created_at | ISO8601 | 创建时间 |
| updated_at | ISO8601 | 更新时间 |

#### 错误响应 (404)

```json
{
  "code": "summary_not_found",
  "message": "Summary with id xxx not found"
}
```

---

### 删除报告

**DELETE** `/api/summaries/:id`

删除一个报告。

#### 路径参数

| 参数 | 类型 | 说明 |
|------|------|------|
| id | UUID | 报告 ID |

#### 成功响应 (200)

```json
{
  "message": "Summary deleted successfully"
}
```

#### 错误响应 (404)

```json
{
  "code": "summary_not_found",
  "message": "Summary with id xxx not found"
}
```

---

### 重新生成报告

**POST** `/api/summaries/:id/regenerate`

重新生成一个已存在的报告。

#### 路径参数

| 参数 | 类型 | 说明 |
|------|------|------|
| id | UUID | 报告 ID |

#### 成功响应 (200)

```json
{
  "id": "summary-uuid",
  "status": "processing",
  "message": "Summary regeneration triggered"
}
```

#### 错误响应 (404)

```json
{
  "code": "summary_not_found",
  "message": "Summary with id xxx not found"
}
```

---

### 报告统计

**GET** `/api/summaries/stats`

获取报告统计信息。

#### 成功响应 (200)

```json
{
  "total": 50,
  "by_type": {
    "daily": 40,
    "weekly": 10
  },
  "by_status": {
    "completed": 48,
    "failed": 2,
    "processing": 0
  },
  "tokens_used": {
    "total_input": 200000,
    "total_output": 50000
  },
  "last_daily": {
    "id": "summary-uuid",
    "period_start": "2024-01-01T00:00:00.000Z",
    "created_at": "2024-01-02T10:00:00.000Z"
  },
  "last_weekly": {
    "id": "summary-uuid",
    "period_start": "2023-12-25T00:00:00.000Z",
    "created_at": "2024-01-01T10:00:00.000Z"
  }
}
```

| 字段 | 类型 | 说明 |
|------|------|------|
| total | number | 报告总数 |
| by_type.daily | number | 日报数量 |
| by_type.weekly | number | 周报数量 |
| by_status.completed | number | 已完成数量 |
| by_status.failed | number | 失败数量 |
| by_status.processing | number | 处理中数量 |
| tokens_used.total_input | number | 总输入 token 数 |
| tokens_used.total_output | number | 总输出 token 数 |
| last_daily | object \| null | 最近的日报信息 |
| last_weekly | object \| null | 最近的周报信息 |

---

## 其他端点

### 触发 RSS 抓取

**POST** `/api/fetch`

手动触发一次 RSS 抓取（后台运行）。

#### 成功响应 (200)

```json
{
  "success": true,
  "message": "Fetch started in background"
}
```

---

### 触发内容处理

**POST** `/api/feed-items/process`

手动触发内容处理（获取完整内容、生成摘要）。**立即返回，后台异步处理。**

#### 查询参数

| 参数 | 类型 | 说明 |
|------|------|------|
| platform | string | 平台筛选：`youtube` 或 `twitter`（可选） |
| limit | number | 处理数量上限（可选） |

#### 成功响应 (200)

```json
{
  "message": "Content processing started in background",
  "status": "started"
}
```

> 处理结果会输出到服务端日志。

---

## 错误响应格式

所有错误响应遵循统一格式：

```json
{
  "code": "error_code",
  "message": "Human readable error message",
  "platform": "youtube",
  "url_help": "Detailed help message (optional)",
  "errors": []
}
```

### 常见错误码

| 错误码 | HTTP 状态 | 说明 |
|--------|----------|------|
| `validation_error` | 400 | 请求参数校验失败 |
| `invalid_url` | 400 | 不支持的 URL 格式 |
| `invalid_id` | 400 | 无效的 ID 格式（UUID 格式错误） |
| `unsupported_platform` | 400 | 不支持的平台 |
| `not_found` | 404 | Feed 资源不存在 |
| `summary_not_found` | 404 | 报告不存在 |
| `fetch_error` | 500 | 数据获取错误 |
| `delete_error` | 500 | 删除操作错误 |
| `regenerate_error` | 500 | 重新生成错误 |
| `stats_error` | 500 | 统计信息获取错误 |
| `internal_error` | 500 | 服务器内部错误 |
