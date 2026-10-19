# 本地 Docker 统一登录

前端用户可以直接拉取公开的独立 ragent-auth 镜像，无需下载认证源码或从 ragent-service 启动认证进程。本配置仅用于本机开发，固定浏览器入口为 `http://127.0.0.1:3000`，认证入口为 `http://127.0.0.1:8021`。

## 前提

- Node >=22.6、pnpm、Docker Compose v2 / Docker Desktop（Linux 须支持 host-gateway）。认证镜像固定为已发布 digest，目前仅 linux/amd64，Apple Silicon 使用 Docker 模拟运行。
- 已运行兼容的 ragent-service **账户桥接**；获得其地址和已经配置的专用服务 token（至少32字符）。本工具不会更改后端或生成新的桥接 token。桥接需要绑定容器可访问的接口，且应限制网络访问。
- 前端与后端已经配置相同的用户数据库，以及匹配的 `JWT_SECRET` / `JWT_SECRET_KEY`。后端须已完成账户及 `identity_subjects` 身份映射相关迁移，空数据库不足以登录。仍需各自正常的后端 API、用户数据和其他前端必填环境变量。

这里新增的 PostgreSQL 只保存 OIDC 会话、授权码和令牌等协议数据，使用独立卷和独立随机密码，不包含账户、业务表或后端。本配置不能单独提供完整账户系统。

## 一条命令启动（推荐）

```bash
pnpm install
pnpm dev:local
```

首次缺项会交互询问 `DATABASE_URL`、`JWT_SECRET`、`ONLYOFFICE_JWT_SECRET`、`EXTERNAL_API_BASE_URL`，以及已有桥接的 `AUTH_BRIDGE_URL`、`AUTH_BRIDGE_TOKEN`。密码和 token 隐藏输入；必须填写后端实际匹配的值，不会生成业务密钥。已有配置不重复询问。桥接配置只进入受保护 auth 配置，不写入前端环境文件。

向导读取开发环境文件，优先级由低至高为 `.env`、`.env.development`、`.env.local`、`.env.development.local`、进程环境变量。首次自动备份 `.env.local` 到 `.local/env-backups/`（目录700、备份600），原子合并 OIDC 项并保留其他设置。新问到的业务必填项也保存到 `.env.local`，后续无需再问；auth 的既有密钥不重置。同一 issuer 的旧 OIDC 客户端配置会用本机受保护 overlay 更新；不同的已启用 issuer 必须确认切换，非交互可显式设置 `DEV_LOCAL_REPLACE_OIDC=true`。进程环境或 `.env.development.local` 中冲突 OIDC 值需先自行移除，防止高优先级配置悄悄覆盖。

Docker 健康后才启动 Next，监听 `0.0.0.0:3000` 以允许 Docker 的 UI 代理访问，构建输出放 `.next-local`。`pnpm dev` 不变。端口占用会提示，不会停其他进程。`Ctrl+C` 仅停止本命令的前端；Docker auth 保留运行，使用 `pnpm auth:down` 明确停止。

非 TTY 缺项会报具体变量名且不启动服务；可通过上述环境变量预置输入。首次提供后端已配置 token 请避免把明文写入命令历史，参见下方隐藏输入示例。向导不会自动安装或迁移后端用户/身份映射表。

## 初始化与启动

在仓库根目录，用隐藏输入读取已存在的桥接 token，避免将它写入命令历史（bash/zsh）：

```bash
read -r -s AUTH_BRIDGE_TOKEN
export AUTH_BRIDGE_TOKEN
# 输入 token 后回车；地址请改成实际桥接地址，不要猜端口。
export AUTH_BRIDGE_URL=http://host.docker.internal:YOUR_BRIDGE_PORT
pnpm auth:init
unset AUTH_BRIDGE_TOKEN
pnpm auth:up
```

`AUTH_BRIDGE_URL` 必须是源地址，不带路径、凭据或查询。容器访问宿主机使用 `host.docker.internal`，不要用 localhost/127.0.0.1（那会指向容器自身）。HTTP 只允许 host.docker.internal；远程桥接必须 HTTPS。

初始化产生 `.local/auth/`（目录权限700、文件600，已忽略）：独立 PostgreSQL 密码、RSA 私钥、cookie keys、客户端密钥、transaction key 及受保护运行配置。不会读取或覆盖 `.env`、`.env.local`；再次初始化保持现有配置不变。

手动把 `.local/auth/frontend.env` 中的 OIDC 项合并到你实际使用的前端环境文件；若 `.env.local` 和 `.env` 同时存在，注意 Next.js 的覆盖优先级。不要复制进公开文件、截图或工单。然后重启 `pnpm dev`。开发服务器须能由 Docker 通过 `host.docker.internal:3000` 访问。

从 `http://127.0.0.1:3000/chat` 进入登录。不要收藏带 `uid` 的临时 identity-login 链接。`localhost` 和 `127.0.0.1` 不可混用。HTTP 允许项仅在 Next.js development 模式生效；生产需 HTTPS 和专门的部署配置。

```bash
pnpm auth:status
pnpm auth:logs
pnpm auth:down
```

Compose 自动先创建协议库，再使用认证镜像内自带迁移，最后启动 auth 和 nginx。只有8021绑定宿主回环地址；数据库和8020不发布。`auth:down` 保留协议数据卷；Docker 重启可恢复运行中的长期服务（unless-stopped），手动 down 后仍须 auth:up。不使用全局清理命令。

## 排查

- 8021被占用：先确认已有独立 auth 是否可复用，别同时启动两套。全新初始化前可设置 `AUTH_PORT=18021`；issuer、前端 overlay 和端口将一致。初始化后改端口需同步三者。
- 查看发现接口：`curl --noproxy '*' http://127.0.0.1:8021/.well-known/openid-configuration`。
- 发现接口200不代表账号可登录。还需 bridge token匹配、容器可达桥接、账户数据库和 JWT 配置正确。
- 启动失败检查 Docker、镜像拉取、协议库健康及日志。不要把 `docker compose config` 的 secret 运行文件或 `.local/auth` 上传。
- 保留 `.local/auth` 和协议卷作为一组；不要单独删除配置后复用旧卷，否则新数据库密码不匹配。轮换密钥或清空协议数据须显式处理已有会话。

默认配置使用密码登录；短信/手机注册还需要后端对应能力以及 CloudBase。首次 auth:init 前可提供公开环境 ID：`export AUTH_CLOUDBASE_ENV_ID=your-public-env-id`，本工具不生成或配置任何 CloudBase 服务端密钥。

`dev:local` 不展开环境文件中的 `$VAR` / `${VAR}` 引用；有效配置含此引用时会只提示变量名并停止。请提供已解析的值，或用进程环境传入已解析值；字面美元符号在环境文件中可写作 `\$`。带 `#`、空格的 secret 请按 dotenv 规则加引号。
