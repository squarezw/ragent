# RAgent macOS 从零搭建手册（Step by Step）

> 适用：一台全新的 macOS（Apple Silicon 或 Intel），从裸机到"浏览器里能用 ragent"。
> 每步都有 ✅ 验证点，卡住就停下检查，不要跳步。
> 预计总耗时：2~4 小时（大头是下载镜像和等 license）。

---

## 阶段 〇：需要提前开口要的东西（先发消息，边等边装）

给后端负责人（Jesse）发一条消息，要三样：

1. **后端 Docker 镜像的获取方式**（Docker Hub `squarezw/ragent-service:latest`，若拉不到就要 tar 导出）
2. **开发 license**——需要先报 HWID（第 5 步会算出来，算完补发给他）
3. **最新版 `schema.sql`**（⚠️ 必须是最新，旧版缺表会导致对话接口 500）

在 `ragent/docs/assets/quickStart` 目录下有以下内容，都需要下载：
- `backend-docker/` 后端的 compose 文件与三个 skill-runner Dockerfile
- `schema.sql` 基础表结构 SQL
- `seed.sql` 种子数据的 SQL
- `env.example` 给 ragent-service 的配置
- `init-dev-env.sh` 导入 schema.sql 和 seed.sql

> ⚠️ 这些**都是从后端仓 `ragent-service` 复制过来的快照**，不是真源。
> 后端改了不会自动同步到这里，也不会报错——照着旧副本搭出来的环境跟实际的
> 不一样，而且看不出来。当前快照的版本、以及怎么刷新，见
> [`assets/quickStart/SOURCE.md`](./assets/quickStart/SOURCE.md)。

---

## 阶段一：基础工具（30 分钟）

### 1. 装 Homebrew（macOS 包管理器，后面全靠它）

```bash
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
```

装完按提示把 brew 加入 PATH（终端会打印两条 `eval` 命令，复制执行）。

✅ 验证：`brew --version` 有版本号输出

### 2. 装 Node.js 和 pnpm

```bash
brew install node pnpm
```

> 项目要求 Node ≥ 22.6（测试要用类型剥离特性），brew 装的一般是新版，够用。

✅ 验证：`node --version` ≥ v22.6；`pnpm --version` 有输出

### 3. 安装 Docker Desktop

```bash
brew install --cask docker
open -a Docker        # 首次启动，按 GUI 提示完成授权（输入密码、接受条款）
```

等待鲸鱼图标稳定。⚠️ 如果终端里 `docker` 找不到命令：Docker CLI 在 `~/.docker/bin`，把它加进 `~/.zprofile`：

```bash
echo 'export PATH="$PATH:$HOME/.docker/bin"' >> ~/.zprofile
```

（新开终端生效；Docker Desktop 正常会自动写这行）

✅ 验证：`docker version` 同时显示 Client 和 Server 版本

### 4. 配置国内镜像加速（关键，否则拉不动镜像）

Docker Hub 国内直连不通，需要加速器。以轩辕镜像为例：

1. 到 https://www.xuanyuan.run 注册账号
2. Docker Desktop → Settings → Docker Engine，在 JSON 里加：

```json
{
  "registry-mirrors": ["https://docker.xuanyuan.run"]
}
```

3. Save & Restart
4. 终端登录（凭据存下来，过期会报"请先登录"）：

```bash
docker login docker.xuanyuan.run
```

✅ 验证：`docker info | grep -A2 'Registry Mirrors'` 能看到加速器地址

> **代理提示**：如果你机器上有本地代理（如 127.0.0.1:8118），Docker Desktop 的 Proxies 设置**保持 System 模式**即可——加速器是国内源，直连更快；只有访问 Docker Hub 本身才需要代理。

---

## 阶段二：后端栈目录搭建（20 分钟）

### 5. 生成机器标识并计算 HWID（补发给 Jesse）

```bash
mkdir -p ~/.ragent
[ -s ~/.ragent/machine-id ] || uuidgen | tr 'A-Z' 'a-z' > ~/.ragent/machine-id
python3 -c "import hashlib;print(hashlib.sha256(open('$HOME/.ragent/machine-id').read().strip().encode()).hexdigest()[:32])"
```

