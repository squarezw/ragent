# 流程管理模块 API 接口清单

## 概述

流程管理模块目前前端为纯 Demo 状态（localStorage + demoData），无任何后端 API 调用。需要新建一套 API 来支撑全部功能。

### 服务拆分原则

| 服务 | 职责 | 说明 |
|------|------|------|
| **RAgent** (Next.js) | 前端 + 知识库/文档相关接口 | 前端页面在此，知识库迁移等与 RAgent 已有能力耦合的接口也放在此 |
| **zn-process-management** | 流程业务逻辑（新建） | 流程架构树 CRUD、XLSX 解析导入、流程文档管理、审批状态、导入导出等纯业务接口，独立服务 |
| **zn-docfuse-agent** | 手册智能生成（已有） | 手册分析/生成/下载，AI 能力集中在此（XLSX 解析后续迁出到 zn-process-management） |

```
┌──────────────────────────────────────────────────────────────────┐
│                        RAgent 前端                                │
│              (app/process-management/ 页面)                       │
└──────────┬───────────────────┬───────────────────┬───────────────┘
           │                   │                   │
           ▼                   ▼                   ▼
┌────────────────┐  ┌───────────────────┐  ┌────────────────────┐
│  RAgent API    │  │ zn-process-       │  │ zn-docfuse-agent   │
│  (Next.js)     │  │ management        │  │ (已有 FastAPI)     │
│                │  │ (新建服务)         │  │                    │
│ · 知识库查询   │  │ · 流程树 CRUD     │  │ · 手册分析         │
│ · 文件迁移     │  │ · XLSX 解析导入   │  │ · 手册生成         │
│ · 文档导出     │  │ · 文档管理        │  │ · 手册下载         │
│   (md→pdf)     │  │ · 审批流转        │  │ · 架构图           │
│                │  │ · 导入/导出/同步  │  │                    │
│                │  │ · E9 OA 流程发起  │  │                    │
│                │  │ · OA 审批回调接收  │  │                    │
└────────────────┘  └────────┬──────────┘  └────────────────────┘
                             │ ▲
                        发起流程│ │审批结果回调
                             ▼ │
                    ┌────────────────────┐
                    │  E9 OA (泛微)      │
                    │  经 IPaaS 平台转发  │
                    │  · 制度发布审批流程 │
                    └────────────────────┘
```

> **⚠ 字段命名统一：`company_code`**
>
> 公司标识统一使用 **`company_code`**（值：`ZSH`=上海ZN, `ZFZ`=福州ZL）。
> zn-docfuse-agent 当前 HandbookRequest 中使用的是 `city_code`，**需要改为 `company_code`**，保持三端一致。
> RAgent 和 zn-process-management 所有接口从一开始就使用 `company_code`。

---

## 一、zn-docfuse-agent 接口（已有）

> 服务名：ZN制度2.0智能体
> 环境变量：`DOCFUSE_AGENT_BASE_URL`（需新增）

### 1.1 健康检查

| 项目 | 内容 |
|------|------|
| 路径 | `GET /health` |
| 响应 | `{"status": "ok"}` |

### 1.2 流程架构解析（待迁移到 zn-process-management）

> **迁移计划**：以下 XLSX 解析接口当前在 docfuse-agent 中，计划迁移到 zn-process-management。
> 迁移内容：`parse_process_xlsx()` 解析逻辑 + `ProcessL1/L2/L3` 模型 + 路由。
> 迁移后 docfuse-agent 的 `/api/process/` 路由将废弃，`/api/handbook/l1-names` 也一并迁出，仅保留手册 AI 核心接口（analyze / generate / download）。
> 涉及源文件：
> - `src/docfuse/api/routes/process_arch.py` — 路由定义
> - `src/docfuse/tools/parse_process_xlsx.py` — 解析逻辑
> - `src/docfuse/models/process.py` — ProcessL1/L2/L3 模型

#### 上传 XLSX（单 Sheet）

| 项目 | 内容 |
|------|------|
| 路径 | `POST /api/process/upload-xlsx` |
| 用途 | 上传流程架构 XLSX，解析指定 sheet，返回树形 JSON |
| 参数 | `file`: UploadFile (multipart), `sheet_name`: string (默认 "流程清单-ZN") |
| 响应 | `ProcessL1[]` — L1→L2→L3 三级树形结构 |
| 错误 | 400: 非 xlsx/空文件, 422: 解析失败 |

