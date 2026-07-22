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
