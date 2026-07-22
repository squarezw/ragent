# RAgent - AI Agent 开发指南

面向 AI 编码工具的开发约束与项目导航。项目定位、功能介绍、部署方式见 [README.md](./README.md)，此处不重复。

部分目录有自己的 AGENTS.md（`app/`、`app/apps/`、`app/datasets/`、`app/knowledge/`、`lib/`、`pages/api/`），修改对应目录时先读局部规则，局部规则优先于本文件。

## 技术栈速览

- **框架**: Next.js 15 (App Router 页面 + pages/api API 路由), React 19, TypeScript
- **UI**: Radix UI + Tailwind CSS（shadcn 风格组件在 `components/ui/`）
- **数据获取**: SWR + React Hooks（无全局状态库）
- **可视化**: ReactFlow（工作流编辑器）, Recharts（图表）
- **i18n**: next-intl，文案在 `messages/zh-CN/` 与 `messages/en/`
- **数据**: PostgreSQL + pgvector（向量检索）; JWT 认证
- **文件处理**: formidable, pdf-parse, mammoth, xlsx
- **外部服务**: RAG/LLM 走 ragent-service 后端（`EXTERNAL_API_BASE_URL`）；OnlyOffice / kkFileView / markdown-to-pdf 见 README 架构表

注意：React Hook Form、Zod、React Force Graph 已于 2026-07 移除，不要引入它们的 import。

## 项目结构

```
ragent/
├── app/                # App Router 页面（knowledge/ chat/ apps/ datasets/ process-management/ …）
├── pages/api/          # 全部 API 路由（不要在 app/ 下建 route handler）
├── components/         # 共享组件（ui/ 为 shadcn 风格基础组件）
├── lib/                # 服务端核心逻辑（db、auth、permissions、env …）
├── hooks/              # 共享 React Hooks
├── types/              # 全局类型（含 i18n.d.ts、pdf-parse.d.ts 环境声明）
├── messages/           # i18n 文案（zh-CN / en 必须成对维护）
├── docker/             # 生产 compose 与 dev 辅助服务栈
├── deploy/             # 部署脚本
└── scripts/            # 手动 CLI 工具（不被应用代码 import）
```

## 常用命令

```bash
pnpm dev                 # 开发服务器（本机 3000）
pnpm build               # 生产构建（改动大时用它做最终验证）
pnpm test                # node --test test/*.test.ts
pnpm check:ci            # biome lint + format 检查（CI 同款）
pnpm check               # biome 自动修复
pnpm check:i18n          # 扫描代码中缺失的 i18n key
pnpm check:i18n:missing  # 对比 zh-CN/en 缺失的翻译
# 本地辅助服务（OnlyOffice/kkFileView/markdown-to-pdf）：
docker compose -f docker/docker-compose.dev.yml up -d
```

## 环境变量与密钥规范

- 全量变量与注释见 `env.example`；本地 `cp env.example .env`。
- **密钥禁止在代码里写默认值**。必填密钥用 `lib/env.ts` 的 `requireEnv("NAME")` 读取——缺失即抛错，绝不回退到硬编码值。现有必填项：`DATABASE_URL`、`JWT_SECRET`（必须与 ragent-service 的 `JWT_SECRET_KEY` 同值，否则登录 401）、`ONLYOFFICE_JWT_SECRET`（OnlyOffice 相关路由）。
- 非密钥的服务地址类变量可以有本地默认值（如 `http://localhost:8010`）。
- `NEXT_PUBLIC_*` 是构建期内联，生产运行时不可变——跨部署不同的值不要用它，改走 server component 读取。

## 代码规范

- **组件**: PascalCase（`FileList.tsx`）；**Hook**: `use` 前缀 camelCase；**API 路由文件**: kebab-case（`chat-sessions.ts`）；**类型**: PascalCase
- **服务端组件优先**，需要交互再 `"use client"`
- **新增用户可见文案必须同时进 `messages/zh-CN/` 和 `messages/en/`**，提交前跑 `pnpm check:i18n`
- **Tailwind 用语义色，不用硬编码色值**：
  - ✅ `text-primary` / `bg-primary` / `text-destructive` / `text-muted-foreground`
  - ❌ `text-blue-500` / `bg-blue-600` / `text-gray-500`
  - 语义映射：`primary` 主色、`secondary` 次要、`destructive` 危险操作、`muted` 弱化、`accent` 强调；这是主题切换功能的前提

## 关键约束与常见坑

- **多租户权限**：资源访问都要过租户/部门/角色三级校验，逻辑集中在 `lib/permissions.ts`（客户端辅助在 `lib/clientPermissions.ts`），新 API 路由不要绕过它
- **向量检索性能**：`knowledge_segments` 依赖 pgvector 索引（ivfflat, vector_cosine_ops）；慢时先查索引再调 `top_k`
- **文件链路**：上传经 OSS 服务（`OSS_SERVICE_URL`）；预览走 kkFileView、在线编辑走 OnlyOffice——三者的内网/外网地址是不同变量，改动时对照 env.example 注释
- **核心表**：users / knowledge_files / knowledge_segments / apps / datasets / roles / user_roles；完整 ERD 随数据库归属维护在 ragent-service 仓库（本仓库的 database-erd.* 已移除，勿引用）