```typescript
// ProcessL1
{
  name: string;       // L1 流程名称
  category: string;   // 运作流程/使能流程/支持流程
  owner?: string;
  children: ProcessL2[];
}
// ProcessL2
{
  name: string;
  owner?: string;
  children: ProcessL3[];
}
// ProcessL3
{
  name: string;
  description: string;
  responsible_role: string;
  involved_orgs: string;
}
```

#### 上传 XLSX（全部 Sheet）

| 项目 | 内容 |
|------|------|
| 路径 | `POST /api/process/upload-xlsx-all` |
| 用途 | 上传 XLSX，自动解析全部流程清单 sheet，按公司分组返回 |
| 参数 | `file`: UploadFile (multipart) |
| 响应 | `CompanyProcessArch[]` |
| 映射 | "流程清单-ZN"→ZSH, "流程清单-ZL"→ZFZ |

```typescript
{
  company_code: string;  // ZSH=上海ZN, ZFZ=福州ZL
  sheet_name: string;
  processes: ProcessL1[];
}
```

#### 流程列表 / 详情（TODO，未实现，直接在 zn-process-management 实现）

| 路径 | 方法 | 状态 |
|------|------|------|
| `/api/process/` | GET | 不再在 docfuse 实现，转到 zn-process-management |
| `/api/process/{process_id}` | GET | 同上 |

### 1.3 手册生成

#### ~~获取 L1 流程名列表~~（待迁移到 zn-process-management）

| 项目 | 内容 |
|------|------|
| 路径 | `GET /api/handbook/l1-names` |
| 用途 | 读取流程架构 JSON，返回 L1 名称列表，供前端下拉 |
| 参数 | `process_arch_path`: string (默认 "data/process_arch_result.json") |
| 响应 | `[{name: string, category: string}]` |
| 迁移 | → zn-process-management `GET /process-tree/l1-names`，从数据库查询而非读 JSON 文件 |

#### 提交手册分析任务

| 项目 | 内容 |
|------|------|
| 路径 | `POST /api/handbook/analyze` |
| 用途 | 异步分析源文档，提取章节候选、冲突、架构图等 |
| 响应 | `{session_id: string, status: "pending"}` |

**请求体 HandbookRequest：**
```typescript
{
  source_files: string[];       // 源文档路径列表
  l1_name: string;              // L1 流程名称
  process_arch_path?: string;   // 流程架构 JSON 路径
  author_name?: string;         // 编制人
  approver_name?: string;       // 审批人
  approved_by?: string;         // 批准人
  company_code?: string;        // "ZSH"=上海ZN, "ZFZ"=福州ZL (agent 侧原字段名 city_code，待统一)
  management_doc_name?: string; // 流程管理制度文件名
}
```

#### 查询分析状态

| 项目 | 内容 |
|------|------|
| 路径 | `GET /api/handbook/analyze/{session_id}/status` |
| 用途 | 轮询分析任务状态 |
| 响应状态 | `pending` → `running` → `completed` / `failed` |

**完成时响应 HandbookAnalyzeResponse：**
```typescript
{
  session_id: string;
  cover: HandbookCover;                  // 封面元数据
  chapter_conflicts: ChapterConflict[];  // ch1-3 多源冲突
  ch1_text: string;                      // 第1章 文件目的
  ch2_text: string;                      // 第2章 适用范围
  ch3_text: string;                      // 第3章 角色职责
  ch5_arch_path: string;                 // 第5章 架构图 PNG 路径
  ch6_chapters: L2Chapter[];             // 第6章 L2→L3 流程说明
  l3_flow_conflicts: L3FlowConflict[];   // L3 流程冲突
  appendices: AppendixItem[];            // 第7章 附录
  appendix_dedup_groups: AppendixGroup[];// 附录去重组
  removed_interfaces: RemovedInterfaceRow[];
  rewritten_interfaces: RewrittenInterfaceRow[];
  quality: HandbookQualityReport;        // 质量报告
  source_documents: dict[];
}
```

#### 提交手册生成任务

| 项目 | 内容 |
|------|------|
| 路径 | `POST /api/handbook/generate` |
| 用途 | 基于用户决策生成最终 DOCX 手册 |
| 前置 | 必须先调用 `/analyze` 获取 session_id |
| 响应 | `{session_id: string, status: "pending"}` |

**请求体 HandbookGenerateRequest：**
```typescript
{
  session_id: string;
  decisions: {
    chapter_picks: Record<string, string>;      // ch1/ch2/ch3 → candidate_id 或 "custom"
    chapter_custom_texts: Record<string, string>;// ch1/ch2/ch3 → 自定义文本
    l3_flow_picks: Record<string, string>;       // conflict_id → source_file 或 "merge"
    appendix_dedup: Record<string, string>;      // group_id → source_file 或 "keep_all"
  }
}
```

