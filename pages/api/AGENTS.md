# API 接口说明

## 认证

所有 API 请求需要在 Header 中携带 JWT Token:
```
Authorization: Bearer <token>
```

## 主要 API 端点

### 知识库 API (`/api/knowledge/`)

- `GET /api/knowledge/files`: 获取文件列表（支持权限过滤）
- `POST /api/knowledge/upload`: 上传文件
- `PUT /api/knowledge/files/[id]`: 更新文件信息
- `DELETE /api/knowledge/files/[id]`: 删除文件
- `POST /api/knowledge/index`: 索引文件（向量化）
- `GET /api/knowledge/search`: 搜索知识库

### 知识图谱 API (`/api/knowledge/graph`)

- `GET /api/knowledge/graph?dataset_id={id}`: 获取指定数据集的知识图谱数据
- `POST /api/knowledge/graph?id={id}`: 为指定数据集创建知识图谱（异步任务，返回 task_id）
- `DELETE /api/knowledge/graph?dataset_id={id}`: 删除指定数据集的知识图谱数据
- `GET /api/knowledge/graph/statistics`: 获取知识图谱统计信息（实体数、关系数等）

### 聊天 API (`/api/chat/`)

- `POST /api/chat/stream`: 流式问答
- `GET /api/chat/sessions`: 获取会话列表
- `GET /api/chat/sessions/[id]`: 获取会话详情
- `POST /api/chat/feedback`: 提交反馈

### App 应用 API (`/api/v1/apps/`)

- `GET /api/v1/apps`: 获取应用列表
- `POST /api/v1/apps`: 创建应用
- `GET /api/v1/apps/[id]`: 获取应用详情
- `PUT /api/v1/apps/[id]`: 更新应用
- `DELETE /api/v1/apps/[id]`: 删除应用

### 数据集 API (`/api/datasets/`)

- `GET /api/datasets`: 获取数据集列表
- `POST /api/datasets`: 创建数据集
- `PUT /api/datasets/[id]`: 更新数据集配置
- `DELETE /api/datasets/[id]`: 删除数据集
- `GET /api/datasets/tasks/[task_id]`: 查询异步任务的执行状态和结果（如知识图谱构建任务）

### 用户 API (`/api/user/`)

- `GET /api/user/me`: 获取当前用户信息（包含权限）
- `GET /api/user/list`: 获取用户列表
- `POST /api/user`: 创建用户
- `PUT /api/user/[id]`: 更新用户

## API 开发规范

### 认证检查

```typescript
import { getUserIdFromRequest, requireAuth } from '@/lib/auth';

export default async function handler(req, res) {
  if (!requireAuth(req, res)) {
    return; // 已返回 401
  }

  const userId = getUserIdFromRequest(req);
  // ... 处理逻辑
}
```

### 权限检查

```typescript
import { getUserPermissions } from '@/lib/permissions';

const userPerms = await getUserPermissions(userId);
if (!userPerms?.permissions.some(p =>
  p.resourceType === 'knowledge' && p.permission === 'write'
)) {
  return res.status(403).json({ error: '无权限' });
}
```

