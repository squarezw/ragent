# ============================================================
# skill-runner 通用镜像：ragent-skill-general = basic + Node 运行时
#
# 构建：
#   scripts/build-skill-runner-images.sh --host ubuntu@api.ragents.net
#
# 顺序由 FROM 行推出（basic 先建）。手敲 docker build 也行，但开发机是 arm64、
# 生产是 x86_64 —— 在 Mac 上建出来的镜像在生产起不来，而 docker build 会正常
# 成功、不报任何错。
#
# ## 这一档给谁用
#
#   python:3.11-slim   （已退役，迁移 057）
#     └── basic        slim + curl + ca-certificates + xz-utils
#           ├── general  ← 本镜像：basic + Node + npm + npx
#           └── docs     basic + poppler + 16 个 Python 库
#
# general 与 docs 是**兄弟**：Node 类 skill 不背文档库，文档类 skill 不背 Node。
# 同时需要两者的 skill 目前没有现成档 —— 真出现了再开第四档，而不是现在就合起来
# 让两边都分摊对方的体积。
#
# ## ⚠️ 装了 npx **不等于** `npx <包名>` 能用
#
# 这条必须先看，否则一定会踩：
#
# 1. **沙箱默认 `--network none`**（出网要 exec-config 的 needs_network=true，迁移 040）。
#    而 `npx <pkg>` 的模型就是"去 npm registry 下包再执行"。无网时它**不快速失败，
#    而是卡在 registry 超时上** —— 实测跑了十几分钟没返回。一个 skill 因此挂死，
#    比立刻报错难查得多。
# 2. **`/tmp` 挂的是 `noexec`**（见 skill_exec.py：「落地脚本不可执行」）。npx 下载的包
#    若带可执行入口，落到唯一可写的地方就是不可执行的。
# 3. **根文件系统 `--read-only`，且以 `--user <uid:gid>` 跑**，HOME 不可写。npm 默认往
#    `~/.npm` 写缓存，所以下面把 NPM_CONFIG_CACHE 指到 /tmp —— 但那又撞上第 2 条。
#
# **所以这一档提供的是「Node 运行时」，不是「任意 npm 包随取随用」。**
# 要跑固定的几个 npm 工具，正确做法是在构建时 `npm install -g <那几个包>` 装进镜像：
# 运行时零网络、零下载，也不碰 noexec。需要哪些包就在下面加一层 RUN，
# 而不是让每个 skill 自己 npx。
#
# ## 为什么用官方 tarball 而不是 apt
#
# `apt install nodejs npm` 实测 **+233MB**（Debian bookworm 的 Node 20.19.2 + npm 9.2.0），
# 因为 apt 会带一整串推荐依赖。官方 tarball 自带 npm/npx，压缩包 28MB，
# 解开后再裁掉 include/share/docs/man，比 apt 小得多，且版本能自己钉。
#
# 解 `.tar.xz` 需要 `xz`，而 python:3.11-slim **没有** —— 这就是 2026-08-23 第一次尝试
# 直接 exit 2 的原因（报错来自 tar，看不出是缺解压器）。`xz-utils` 已作为基础包
# 放进 basic，所以这里能直接用。
# ============================================================
FROM ragent-skill-basic:latest

# 版本钉死到具体小版本。这一档是别人 skill 的运行环境，让它跟着 "lts" 之类的
# 浮动标签走，等于让某天的上游发布悄悄改变所有 Node 类 skill 的行为。
ARG NODE_VERSION=22.11.0
ARG NODE_DIST_BASE=https://mirrors.aliyun.com/nodejs-release

# TARGETARCH 由 buildkit 自动填充（amd64 / arm64 / ...），声明即可用。
#
# **不能把架构写死。** 第一版硬编码了 `linux-x64`：生产是 amd64 所以一切正常，
# 而在开发机（arm64，Apple Silicon）上构建会下载 x64 的二进制，然后
# `node --version` 以 exit 133 失败 —— 报错来自 node 自己，看不出是下错了架构。
# 生产跑得通恰恰是掩盖物：只有另一种架构才会撞出来。
ARG TARGETARCH

# PATH 必须在安装步骤**之前**声明，两个原因：
#
# 1. **同一个 RUN 里用不到后面才声明的 ENV**。`ENV` 只影响它之后的指令，
#    所以装完 Node 那步末尾的 `node --version` 会以 exit 127 失败 ——
#    看起来像"Node 没装上"，实际是它不在 PATH 上。
# 2. 把整个 bin 目录加进 PATH，而不是逐个往 /usr/local/bin 打软链。
#    `npm install -g` 装的可执行文件落在 /usr/local/lib/nodejs/bin/ 下；
#    只软链 node/npm/npx 三个的话，之后每预装一个包都得记得补一条软链，
#    漏了的表现是 **exit 127 / command not found** —— 而包其实装成功了。
#    加 lark-cli 时就是这么撞的：npm install 报成功，紧接着找不到命令。
#
# 目录此刻还不存在，PATH 里放一个不存在的路径无害。
ENV PATH=/usr/local/lib/nodejs/bin:$PATH