#### 查询生成状态

| 项目 | 内容 |
|------|------|
| 路径 | `GET /api/handbook/generate/{session_id}/status` |
| 响应 | `{status, session_id, output_path?, error?}` |

#### 下载手册

| 项目 | 内容 |
|------|------|
| 路径 | `GET /api/handbook/download/{session_id}` |
| 用途 | 下载生成的 DOCX 文件 |
| 响应 | FileResponse (application/docx) |
| 前置 | generate 状态必须为 completed |

### 1.4 静态资源

| 路径 | 用途 |
|------|------|
| `GET /static/output/{path}` | 访问输出图片（架构图等） |

---

## 二、zn-process-management 接口（新建服务）

> 独立的流程业务服务，管理流程架构树、流程文档、审批等。
> 环境变量：`PROCESS_MGMT_BASE_URL`（需新增）
> 建议路径前缀：`/api/v1/`

### 2.1 流程架构树

| # | 方法 | 路径 | 用途 | 备注 |
|---|------|------|------|------|
| 1 | GET | `/process-tree` | 获取完整流程架构树 | 支持 `?company_code=ZSH` 过滤 |
| 2 | POST | `/process-tree/import` | 导入流程架构（上传 XLSX） | 自身解析，不依赖外部服务（从 docfuse 迁入解析逻辑） |
| 3 | POST | `/process-tree/parse-xlsx` | 解析 XLSX 返回树形 JSON（不入库） | 预览用，前端可先展示再确认导入 |
| 4 | POST | `/process-tree/parse-xlsx-all` | 解析全部 sheet，按 company_code 分组 | 同上，多公司场景 |
| 5 | POST | `/process-tree/sync` | 同步流程架构 | 与外部系统同步 |
| 6 | GET | `/process-tree/export` | 导出流程架构 | JSON / Excel |
| 7 | GET | `/process-tree/l1-names` | 获取 L1 流程名列表 | 供手册生成等场景的下拉选项（从 docfuse 迁入） |

### 2.2 流程节点 CRUD

| # | 方法 | 路径 | 用途 | 备注 |
|---|------|------|------|------|
| 8 | GET | `/process-nodes/{id}` | 获取单个节点详情 | 含子节点、关联文档数量 |
| 9 | POST | `/process-nodes` | 创建节点 | L1/L2/L3，需 parent_id |
| 10 | PUT | `/process-nodes/{id}` | 更新节点 | name, description, owner, role, org |
| 11 | DELETE | `/process-nodes/{id}` | 删除节点 | 级联删除子节点及关联文档 |

### 2.3 流程文档管理

| # | 方法 | 路径 | 用途 | 备注 |
|---|------|------|------|------|
| 12 | GET | `/process-nodes/{id}/documents` | 获取节点关联文档列表 | |
| 13 | POST | `/process-documents` | 上传/创建文档 | 关联到节点 |
| 14 | GET | `/process-documents/{id}` | 获取文档详情 | 含内容/预览 |
| 15 | PUT | `/process-documents/{id}` | 更新文档内容 | |
| 16 | DELETE | `/process-documents/{id}` | 删除文档 | |
| 17 | PUT | `/process-documents/{id}/status` | 更新文档状态 | draft / reviewing / approved / offline |
| 18 | POST | `/process-documents/{id}/review` | 提交文档审核 | 一步完成：改 status + 自动调 E9 |

### 2.4 文档合并（调用 docfuse-agent）

| # | 方法 | 路径 | 用途 | 调用外部 |
|---|------|------|------|----------|
| 19 | POST | `/document-merge` | 多文档合并分析（冲突检测） | **docfuse**（待扩展） |
| 20 | GET | `/document-merge/{session_id}/status` | 查询合并状态 | **docfuse**（待扩展） |
| 21 | GET | `/document-merge/{session_id}/result` | 获取合并结果 | **docfuse**（待扩展） |

### 2.5 手册生成（转发 docfuse-agent）

| # | 方法 | 路径 | 用途 | 调用外部 |
|---|------|------|------|----------|
| 22 | POST | `/handbook/analyze` | 迁移触发：提交手册分析任务 | **docfuse** `/api/handbook/analyze`，源文件为 OSS URL |
| 23 | GET | `/handbook/analyze/{session_id}/status` | 查询分析状态 | **docfuse** `/api/handbook/analyze/{id}/status` |
| 24 | POST | `/handbook/generate` | 提交手册生成 | **docfuse** `/api/handbook/generate` |
| 25 | GET | `/handbook/generate/{session_id}/status` | 查询生成状态 | **docfuse** `/api/handbook/generate/{id}/status` |
| 26 | GET | `/handbook/download/{session_id}` | 下载手册 DOCX | **docfuse** `/api/handbook/download/{id}` |

