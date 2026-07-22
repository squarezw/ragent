# 知识库权限管理系统

## 概述

知识库权限管理系统是一个基于角色的文档访问控制系统，支持多种共享范围和标签分类功能。系统确保用户只能访问他们有权限查看的文档，同时提供灵活的文档管理功能。

## 核心功能

### 1. 权限控制

### 优先级检查（按顺序）

1. **超级管理员**：可以编辑所有数据集
2. **租户管理员**：可以编辑当前租户下的所有知识库
3. **创建者**：可以编辑自己创建的数据集

### 根据可见性判断（如果不是创建者）

#### `private`（私有）
- 只有创建者可以编辑（已在前面检查）

#### `dept`（部门共享）
- 创建者可以编辑（已在前面检查）
- 创建者的部门管理员可以编辑
- `owner_dept_id` 的部门管理员可以编辑

#### `tenant`（租户共享）
- 创建者可以编辑（已在前面检查）
- 创建者的部门管理员可以编辑
- 创建者的租户管理员可以编辑
- 租户管理员（如果 `owner_tenant_id = 当前用户租户`）可以编辑

#### `public`（公开）
- 创建者可以编辑（已在前面检查）
- 创建者的部门管理员可以编辑
- 创建者的租户管理员可以编辑

### 2. 标签系统

#### 标签管理
- 支持创建、编辑、删除标签
- 每个标签可以设置颜色
- 标签可以关联到多个文档
- 文档可以关联多个标签

#### 默认标签
系统预置了以下标签：
- 技术文档 (蓝色)
- 政策法规 (绿色)
- 培训资料 (橙色)
- 合同协议 (红色)
- 财务报告 (紫色)
- 人事制度 (青色)
- 项目文档 (青绿色)
- 会议纪要 (橙红色)

### 3. 文档管理

#### 上传功能
- 支持多种文件格式：PDF、Word、Excel、Markdown、CSV
- 上传时可设置共享范围和标签
- 默认共享范围为部门共享

#### 编辑功能
- 修改文件名称
- 更改共享范围
- 管理文件标签

#### 索引功能
- 支持多种分段方式：自动、按换行、按逗号、按句号、固定长度
- 实时显示索引进度
- 支持批量索引

## 数据库设计

### 1. 表结构

#### knowledge_files 表
```sql
ALTER TABLE knowledge_files 
ADD COLUMN visibility VARCHAR(20) DEFAULT 'dept' CHECK (visibility IN ('private', 'dept', 'tenant', 'public')),
ADD COLUMN owner_dept_id INTEGER REFERENCES dept(id),
ADD COLUMN owner_tenant_id INTEGER REFERENCES tenant(id);
```

