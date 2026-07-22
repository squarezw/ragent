# 知识库全部分段功能说明

## 背景

知识库原有分段入口主要面向单个文件或用户手动选择的一组文件。对于已经上传但尚未完成分段的文件，用户需要逐页筛选和手动触发处理，操作成本较高。

本次变更新增“全部分段”入口，用于对当前知识库中所有未分段文件统一提交分段处理，并在 Next.js API 层增加短期内存队列，避免一次性提交过多文件导致外部分段服务并发压力过大。

## 用户入口

- 入口位置：用户点击知识库文件列表右侧统计区的“未分段”统计后，在未分段筛选状态下展示。
- 按钮文案：`segmentAll`，中文显示为“全部分段”。
- 按钮图标：`lucide-react` 的 `Rocket`。
- 展示条件：
  - 当前处于未分段筛选状态。
  - 当前知识库未分段数量大于 0。
- 禁用条件：
  - 全部分段提交中。

点击按钮后会先展示确认弹窗，提示用户：

- 将处理当前知识库中的未分段文件。
- 只处理 `pending` 和 `failed` 状态文件。
- 每批最多处理的文件数来自 `SEGMENT_ALL_BATCH_SIZE` 常量。
- 提交后自动切换到未分段列表，方便观察状态变化。

## 前端流程

主要文件：

- `app/knowledge/components/FileFilter.tsx`
- `app/knowledge/page.tsx`
- `messages/zh-CN/knowledge.json`
- `messages/en/knowledge.json`

流程如下：

1. `FileFilter` 在未分段统计旁渲染“全部分段”按钮。
2. `KnowledgePage` 接收按钮点击事件，打开 `AlertDialog` 确认弹窗。
3. 用户确认后，前端调用 `POST /api/knowledge/vectorize-unsegmented-files`，请求体包含当前 `dataset_id`。
4. 接口返回后，前端根据返回的 `started_count`、`queued_count`、`skipped_count` 展示不同 toast：
   - 无需处理：提示暂无需要分段的文件。
   - 只有启动处理：提示已开始处理数量。
   - 有排队文件：提示已开始处理数量和排队数量。
   - 有重复或正在处理文件：额外提示跳过数量。
5. 提交成功后自动切换到 `unsegmented` 状态过滤列表，并触发列表刷新。

确认弹窗中的批次大小不要写死，应使用：

```typescript
import { SEGMENT_ALL_BATCH_SIZE } from "@/lib/knowledgeVectorizationConfig";
```

并通过 i18n 参数传入：

```typescript
t("segmentAllConfirmBatching", { batchSize: SEGMENT_ALL_BATCH_SIZE })
```

## 后端接口

主要文件：

- `pages/api/knowledge/vectorize-unsegmented-files.ts`
- `lib/knowledgeVectorizationConfig.ts`

接口：

```http
POST /api/knowledge/vectorize-unsegmented-files
```

请求体：

```json
{
  "dataset_id": "dataset uuid"
}
```

返回示例：

```json
{
  "started_count": 5,
  "queued_count": 12,
  "skipped_count": 0,
  "total_candidates": 17
}
```

接口职责：

1. 校验请求方法，只允许 `POST`。
2. 通过 `getUserIdFromRequest` 校验登录状态。
3. 校验 `dataset_id`。
4. 使用 `can_edit_dataset(userId, dataset_id)` 校验用户是否有权限处理该知识库。
5. 从 `knowledge_files` 查询当前知识库内状态为 `pending` 或 `failed` 的文件：

```sql
SELECT id
FROM knowledge_files
WHERE dataset_id = $1
  AND status IN ('pending', 'failed')
ORDER BY upload_time ASC
```

6. 过滤掉当前进程内已排队、处理中或短期内已提交过的文件。
7. 如果还有空闲文件槽位，先同步提交第一批到外部分段服务。
8. 剩余文件进入内存队列，由后台消费者继续处理。

## 队列和并发控制

队列是 Next.js API 进程内的短期内存队列，适合当前短期方案。它不是持久化任务队列，服务重启、横向多实例部署或 Serverless 冷启动都会丢失内存状态。