### 2.6 导入记录

| # | 方法 | 路径 | 用途 | 备注 |
|---|------|------|------|------|
| 27 | GET | `/import-logs` | 获取导入记录列表 | |
| 28 | GET | `/import-logs/{id}` | 获取单条导入详情 | |

### 2.7 E9 OA 流程（调用泛微 E9）

| # | 方法 | 路径 | 用途 | 调用外部 |
|---|------|------|------|----------|
| 29 | POST | `/e9-workflow/submit` | 向 E9 OA 发起流程（#18 自动调用，也可独立调用重试） | **E9 OA**（经 IPaaS 转发） |
| 30 | GET | `/e9-workflow/submissions` | 获取 OA 提交记录列表 | - |
| 31 | GET | `/e9-workflow/submissions/{id}` | 获取单条提交详情 | - |

### 2.8 OA 回调接口（供 OA 系统调用）

> 鉴权：API Key + IP 白名单，非前端调用

| # | 方法 | 路径 | 用途 | 说明 |
|---|------|------|------|------|
| 32 | PUT | `/oa/callback/{oa_request_id}` | OA 审批结果通知（通过/驳回） | OA → 本服务，用 E9 流程号反查文档，幂等 |

---

## 三、RAgent API 接口（知识库/文档相关）

> 放在 RAgent 是因为这些接口依赖 RAgent 已有的知识库能力。
> 路径前缀：`/api/v1/process-management/`
> 位置：`pages/api/v1/process-management/`

### 3.1 知识库浏览 & 迁移

| # | 方法 | 路径 | 用途 | 备注 |
|---|------|------|------|------|
| 33 | GET | `/knowledge-bases` | 获取可用知识库列表 | 复用已有 KB 能力 |
| 34 | GET | `/knowledge-bases/{id}/folders` | 浏览知识库文件夹/文件 | 复用已有 KB 能力 |

> 注：迁移操作由前端编排 — 先调 RAgent #33/#34 浏览知识库获取文件 OSS URL，再直接调 zn-process-management #22 发起手册分析。不需要 RAgent 侧的编排接口。

### 3.2 文档导出

| # | 方法 | 路径 | 用途 | 备注 |
|---|------|------|------|------|
| 35 | POST | `/documents/{id}/export` | 导出文档为 Word/PDF | 可调用 markdown-to-pdf 服务 |

---

## 四、接口归属总览

