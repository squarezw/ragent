# App Router 页面开发指南

## 知识库引用

本目录下的所有页面开发请参考以下索引知识库：

- @Next.js - Next.js 15 App Router 官方文档和最佳实践
- @React - React 19 官方文档和最佳实践

## Next.js App Router 规范

### 文件约定

- **页面文件**: 使用 `page.tsx` 作为页面入口
- **布局文件**: 使用 `layout.tsx` 定义布局
- **加载状态**: 使用 `loading.tsx` 定义加载 UI
- **错误处理**: 使用 `error.tsx` 定义错误边界
- **路由组**: 使用 `(group)` 组织路由但不影响 URL

### 组件类型

- **服务端组件** (默认): 无需特殊标记，用于数据获取和静态渲染
- **客户端组件**: 必须使用 `"use client"` 指令，用于交互和浏览器 API

### 数据获取

- 优先使用 Server Components 进行数据获取
- 使用 `async/await` 在 Server Components 中直接获取数据
- 客户端数据获取使用 SWR 或 React Query

### 最佳实践

参考 @Next.js 获取以下内容的最新实践：
- 路由和导航
- 数据获取和缓存
- 服务端和客户端组件
- 表单和操作
- 元数据和 SEO
- 性能优化