#### knowledge_tags 表
```sql
CREATE TABLE knowledge_tags (
    id SERIAL PRIMARY KEY,
    name VARCHAR(100) NOT NULL UNIQUE,
    color VARCHAR(7) DEFAULT '#3b82f6',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

#### knowledge_file_tags 表
```sql
CREATE TABLE knowledge_file_tags (
    id SERIAL PRIMARY KEY,
    file_id INTEGER NOT NULL REFERENCES knowledge_files(id) ON DELETE CASCADE,
    tag_id INTEGER NOT NULL REFERENCES knowledge_tags(id) ON DELETE CASCADE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(file_id, tag_id)
);
```

### 2. 权限函数

#### can_access_knowledge_file
检查用户是否有权限访问指定文件：
```sql
CREATE OR REPLACE FUNCTION can_access_knowledge_file(
    p_user_id INTEGER,
    p_file_id INTEGER
) RETURNS BOOLEAN
```

#### get_user_accessible_files
获取用户可访问的所有文件：
```sql
CREATE OR REPLACE FUNCTION get_user_accessible_files(p_user_id INTEGER)
RETURNS TABLE (...)
```

## API 接口

### 1. 文件列表
```
GET /api/knowledge/list
```
- 返回用户有权限访问的所有文件
- 包含文件标签信息
- 按上传时间倒序排列

### 2. 文件上传
```
POST /api/knowledge/upload
```
- 支持多文件上传
- 自动设置文件所有者信息
- 支持设置共享范围

### 3. 文件更新
```
PUT /api/knowledge/update
```
- 更新文件名称和共享范围
- 需要权限验证

### 4. 标签管理
```
GET /api/knowledge/tags - 获取所有标签
POST /api/knowledge/tags - 创建新标签
PUT /api/knowledge/tags - 更新标签
DELETE /api/knowledge/tags - 删除标签
```

### 5. 文件标签关联
```
GET /api/knowledge/file-tags?file_id=xxx - 获取文件标签
POST /api/knowledge/file-tags - 设置文件标签
DELETE /api/knowledge/file-tags?file_id=xxx&tag_id=xxx - 删除文件标签
```

## 前端组件

### 1. VisibilitySelect 组件
共享范围选择组件，提供四种共享范围的可视化选择界面。

### 2. TagSelect 组件
标签选择组件，支持：
- 选择现有标签
- 创建新标签
- 设置标签颜色
- 移除已选标签

### 3. 知识库页面
主要功能：
- 文件列表展示（基于权限过滤）
- 文件上传（支持设置共享范围和标签）
- 文件编辑（修改名称、共享范围、标签）
- 批量操作（索引、删除）
- 分段详情查看

## 使用流程

### 1. 上传文档
1. 点击右下角的上传按钮
2. 选择要上传的文件
3. 设置共享范围（默认部门共享）
4. 选择或创建标签
5. 点击上传

### 2. 编辑文档
1. 在文件列表中点击编辑按钮
2. 修改文件名称
3. 调整共享范围
4. 管理文件标签
5. 保存更改

### 3. 查看文档
1. 在文件列表中查看可访问的文档
2. 通过共享范围图标了解文档权限
3. 通过标签了解文档分类
4. 点击查看按钮查看分段详情

## 权限验证

### 1. 访问控制
- 所有API接口都进行用户身份验证
- 文件访问基于数据库权限函数
- 文件修改需要所有者权限或管理员权限

### 2. 数据隔离
- 用户只能看到有权限访问的文件
- 部门数据按部门隔离
- 租户数据按租户隔离

## 性能优化

### 1. 数据库优化
- 创建了相关索引以提高查询性能
- 使用权限函数减少重复查询
- 批量操作减少数据库交互

### 2. 前端优化
- 组件懒加载
- 状态管理优化
- 批量操作减少API调用

## 安全考虑

### 1. 权限验证
- 所有操作都进行权限验证
- 防止越权访问
- 支持细粒度权限控制

### 2. 数据保护
- 文件访问基于用户身份
- 敏感信息隔离
- 操作日志记录

## 扩展性

### 1. 权限扩展
- 支持自定义权限规则
- 可扩展新的共享范围
- 支持更复杂的权限逻辑

### 2. 标签扩展
- 支持标签层级
- 支持标签权限
- 支持标签统计

### 3. 功能扩展
- 支持文档版本控制
- 支持文档评论
- 支持文档协作编辑

## 测试验证

### 1. 权限测试
- [ ] 不同角色用户访问权限验证
- [ ] 共享范围权限验证
- [ ] 越权访问防护测试

### 2. 功能测试
- [ ] 文件上传功能测试
- [ ] 标签管理功能测试
- [ ] 批量操作功能测试

### 3. 性能测试
- [ ] 大量文件加载性能
- [ ] 权限查询性能
- [ ] 批量操作性能

## 注意事项

### 1. 数据迁移
- 现有文件会自动设置默认共享范围
- 需要手动设置文件标签
- 建议逐步迁移现有数据

### 2. 用户培训
- 需要培训用户了解新的权限系统
- 解释不同共享范围的含义
- 指导用户正确使用标签功能

### 3. 监控告警
- 监控文件访问异常
- 监控权限验证失败
- 监控系统性能指标 