| 归属服务 | 接口数量 | 说明 |
|----------|----------|------|
| **zn-docfuse-agent**（已有，迁出后） | 7 | 健康检查 + 手册 AI (5) + 静态资源 |
| **zn-process-management**（新建） | 32 (#1-32) | 流程树、XLSX 解析、节点 CRUD、文档管理、合并、手册转发、导入记录、E9 OA、OA 回调 |
| **RAgent**（已有，新增接口） | 3 (#33-35) | 知识库浏览、文档导出 |
| **合计** | **42** | |

### 需调用 docfuse-agent 的接口

| 来源服务 | 接口 | 调用外部 |
|----------|------|---------|
| zn-process-management #19-21 | 文档合并 | **docfuse** 待扩展 |
| zn-process-management #22-26 | 手册分析/生成/下载 | **docfuse** `/api/handbook/*` |
| zn-process-management #29 | E9 OA 流程提交 | **E9 OA** 经 IPaaS 转发 |

> 注：XLSX 解析和 L1 名称查询已迁入 zn-process-management 自身，不再调用 docfuse。

### 调用链路

```
前端 ──→ RAgent API ──→ zn-process-management ──┬──→ zn-docfuse-agent
  │         │                   │                │
  │         │ 知识库/导出        │ 流程业务        └──⇄ E9 OA (IPaaS)
  │         └───────────────────┘         发起流程 →  ← 审批结果回调
  │
  └──→ RAgent API (直接)
         知识库浏览、文件迁移、文档导出
```

---

## 五、环境变量

### RAgent 侧新增

| 变量名 | 说明 | 默认值 |
|--------|------|--------|
| `PROCESS_MGMT_BASE_URL` | zn-process-management 服务地址 | `http://localhost:8030` |

### zn-process-management 侧新增

| 变量名 | 说明 | 默认值 |
|--------|------|--------|
| `DATABASE_URL` | 数据库连接 | - |
| `DOCFUSE_AGENT_BASE_URL` | zn-docfuse-agent 服务地址 | `http://localhost:8020` |
| `E9_IPAAS_BASE_URL` | IPaaS 平台地址 | - |
| `E9_IPAAS_USER` | IPaaS Basic Auth 账号 | - |
| `E9_IPAAS_PASS` | IPaaS Basic Auth 密码 | - |
| `E9_APPID` | E9 许可证 APPID | - |
| `E9_DEFAULT_USERID` | E9 默认发起人 OA 用户 ID | - |
| `E9_WORKFLOW_ID` | E9 制度发布流程 ID | `114` |
| `OA_API_KEY` | OA 回调鉴权 API Key | - |
| `OA_IP_WHITELIST` | OA 回调 IP 白名单（逗号分隔） | - |

---

## 六、数据库表（zn-process-management 管理）

| 表名 | 用途 |
|------|------|
| `process_nodes` | 流程架构节点（id, parent_id, level, name, description, owner, role, org, sort_order, company_code） |
| `process_documents` | 流程关联文档（id, node_id, name, doc_number, status[draft/reviewing/approved/offline], content, file_path） |
| `import_logs` | 导入记录（id, file_name, company_code, node_count, status, imported_by） |
| `handbook_sessions` | 手册生成会话（id, session_id, l1_name, phase, status, company_code） |
| `e9_workflow_submissions` | E9 OA 提交记录（id, document_id, workflow_id, oa_request_id, status[pending/submitted/failed/approved/rejected]） |

---

## 七、待办：zn-docfuse-agent 改动项

### 7.1 `city_code` → `company_code` 改名

agent 侧以下文件需将 `city_code` 统一改为 `company_code`：

| 文件 | 涉及位置 |
|------|----------|
| `src/docfuse/api/routes/handbook.py` | `HandbookRequest.city_code` 字段定义、`_run_analyze_task` 传参 |
| `src/docfuse/handbook/orchestrator.py` | `run_handbook_analyze()` / `run_handbook_generate()` 参数 |
| `src/docfuse/handbook/assemble.py` | `assemble_handbook()` / `_build_cover()` 参数、文件编号生成逻辑 |
| `src/docfuse/cli.py` | `--city` CLI 选项改为 `--company` |

值不变：`ZSH`=上海ZN, `ZFZ`=福州ZL。

### 7.2 XLSX 解析迁出到 zn-process-management

以下文件/模块需从 docfuse-agent 迁移到 zn-process-management：

| 源文件 (docfuse-agent) | 迁移内容 | 说明 |
|------------------------|----------|------|
| `src/docfuse/tools/parse_process_xlsx.py` | `parse_process_xlsx()` 核心解析函数 | 直接迁移，解析逻辑与 AI 无关 |
| `src/docfuse/models/process.py` | `ProcessL1` / `ProcessL2` / `ProcessL3` 模型 | 数据模型 |
| `src/docfuse/api/routes/process_arch.py` | 路由定义 + `CompanyProcessArch` 模型 | 迁移后在 docfuse 中删除此路由 |
| `src/docfuse/api/routes/handbook.py` 中 `list_l1_names()` | `GET /api/handbook/l1-names` 端点 | 流程数据查询，不属于手册 AI，迁到 zn-process-management 改为查数据库 |

迁移后 docfuse-agent **仅保留手册 AI 能力**：
- 保留：`POST /api/handbook/analyze`、`GET .../status`、`POST /api/handbook/generate`、`GET .../status`、`GET /api/handbook/download/{id}`
- 删除：`/api/process/*` 全部路由、`/api/handbook/l1-names`
- docfuse-agent 的 handbook orchestrator 中如果引用了 process 模型做架构匹配，改为由 zn-process-management 传入架构 JSON，不再自行读文件解析。

---

## 八、统计

| 分类 | 数量 |
|------|------|
| zn-docfuse-agent 接口（迁出后） | **7** (健康检查 + 手册 AI 5 + 静态资源) |
| zn-process-management 新建接口 | **32** (#1-32) |
| RAgent 新增接口 | **3** (#33-35) |
| 合计 | **42** |
| 其中需调用 docfuse-agent 的 | **8** (#19-26) |
| 其中需调用 E9 OA 的 | **1** (#29) |
| 其中供 OA 回调的 | **1** (#32) |
| zn-process-management 纯业务接口 | **22** |
