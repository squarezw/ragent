# ragent-oss TypeScript SDK

ragent-oss 存储网关的 TypeScript 客户端库。零运行时依赖，仅使用全局 `fetch`。

## 安装

```bash
bun add ragent-oss
# 或
npm install ragent-oss
```

## 快速开始

```typescript
import { RagentOssClient } from "ragent-oss";

const client = new RagentOssClient({
  baseUrl: "https://oss.ragents.net",
  apiKey: "your-api-key",
});

// 获取预签名上传 URL
const { objectKey, uploadUrl, headers } = await client.presign({
  filename: "report.pdf",
  contentType: "application/pdf",
  category: "knowledge",
});

// 上传文件到预签名 URL
await fetch(uploadUrl, {
  method: "PUT",
  headers,
  body: fileContent,
});

// 获取签名下载 URL
const { url } = await client.sign({ objectKey });

// 删除文件
await client.delete({ objectKey });
```

## 浏览器上传（带进度）

```typescript
import { RagentOssClient } from "ragent-oss";
import { upload } from "ragent-oss/upload";

const client = new RagentOssClient({
  baseUrl: "https://oss.ragents.net",
  apiKey: "your-api-key",
});

const controller = new AbortController();

const { objectKey } = await upload(client, {
  file: document.querySelector("input[type=file]").files[0],
  category: "knowledge",
  onProgress: (percent) => console.log(`${percent}%`),
  signal: controller.signal, // 可选：取消上传
});
```

## API 参考

### `new RagentOssClient(config)`

| 参数 | 类型 | 说明 |
|------|------|------|
| `config.baseUrl` | `string` | 服务地址，如 `https://oss.ragents.net` |
| `config.apiKey` | `string` | API 密钥（通过 `X-API-Key` 请求头发送） |

### `client.health()`

检查服务状态，不需要认证。

返回：`Promise<{ status: string; storage: string }>`

### `client.presign(req)`

获取预签名上传 URL。

| 参数 | 类型 | 说明 |
|------|------|------|
| `req.filename` | `string` | 原始文件名（用于提取扩展名） |
| `req.contentType` | `string` | MIME 类型 |
| `req.category` | `string` | 存储分类 |

返回：`Promise<{ objectKey: string; uploadUrl: string; headers: Record<string, string> }>`

### `client.sign(req)`

获取签名下载 URL。

| 参数 | 类型 | 说明 |
|------|------|------|
| `req.objectKey` | `string` | 对象键 |
| `req.expiresIn` | `number?` | 过期时间（秒），默认 86400（24 小时） |

返回：`Promise<{ url: string }>`

### `client.delete(req)`

删除对象。

| 参数 | 类型 | 说明 |
|------|------|------|
| `req.objectKey` | `string` | 要删除的对象键 |

返回：`Promise<{ success: boolean }>`

### `client.download(objectKey, expiresIn?)`

便捷方法：sign + fetch，直接下载文件内容。

返回：`Promise<ArrayBuffer>`

### `upload(client, options)`

浏览器端上传辅助函数（使用 XHR 支持进度回调）。

| 参数 | 类型 | 说明 |
|------|------|------|
| `client` | `RagentOssClient` | 客户端实例 |
| `options.file` | `Blob \| File` | 要上传的文件 |
| `options.category` | `string` | 存储分类 |
| `options.onProgress` | `(percent: number) => void` | 进度回调（0-100） |
| `options.signal` | `AbortSignal?` | 取消信号 |

返回：`Promise<{ objectKey: string }>`

## 错误处理

```typescript
import {
  RagentOssError,
  AuthenticationError,
  ValidationError,
  UploadError,
  NetworkError,
} from "ragent-oss";

try {
  await client.presign({ ... });
} catch (err) {
  if (err instanceof AuthenticationError) {
    // 401 - API 密钥无效
  } else if (err instanceof ValidationError) {
    // 422 - 请求参数错误
  } else if (err instanceof NetworkError) {
    // 网络不可达
  }
}
```

| 错误类 | 触发条件 |
|--------|----------|
| `AuthenticationError` | HTTP 401 |
| `ValidationError` | HTTP 422 |
| `UploadError` | PUT 上传失败 |
| `NetworkError` | 网络不可达 |
| `RagentOssError` | 其他 HTTP 错误（基类） |
