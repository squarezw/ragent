# 核心库文件

## 数据库连接 (`lib/db.ts`)

PostgreSQL 连接池管理，使用单例模式优化性能。

```typescript
import pool from "@/lib/db";

// 使用连接池
const client = await pool.connect();
try {
  const result = await client.query("SELECT * FROM users WHERE id = $1", [
    userId,
  ]);
} finally {
  client.release();
}
```

## 认证系统 (`lib/auth.ts`)

JWT Token 认证，支持从请求中提取用户信息。

**主要函数**:

- `getUserIdFromRequest(req)`: 从请求中获取用户 ID
- `requireAuth(req, res)`: 要求认证的中间件
- `generateToken(userId)`: 生成 JWT Token

## 权限管理 (`lib/permissions.ts`)

基于角色的访问控制（RBAC）系统。

**角色层级**:
1. **超级管理员**: 系统最高权限，可管理所有租户
2. **租户管理员**: 管理本租户内的所有资源
3. **部门管理员**: 管理本部门及下级部门
4. **普通用户**: 基础使用权限

**权限资源类型**:
- `knowledge`: 知识库文档
- `dataset`: 数据集
- `app`: 应用
- `user`: 用户管理
- `organization`: 组织管理

**主要函数**:
- `getUserPermissions(userId)`: 获取用户完整权限信息
- `checkResourcePermission(userId, resourceType, permission, resource)`: 检查资源权限

## 问答核心 (`lib/qaCore.ts`)

问答系统的核心逻辑，处理问题、检索、LLM 调用。

**主要函数**:

- `runQA(params, req, callbacks, res)`: 执行问答流程
  - 支持流式响应
  - 支持附件处理
  - 支持知识库检索
  - 支持自定义提示词

## Embedding 服务 (`lib/embeddingService.ts`)

向量化服务封装，支持多种模型。

**支持的模型**:

- `openai`: OpenAI Embedding
- `qwen`: 通义千问
- `e5`: E5 模型（默认）
- `aliyun`: 阿里云模型

**主要函数**:

- `getEmbedding(text, model)`: 单个文本向量化
- `batchEmbedding(texts, model)`: 批量向量化

## 工作流工具 (`lib/workflowUtils.ts`)

工作流相关的工具函数。

**主要函数**:

- `generateDefaultWorkflow(appConfig)`: 从应用配置生成默认工作流
- `syncWorkflowToForm(workflow)`: 工作流配置同步到表单
- `syncFormToWorkflow(formData)`: 表单数据同步到工作流
- `validateWorkflow(workflow)`: 验证工作流完整性

