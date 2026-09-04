# ============================================================
# skill-runner 文档处理镜像：ragent-skill-docs
#
# 构建：
#   scripts/build-skill-runner-images.sh --host ubuntu@api.ragents.net
#
# 用脚本而不是手敲 docker build，有两个原因：本档 FROM ragent-skill-basic，
# 顺序错了会建在旧基础上；而开发机是 arm64、生产是 x86_64，在 Mac 上手敲
# build 出来的镜像在生产起不来 —— 且 docker build 会正常成功，不报任何错。
#
# ## 分档判据：这个能力有多普遍
#
# 2026-08-23 起镜像是一棵树，本档挂在 basic 下、与 general 平级：
#
#   python:3.11-slim   125MB  （已退役，迁移 057）
#     └── basic        ~140MB  slim + curl + ca-certificates + xz-utils
#           ├── general        basic + Node 运行时
#           └── docs   ~300MB  ← 本镜像 = basic + poppler + 16 个 Python 库
#
# **刻意不从 general 继承**（用户 2026-08-23 裁定）：现在用本档的 7 个 skill 全是
# PDF/Office/表格处理，没有一个需要 Node。挂在 general 下会让它们各多背 233MB
# 用不到的运行时 —— 每个文档类 skill 都为一个自己不用的能力付钱。
#
# 代价：同时要 Node 和文档库的 skill 目前没有现成档。真出现了再开第四档，
# 而不是现在就合起来让两边分摊。
#
# 体积为 amd64（生产架构）实测。下文单个库的增量是 arm64 实测，amd64 通常更小；
# 比例关系一致。按 arm64 的数字判断「值不值得装」会把实际代价高估一半以上。
#
# 这一档服务的是「处理文档」的 skill：读写 Office/PDF、解析网页、渲染报告、
# 调 LLM。放进通用档会让每个只跑简单脚本的 skill 都拉几百 MB 用不到的东西。
#
# ## 为什么**不装 pandas**（2026-08-19 用户裁定）
#
# 三条理由，按分量排：
#
# 1. **它一个人要 200MB**（自身 71MB + numpy 等依赖），比这一档现有的全部
#    Python 库加起来还多 —— docs 档会涨到约 500MB（amd64）。
# 2. **openpyxl 已经能读写 Excel**。不做统计分析的话，pandas 是杀鸡用牛刀。
# 3. **它在这个沙箱里炸过。** 2026-08-14 生产事故：pandas 2.3.3 的类型推断
#    遇到 ICCID 这类 '898604E1012390002808'（看着像指数极大的浮点字面量）
#    会**段错误**，整个进程当场消失 —— 无异常、无 traceback、无日志。沙箱跑的
#    正是用户上传的、内容不可控的数据，这种失败方式的代价特别高。
#
# 真需要数据分析时，另分一档 `ragent-skill-data`（docs + pandas），让需要的
# skill 自己选 —— 而不是让所有文档类 skill 都背这 200MB 和那个崩溃面。
#
# ## 依赖分组（体积为实测的**镜像真实增量**，含依赖树）
#
# 【原三个业务镜像的并集，退役时合并过来】
#   openpyxl / python-docx / pydantic / requests / openai / pypdf / Pillow
#
# 【网页与文本处理，+2MB —— 几乎免费】
#   beautifulsoup4  解析 HTML；lxml 作它的解析器后端（比内置 html.parser 快得多）
#   markdownify     HTML → Markdown。抓来的网页要喂给模型，Markdown 比 HTML 省 token
#
# 【输出与模板，+4.4MB】
#   tabulate        二维数据 → Markdown/文本表格。模型要把结果列成表时的刚需
#   jinja2          模板渲染，生成 HTML / Markdown 报告
#   pyyaml          读写 YAML（配置、frontmatter）
#
# 【编码，+5.5MB】
#   chardet         猜文本编码。中文 CSV/TXT 用 GBK 存的很常见，
#                   按 UTF-8 硬读会得到乱码而不是报错 —— 那种失败最难查
#
# 【Office 与 PDF】
#   python-pptx     +2.5MB   读写 PowerPoint（生成汇报）
#   pdfplumber      +54MB    PDF **表格**抽取 + 字符级坐标。pypdf 抽不了表格
#
# ⚠️ pdfplumber 与下方的 poppler 解决的是**不同**问题，不可互相替代：
#    pdfplumber 懂表格结构但**不能渲染**；poppler 能把页面转成图但**不懂表格**。
#    要 OCR 扫描件必须有 poppler（先有图才能 OCR）；要读表格必须有 pdfplumber。
# ============================================================
FROM ragent-skill-basic:latest

ARG PIP_INDEX_URL=https://mirrors.aliyun.com/pypi/simple
ARG PIP_TRUSTED_HOST=mirrors.aliyun.com
ENV PIP_INDEX_URL=$PIP_INDEX_URL PIP_TRUSTED_HOST=$PIP_TRUSTED_HOST

# poppler-utils（+53MB）：提供 pdftoppm / pdftotext / pdfimages 等命令行工具。
#
# **PDF → 图片**这件事这一档原本做不到 —— pypdf 与 pdfplumber 都只解析、不渲染，
# 而 OCR 流程必须先有图。装它之后 `pdftoppm -png in.pdf out` 直接可用。
#
# ⚠️ 装了它**不等于**能出网：容器默认 --network none，出网仍要 exec-config 的
# needs_network=true（迁移 040）。
#
# ## 也不含 OCR 引擎，这是刻意的
#
# 沙箱只做「PDF 转图 + Pillow 处理」，识字交给平台侧的 ocr_service
# （app/services/rapid_image_ocr.py，模型随包离线）。
#
# **不装 paddleocr / paddlepaddle** 的两条理由：镜像会从几百 MB 撑到 GB 级；
# 且首次运行要联网下载模型权重，与沙箱默认 --network none 直接冲突 —— 那意味着
# 一个装了 OCR 却永远初始化不了的镜像。
#
# （这段原本记在 crp.Dockerfile 里，那一档 2026-08-19 随业务镜像退役一并删除，
#   理由本身仍然成立，所以移到这里。）
RUN apt-get update && apt-get install -y --no-install-recommends \
        poppler-utils \
    && rm -rf /var/lib/apt/lists/*

# 版本区间用 >= 而非 ==：这一档服务的是未知的 skill，钉死小版本会让某个 skill
# 因为要 openpyxl 3.2 而不得不另建镜像 —— 那正是退役业务镜像时要消除的东西。
RUN pip install --no-cache-dir \
    "openpyxl>=3.1" \
    "python-docx>=1.1" \
    "python-pptx>=1.0" \
    "pydantic>=2.0" \
    "requests>=2.32" \
    "openai>=1.109" \
    "pypdf>=6.1" \
    "pdfplumber>=0.11" \
    "Pillow>=10.0" \
    "beautifulsoup4>=4.12" \
    "lxml>=5.0" \
    "markdownify>=0.13" \
    "tabulate>=0.9" \
    "jinja2>=3.1" \
    "pyyaml>=6.0" \
    "chardet>=5.2"
