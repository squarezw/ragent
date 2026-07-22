# 知识库管理模块

知识库是系统的核心模块，负责文档的存储、索引和检索。

## 主要功能

- 文档上传（支持 PDF、Word、Excel、Markdown、CSV）
- 文档向量化索引（支持多种分段策略）
- 权限控制（私有、部门、组织、公开）
- 标签管理（多标签分类）
- 文档搜索和预览

## 关键文件

- `app/knowledge/page.tsx`: 知识库列表页
- `app/knowledge/components/FileList.tsx`: 文件列表组件
- `app/knowledge/components/UploadDialog.tsx`: 上传对话框
- `pages/api/knowledge/`: 知识库相关 API

## 权限规则

- **超级管理员**: 可访问所有文档
- **租户管理员**: 可访问本租户所有文档
- **部门管理员**: 可访问本部门及下级部门文档
- **普通用户**: 可访问自己上传的、同部门共享的、组织共享的、公开的文档

## 数据库表

- **knowledge_files**: 存储文件元信息
  - `id`, `filename`, `file_path`, `visibility`, `tenant_id`, `dept_id`, `user_id`
- **knowledge_segments**: 存储文档片段和向量
  - `id`, `file_id`, `content`, `embedding` (pgvector), `metadata`

