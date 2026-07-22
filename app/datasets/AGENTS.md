# 数据集管理模块

管理用于知识检索的数据集，支持多种配置选项。

## 主要功能

- 数据集创建和配置
- OCR 设置（图片文字识别）
- 分段策略配置
- 向量化状态管理

## 关键文件

- `app/datasets/page.tsx`: 数据集列表页
- `app/datasets/components/DatasetSettings.tsx`: 数据集设置组件
- `pages/api/datasets/`: 数据集相关 API

## API 端点

- `GET /api/datasets`: 获取数据集列表
- `POST /api/datasets`: 创建数据集
- `PUT /api/datasets/[id]`: 更新数据集配置
- `DELETE /api/datasets/[id]`: 删除数据集

## 数据库表

- **datasets**: 存储数据集配置
  - `id`, `name`, `config` (JSON，包含 OCR、分段策略等), `tenant_id`

