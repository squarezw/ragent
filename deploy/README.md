# 部署脚本

本目录包含两种部署方式的自动化脚本。

## PM2 部署 (`start.sh`)

使用 PM2 进程管理器部署应用。

```bash
chmod +x deploy/start.sh
./deploy/start.sh
```

**常用命令：**
```bash
pm2 status              # 查看状态
pm2 logs ragent         # 查看日志
pm2 restart ragent      # 重启
pm2 stop ragent         # 停止
```

## Docker 部署 (`start-docker.sh`)

使用 Docker 容器化部署 web 服务。

```bash
chmod +x deploy/start-docker.sh

# 拉取最新镜像并启动（默认行为）
./deploy/start-docker.sh

# 只构建，不启动
./deploy/start-docker.sh --build

# 只推送镜像到 Docker Hub，不启动
./deploy/start-docker.sh --push

# 只构建和推送，不启动
./deploy/start-docker.sh --build --push

# 使用 Traefik 配置（拉取镜像并启动）
./deploy/start-docker.sh --traefik
```

**参数说明：**
- 无参数：拉取最新镜像并启动服务（默认行为，适用于生产服务器）
- `--build`：只构建镜像，不启动服务
- `--push`：只推送镜像到 Docker Hub，不启动服务（需先登录：`docker login`）
- `--build --push`：只构建和推送镜像，不启动服务
- `--traefik`：使用 Traefik 配置文件（可与上述参数组合使用）

## 数据库初始化 (`init-automation-db.sh`)

**部署前端之前必须先跑一次**，否则自动化功能整体不可用（含定时触发），而且不会有显眼的报错。

```bash
deploy/init-automation-db.sh            # 表为空则重建；有数据则拒绝并列出
deploy/init-automation-db.sh --check    # 只报告当前状态，什么都不改
deploy/init-automation-db.sh --force    # 有数据也重建（先打印将删除的行数并要求确认）
```

自动化的 10 张表结构以 `db/automation.sql` 为准。那份脚本用的全是 `CREATE TABLE IF NOT EXISTS`，
表已存在时会**静默跳过**——既不校验结构也不报错，所以在「库里的结构与代码不一致」这个场景下，
直接跑它修不好任何东西。本脚本的做法是整组推倒重建。

因此它**在有数据时会拒绝执行**：`automation_mailboxes` 里存的是加密后的 IMAP 授权码，
`automation_tasks` 里是用户建好的自动化（任务之间还会通过 `upstreamAutomationId` 互相引用）。
删掉之后用户得重新去邮箱后台申请授权码、逐条重填，而且没有任何东西会提示他们发生过什么。

库名与用户从 `.env` 的 `DATABASE_URL` 解析；默认经 `docker exec` 进名为 `postgres` 的容器，
可用 `DB_CONTAINER` / `PGUSER` / `POSTGRES_DB` 覆盖。

**跑完必须重启前端进程。** 调度器在模块加载期注册，启动时校验不过只打一行日志、不会重试——
不重启的话界面一切正常，但自动化一封邮件都不会处理。

## 部署前准备

### PM2 部署
- Node.js 已安装
- pnpm 已安装（`npm install -g pnpm`）

### Docker 部署
- Docker 已安装
- Docker Compose V2 已安装（`docker compose version`）
- 推送镜像前需登录 Docker Hub（`docker login`）

## 故障排除

**PM2：**
- 检查 Node.js 版本：`node --version`
- 检查 pnpm：`pnpm --version`
- 查看日志：`pm2 logs ragent`

**Docker：**
- 检查 Docker：`docker info`
- 检查版本：`docker compose version`
- 查看日志：`docker compose logs`
- 推送失败：确保已登录 Docker Hub
