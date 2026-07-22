# App 应用管理模块

可视化工作流编辑器，支持构建复杂的 AI 应用流程。

## 主要功能

- 工作流可视化编辑（基于 ReactFlow）
- 多种节点类型（AI、知识库、输入、输出、条件、工具）
- 节点属性配置
- 工作流与表单模式双向同步

## 节点类型

- **AI 节点**: 配置模型、温度、提示词等
- **知识库节点**: 选择数据集、配置检索参数
- **输入节点**: 定义输入平台和类型
- **输出节点**: 定义输出平台和格式
- **条件节点**: 条件判断逻辑
- **工具节点**: 外部 API 调用

## 关键文件

- `app/apps/components/WorkflowEditor.tsx`: 工作流编辑器
- `app/apps/components/NodePropertyPanel.tsx`: 节点属性面板
- `types/workflow.ts`: 工作流类型定义
- `lib/workflowUtils.ts`: 工作流工具函数

## API 端点

- `GET /api/v1/apps`: 获取应用列表
- `POST /api/v1/apps`: 创建应用
- `GET /api/v1/apps/[id]`: 获取应用详情
- `PUT /api/v1/apps/[id]`: 更新应用
- `DELETE /api/v1/apps/[id]`: 删除应用

## 数据库表

- **apps**: 存储应用配置
  - `id`, `name`, `workflow_config` (JSON), `tenant_id`

