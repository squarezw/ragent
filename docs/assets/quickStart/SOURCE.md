# 这些文件是副本，不是真源

本目录下的部署文件全部**复制自后端仓 `ragent-service`**，为的是让快速开始文档
自成一体（照着走的人不必先拿到后端仓的访问权）。

真源在那边，这里的是某一时刻的快照：

| 这里 | 真源（ragent-service） |
|---|---|
| `schema.sql` | `docker/db/schema.sql` |
| `seed.sql` | `docker/db/seed.sql` |
| `env.example` | `env.example` |
| `backend-docker/docker-compose*.yml` | `docker/docker-compose*.yml` |
| `backend-docker/skill-runner/*.Dockerfile` | `docker/skill-runner/*.Dockerfile` |

`backend-docker/docker-compose.windows.yml` 是**例外**：真源没有这个文件，
它只为这份文档而写。

## 上次同步

**`ragent-service` dev @ `6f9e363`（2026-09-03）**

改后端不会自动更新这里，也不会有任何报错。上一次就漂了：文档写于 2026-09-03，
到 09-04 时 `general.Dockerfile` 的 Node 版本和 `docs.Dockerfile` 的 PDF 工具链
都已经变过，而副本毫无察觉。**照着旧副本搭出来的环境跟实际的不一样，且看不出来。**

## 怎么刷新

在两个仓都 clone 好的机器上：

```bash
S=/path/to/ragent-service
Q=docs/assets/quickStart
(cd "$S" && git show dev:docker/db/schema.sql)  > "$Q/schema.sql"
(cd "$S" && git show dev:docker/db/seed.sql)    > "$Q/seed.sql"
(cd "$S" && git show dev:env.example)           > "$Q/env.example"
for f in docker-compose.yml docker-compose.dev.yml docker-compose.prod.yml docker-compose.gpu.yml; do
  (cd "$S" && git show "dev:docker/$f") > "$Q/backend-docker/$f"
done
for f in basic docs general; do
  (cd "$S" && git show "dev:docker/skill-runner/$f.Dockerfile") > "$Q/backend-docker/skill-runner/$f.Dockerfile"
done
```

以 **`dev`** 为基准，不要用本地工作区——未合并的改动会把还没上线的结构写进公开文档。
（这一条踩过：`created_by` 那次差点把未发布的 schema 同步进来。）

刷新后把上面的「上次同步」改成新的 commit。