输出的 32 位十六进制就是 **HWID**，发给 Jesse 签 license。
⚠️ `~/.ragent/machine-id` 生成后**永远不要再改**——改了 HWID 就变，license 作废。

✅ 验证：`cat ~/.ragent/machine-id` 有值且你已把 HWID 发出去

### 6. 建目录、放材料

选定后端栈根目录（示例用 `~/workspace/ragent-stack`，下同）：

```bash
mkdir -p ~/workspace/ragent-stack && cd ~/workspace/ragent-stack

# 把材料包文件放进来：docker.zip、seed.sql、env.example、init-dev-env.sh
# 然后整理成脚本期望的结构：
mkdir -p docker scripts docker/db uploads
unzip docker.zip -x "__MACOSX/*" -d docker/          # 解压 compose 文件
cp schema.sql docker/db/schema.sql                    # 建库脚本从这个路径读
cp init-dev-env.sh scripts/ && chmod +x scripts/init-dev-env.sh
```

✅ 验证：`ls docker/` 有 4 个 yml；`ls scripts/` 有 init-dev-env.sh；`docker/db/schema.sql` 存在

### 7. 生成配置和密码

```bash
cd ~/workspace/ragent-stack
PG_PW=$(openssl rand -hex 12); RD_PW=$(openssl rand -hex 12); NJ_PW=$(openssl rand -hex 12); JWT=$(openssl rand -hex 24)

cp env.example .env
sed -i '' \
  -e "s|^POSTGRES_PASSWORD=.*|POSTGRES_PASSWORD=${PG_PW}|" \
  -e "s|^REDIS_PASSWORD=.*|REDIS_PASSWORD=${RD_PW}|" \
  -e "s|^NEO4J_PASSWORD=.*|NEO4J_PASSWORD=${NJ_PW}|" \
  -e "s|^JWT_SECRET_KEY=.*|JWT_SECRET_KEY=${JWT}|" \
  -e "s|^HUGGINGFACE_CACHE_DIR=.*|HUGGINGFACE_CACHE_DIR=./data/hf-cache|" \
  -e "s|^MODELSCOPE_CACHE_DIR=.*|MODELSCOPE_CACHE_DIR=./data/modelscope|" .env

cp .env docker/.env                                  # compose 从自己目录读 .env
printf 'POSTGRES_PASSWORD=%s\nREDIS_PASSWORD=%s\nNEO4J_PASSWORD=%s\nJWT_SECRET=%s\n' "$PG_PW" "$RD_PW" "$JWT" > .credentials.txt
chmod 600 .credentials.txt
echo "$JWT" > /tmp/jwt_secret                        # 阶段四前端要用，先存着

mkdir -p docker/data/{postgres,redis,hf-cache,modelscope} docker/data/neo4j/{data,logs,import,plugins}
printf '{\n  "default_agent_id": "",\n  "agents": []\n}\n' > wechat_agents.json   # 企微 stub，防挂载建目录
```

> 两处改动的原因：HF/ModelScope 缓存路径原值是 Linux 的 `/home/ubuntu/...`，macOS 上挂载会失败。

✅ 验证：`cat .credentials.txt` 四行密码齐全

### 8. 写 macOS 的 license 挂载覆盖层

新建 `docker/docker-compose.mac.yml`（⚠️ volumes 在多 compose 文件间是**整体替换**，必须把基础文件的挂载整段抄过来再加 license 两行）：

```yaml
# 用法: docker compose -f docker-compose.yml -f docker-compose.mac.yml up -d
services:
  ragent-service:
    volumes:
      # ── License（macOS 家目录是 /Users/<你>）──
      - /Users/你的用户名/.ragent/machine-id:/etc/host-machine-id:ro
      - /Users/你的用户名/.ragent/license.lic:/app/license.lic:ro
```

把 Jesse 签回来的 `license.lic` 放到 `~/.ragent/license.lic`。

✅ 验证：`ls ~/.ragent/` 同时有 machine-id 和 license.lic

---

## 阶段三：数据库与后端（40 分钟 + 下载等待）

### 9. 起三大存储容器

```bash
cd ~/workspace/ragent-stack/docker
docker compose up -d postgres redis neo4j
```

首次要拉三个镜像（约 1.7GB），走加速器一般 5~20 分钟。**拉取中断报 `unexpected EOF` 是网络抖动，重跑同一条命令即可**（已下载的层不会重来）。