共享常量位于 `lib/knowledgeVectorizationConfig.ts`：

```typescript
export const SEGMENT_ALL_BATCH_SIZE = 5;
export const SEGMENT_ALL_MAX_CONCURRENT_BATCHES = 1;
```

含义：

- `SEGMENT_ALL_BATCH_SIZE`：单次提交给外部分段服务的最大文件数。
- `SEGMENT_ALL_MAX_CONCURRENT_BATCHES`：用于计算当前 Next.js 进程内允许同时等待完成的文件槽位数。

当前最大文件槽位数为 `SEGMENT_ALL_BATCH_SIZE * SEGMENT_ALL_MAX_CONCURRENT_BATCHES`。当前配置表示最多同时等待 5 个文件完成，单次请求最多提交 5 个文件。

队列维护了三个集合用于短期查重：

- `queuedFileIds`：已进入等待队列的文件。
- `runningFileIds`：已提交给外部服务、当前仍在等待终态的文件。
- `submittedFileIds`：短期内已提交过的文件，用 TTL 覆盖外部服务更新数据库状态前的时间窗口。

批次提交后不会立刻释放文件槽位。接口会轮询 `/api/knowledge/file-status`，当前批次中某个文件不再是 `pending` 或 `processing` 后，就会释放该文件对应的槽位并触发队列补位。这样可以在保持总并发上限的同时，避免一批里单个慢文件阻塞后续文件提交。

## 状态范围

“全部分段”只处理数据库中以下状态：

- `pending`
- `failed`

不会主动处理：

- `processing`
- `indexed`
- 当前进程内已排队或已提交的文件

前端未分段列表最终展示哪些文件，仍由文件列表接口和外部服务的 `status=unsegmented` 实现决定。本次新增接口只负责确定可提交处理的候选文件。

## 外部服务调用

实际分段处理仍由外部服务完成。Next.js API 会调用：

```http
POST {EXTERNAL_API_BASE_URL}/api/v1/files/embed
```

请求体：

```json
{
  "file_ids": ["1", "2", "3"],
  "force": false
}
```

`force: false` 表示不强制重建已经完成的文件，配合当前接口的状态过滤，避免对已完成文件重复分段。

## 配置和文案维护

批次大小和最大并发配置应统一维护在 `lib/knowledgeVectorizationConfig.ts`，不要在页面文案或 API 中重复写死数字。

i18n 文案中批次大小使用参数占位：

```json
{
  "segmentAllConfirmBatching": "系统每批最多处理 {batchSize} 个文件，其余文件会自动排队。"
}
```

英文文案同样使用 `{batchSize}`。

## 测试建议

可通过临时修改测试数据集中文件状态来验证流程：

```sql
UPDATE knowledge_files
SET status = 'pending'
WHERE dataset_id = '<dataset_id>'
  AND id IN (<file ids>);
```

建议覆盖以下场景：

1. 无未分段文件：按钮禁用或接口返回无需处理。
2. 文件数小于等于 `SEGMENT_ALL_BATCH_SIZE`：只提示已开始处理，不提示排队。
3. 文件数大于 `SEGMENT_ALL_BATCH_SIZE`：第一批开始处理，其余文件排队。
4. 重复点击：已排队、处理中或短期内已提交的文件被跳过。
5. 权限不足：接口返回 403。
6. 外部分段服务不可用或超时：接口返回对应错误，前端展示失败 toast。

测试完成后应将临时修改的文件状态恢复，避免影响后续功能验证。

## 已知限制

- 内存队列只在当前 Next.js 进程内有效，不适合多实例间全局限流。
- 进程重启会丢失队列状态，但已经提交给外部服务的文件仍由外部服务和数据库状态继续反映。
- 并发控制依赖 `/api/knowledge/file-status` 能及时返回文件状态。如果状态更新延迟，对应文件槽位释放也会延迟。
- 如果未来需要生产级全局队列，应迁移到 Redis、数据库任务表或专用队列服务。