# 一层 RUN 装完并清干净：分成多层的话，中间层里那个 28MB 压缩包会永久留在
# 镜像历史里（后续层 rm 掉也不会缩小镜像）。
#
# --strip-components=1 去掉 tarball 顶层的 node-vX-linux-<arch>/ 目录。
#
# 裁掉的四项都不是运行所需：
#   include/         C++ 头文件，只有编译原生模块才要
#   share/           man 页与文档
#   npm/docs npm/man npm 自己的文档
RUN set -eux; \
    # Node 的发布物用 x64 而不是 amd64，其余架构名与 docker 一致。
    # 未知架构直接失败，不猜 —— 猜错会产出装了错架构二进制的镜像，
    # 而它只在**运行时**才以 exec format error 暴露。
    case "${TARGETARCH:-amd64}" in \
      amd64) NODE_ARCH=x64 ;; \
      arm64) NODE_ARCH=arm64 ;; \
      *) echo "不支持的架构 TARGETARCH=${TARGETARCH}" >&2; exit 1 ;; \
    esac; \
    curl -fsSL "${NODE_DIST_BASE}/v${NODE_VERSION}/node-v${NODE_VERSION}-linux-${NODE_ARCH}.tar.xz" \
        -o /tmp/node.tar.xz; \
    mkdir -p /usr/local/lib/nodejs; \
    tar -xJf /tmp/node.tar.xz -C /usr/local/lib/nodejs --strip-components=1; \
    rm -f /tmp/node.tar.xz; \
    rm -rf /usr/local/lib/nodejs/include \
           /usr/local/lib/nodejs/share \
           /usr/local/lib/nodejs/lib/node_modules/npm/docs \
           /usr/local/lib/nodejs/lib/node_modules/npm/man; \
    node --version; \
    npm --version

# 沙箱以非 root 跑且 HOME 不可写，npm 默认的 ~/.npm 会写失败。
# 指到 /tmp（tmpfs）。注意这**不能**让 `npx <pkg>` 变得可用 —— /tmp 是 noexec，
# 见头部第 2 条。这里只是让 `npm --version`、`npm ls` 这类不写盘的命令不报错。
ENV NPM_CONFIG_CACHE=/tmp/.npm \
    NPM_CONFIG_UPDATE_NOTIFIER=false \
    NODE_PATH=/usr/local/lib/nodejs/lib/node_modules

# ── 预装的 npm 工具 ──────────────────────────────────────────
#
# 这正是头部说的"正确做法"：要用的包在**构建时**装进镜像，运行时零网络、
# 零下载、不碰 noexec。skill 直接调 `lark-cli ...`，不需要 npx。
#
# 版本钉到具体小版本，理由同 NODE_VERSION：这是别人 skill 的运行环境，
# 跟着 latest 走等于让某天的上游发布悄悄改变行为。
# 1.0.89：2026-08-23 生产会话 #1965 里模型自己装到的就是这个版本。
# 钉一个比实际在用的更旧的版本，等于让预装反过来降级用户已经验证过的东西。
ARG LARK_CLI_VERSION=1.0.89

# lark-cli（@larksuite/cli）：飞书/Lark 的命令行客户端，发消息、读文档、
# 建表格等。平台自己的 feishu-notify 就是走它。
#
# ⚠️ 装进来**不等于**能用，还差两样，都不是镜像能提供的：
#
# 1. **网络**。它要调飞书开放平台 API，而沙箱默认 `--network none`。
#    用它的 skill 必须在 exec 配置里开 needs_network=true（迁移 040）。
# 2. **凭据**。它按 `$HOME/.lark-cli/config.json` 存 appId/appSecret/token。
#    basic 已把 HOME 指到 /tmp（tmpfs 可写），所以运行时可以现场初始化：
#
#        echo "$LARK_APP_SECRET" | lark-cli config init \
#          --app-id "$LARK_APP_ID" --app-secret-stdin
#        lark-cli im +messages-send --chat-id ... --content ...
#
#    LARK_APP_ID / LARK_APP_SECRET 由使用者自己在该 skill 的个人环境变量里配
#    （迁移 041），**平台不代持，镜像里也绝不烧任何人的凭据**。
#
# 实测过 lark-cli 认 HOME：把 HOME 指到别处时它在那儿建 .lark-cli/ 并报
# "not configured"，不会去读别的配置。所以 tmpfs 方案成立。
RUN npm install -g --no-fund --no-audit "@larksuite/cli@${LARK_CLI_VERSION}" \
    && npm cache clean --force \
    && lark-cli --version