✅ 验证：`docker ps` 三个容器 Up，redis/neo4j 显示 healthy

### 10. 建库（48 张表 + 种子数据）

```bash
cd ~/workspace/ragent-stack
scripts/init-dev-env.sh
```

预期输出结尾：`✅ 初始化完成 / 登录账号：admin / 123456`。
中间"⚠️ 跳过：宿主机 python 连不上数据库"（同步内置技能那步）**属正常**——无后端源码必然跳过。

✅ 验证：`docker exec postgres psql -U postgres -d ragent -c '\dt' | wc -l` 有大量表

### 11. 拉后端镜像（13.9GB，最漫长的一步）

```bash
docker pull squarezw/ragent-service:latest
```

加速器正常的话约 10~40 分钟。若加速器报"请先登录"→ 回到第 4 步重新 `docker login`。

✅ 验证：`docker images squarezw/ragent-service` 能看到，约 13.9GB

### 12. 起后端

```bash
cd ~/workspace/ragent-stack/docker
docker compose -f docker-compose.yml -f docker-compose.mac.yml up -d ragent-service
```

⚠️ 出现 `platform (linux/amd64) does not match (linux/arm64)` **是警告不是错误**（Apple Silicon 上用 Rosetta 模拟，能跑）。

✅ 验证（启动要 10~30 秒，多等会儿）：

```bash
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:8010/docs   # 期待 200
docker logs --tail 20 ragent-service     # 有 Uvicorn running 字样
```

---

## 阶段四：前端（20 分钟）

### 13. 拿前端代码、装依赖

```bash
cd ~/git_project      # 或你的代码目录
git clone <前端仓库地址> ragent     # 已有就跳过
cd ragent
pnpm install
```

✅ 验证：`ls node_modules` 存在且 `pnpm --version` 正常输出

### 14. 配前端 .env

```bash
cd ~/git_project/ragent
cp env.example .env
JWT=$(cat /tmp/jwt_secret)     # 阶段一存的那个，必须与后端 JWT_SECRET_KEY 逐字节一致！
PG_PW=$(grep '^POSTGRES_PASSWORD=' ~/workspace/ragent-stack/.credentials.txt | cut -d= -f2)
sed -i '' \
  -e "s|^DATABASE_URL=.*|DATABASE_URL=postgresql://postgres:${PG_PW}@localhost:5432/ragent|" \
  -e "s|^JWT_SECRET=.*|JWT_SECRET=${JWT}|" .env
```

检查三行关键值：`DATABASE_URL` 指 localhost:5432、`JWT_SECRET` 与后端一致、`EXTERNAL_API_BASE_URL=http://localhost:8010`。
⚠️ 不要用追加方式写 .env——dotenv 先出现的键生效，追加的会被忽略。

✅ 验证：`grep -cE '^DATABASE_URL=' .env` 输出 1（无重复键）

### 15. 起前端并总验收

```bash
pnpm dev        # 终端会常驻，另开窗口做事
```

✅ 最终验收四连：

```bash
docker ps --format '{{.Names}}' | wc -l                       # ≥ 4 个容器
curl -s -o /dev/null -w '%{http_code}' http://localhost:8010/docs   # 200
curl -s -o /dev/null -w '%{http_code}' http://localhost:3000        # 200
```

浏览器 **http://localhost:3000** → 登录 `admin / 123456` → 发起一次对话有回复 = 全链路通。

---

## 本手册浓缩的八条血泪教训

1. license 和 machine-id 绑定，machine-id 一旦生成**永不修改**
2. macOS 家目录是 `/Users/xxx`，看到 `/home/xxx` 的配置一律要改
3. **永远不要**带 `docker-compose.dev.yml` 起容器（无源码必炸，还会误建空目录）
4. schema.sql 必须用最新版——旧版缺表，对话接口 500
5. 改 `.env` 后用 `up -d` 重建，`restart` 不重读配置
6. 前后端 JWT 密钥必须逐字节一致，否则永远 401
7. `.env` 改值要原地替换，不能追加（dotenv 先到先得）
8. 拉镜像 `unexpected EOF` 是网络抖动，重试即可，不用怀疑人生

---
*配套文档：`.credentials.txt`（密码）。两份一起备份到私人网盘——不在任何 git 仓库里。*
