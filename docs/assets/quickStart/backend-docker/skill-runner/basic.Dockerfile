# ============================================================
# skill-runner 基础镜像：ragent-skill-basic
#
# 构建：
#   scripts/build-skill-runner-images.sh --host ubuntu@api.ragents.net
#
# 手敲 docker build 也行，但开发机是 arm64、生产是 x86_64 —— 在 Mac 上建出来的
# 镜像在生产起不来，而 docker build 会正常成功、不报任何错。脚本把这件事挡住了。
#
# 运行形态（由 app/tools/skill_exec.py 拼装，P8 正式语义）：
#   docker run --rm --network none --read-only --tmpfs /tmp:rw,noexec,nosuid \
#     --cap-drop ALL --user <uid:gid> --security-opt no-new-privileges \
#     --memory 512m --cpus 1 \
#     -v <materialized>:/skill:ro -v <work>:/skill_work \
#     -e SKILL_WORK_DIR=/skill_work -w /skill_work \
#     ragent-skill-basic:latest bash -c '<SKILL.md 里写的命令行>'
#
# ## 分档：这一档是所有 skill 的公共底座
#
# 2026-08-23 起沙箱镜像是一棵树，不是一条链：
#
#   python:3.11-slim   125MB   纯标准库（**已退役**，见迁移 057）
#     └── basic        ~140MB  ← 本镜像 = slim + curl + ca-certificates + xz-utils
#           ├── general        basic + Node 运行时（见 general.Dockerfile）
#           └── docs           basic + poppler + 16 个 Python 库（见 docs.Dockerfile）
#
# **general 与 docs 是兄弟，不是父子。** 文档类 skill 不背 Node，Node 类 skill 不背
# 文档库 —— 那 7 个用 docs 的 skill 全是 PDF/Office/表格处理，没有一个需要 Node，
# 让它们各多拉一份 Node 运行时是纯浪费。
#
# 代价说清楚：**同时要 Node 和文档库的 skill 现在没有现成档**。真出现了再开第四档
# （docs + node），而不是现在就先把两边合起来让所有人分摊。
#
# 判据是"这个能力有多普遍"：进 basic 的东西，每一个只跑简单脚本的 skill 都要背，
# 所以门槛要高。
#
# **curl 与 xz 属于这一档，文档库和 Node 不属于。** 二者加起来只占十几 MB，
# 而 openai / pypdf / Pillow 加起来 102MB、Node 233MB —— 后者只有少数 skill 用得上。
# 把它们塞进底座，就是让每个只想跑一段简单脚本的 skill 都拉上百 MB 用不到的东西，
# 那正是原先按业务切镜像时想避免的浪费，换个形式又回来了。
#
# ## curl：外部 skill 的常见前提
#
# 第三方（尤其 WorkBuddy 导出）的 SKILL.md 普遍直接写 `curl -sS https://...`。
# python:3.11-slim **不带 curl**，那些命令在容器里会 `command not found` ——
# 而模型看到的是一句无从下手的报错，不会意识到是镜像少了个程序。
#
# ⚠️ 装了 curl **不等于**能出网：容器默认 `--network none`，要出网必须同时把
# exec-config 的 needs_network 打开（迁移 040）。两件事分开是有意的 —— 出网是
# 授权决定，不该因为镜像里恰好有个 curl 就默认放通。
# ============================================================
FROM python:3.11-slim

# 构建期 pip 源：直连 pypi.org 在国内服务器上超时（实测），而宿主机
# /etc/pip.conf 里的镜像源**不会进 build 容器**。用 ARG 而不是写死，
# 这样能连 pypi 的环境（比如 CI）不受影响：
#   docker build --build-arg PIP_INDEX_URL=https://pypi.org/simple ...
ARG PIP_INDEX_URL=https://mirrors.aliyun.com/pypi/simple
ARG PIP_TRUSTED_HOST=mirrors.aliyun.com
ENV PIP_INDEX_URL=$PIP_INDEX_URL PIP_TRUSTED_HOST=$PIP_TRUSTED_HOST

# 三个都不能省，各有一个具体的失败方式：
#
# - **curl**：第三方 SKILL.md 普遍直接写 `curl -sS https://...`。没有它就是
#   `command not found`，而模型看到的是一句无从下手的报错。
# - **ca-certificates**：没有它 curl 访问任何 https 都报证书验证失败 ——
#   而报错指向证书，不指向"镜像少装了东西"。
# - **xz-utils**：`tar -xJf` 解 `.tar.xz` 要它。slim 里**没有** xz，
#   2026-08-23 就是因为这个，用官方 tarball 装 Node 的构建直接 exit 2；
#   而报错来自 tar，看不出是镜像缺了一个解压器。上游发布物用 .tar.xz 是常态
#   （Node 官方就是），所以它属于底座而不是某一档的私事。
#
# 装完清 apt 列表，否则多留 ~40MB 且沙箱里永远用不到。
RUN apt-get update && apt-get install -y --no-install-recommends \
        curl \
        ca-certificates \
        xz-utils \
    && rm -rf /var/lib/apt/lists/*

# 沙箱以 --user <uid:gid> 跑非 root、根文件系统 --read-only，唯一可写的地方是
# /tmp（tmpfs）。所以所有"要往家目录写点东西"的默认路径都得改指过去。
#
# **HOME=/tmp 是这里最容易漏的一条。** 实测沙箱里 `HOME=/` 且不可写 ——
# 于是任何按 `~/.foo` 存配置的 CLI 都会失败，而报错通常是「permission denied」
# 或干脆是一句"未配置"，看不出根因是 HOME 指向一个只读目录。
#
# 改它不会破坏任何现在能工作的东西：现在往 HOME 写**一定**是失败的。
#
# 不在这里 `mkdir /tmp/...`：运行时 `--tmpfs /tmp` 会盖掉镜像里的 /tmp，
# 镜像里建的目录一个也看不到。需要子目录的工具自己建（tmpfs 可写）。
ENV HOME=/tmp \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    XDG_CACHE_HOME=/tmp/.cache \
    MPLCONFIGDIR=/tmp/.cache
