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
#           └── docs   ~327MB  ← 本镜像 = basic + 17 个 Python 库
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
#   pdfplumber      +54MB    PDF **表格**抽取 + 字符级坐标
#   pymupdf         +65MB    渲染成图 / 抽文本 / 提内嵌图片、字体、注释
#
# ⚠️ pdfplumber 与 pymupdf 解决的是**不同**问题，不可互相替代：
#    pdfplumber 懂表格结构，pymupdf 的表格识别通常不如它；
#    pymupdf 能渲染、能提内嵌资源，pdfplumber 两样都不行。
#
# ## 2026-09-02：pymupdf 取代 poppler-utils（用户裁定）
#
# 原先靠 poppler 的 pdftoppm 出图、pdftotext 抽文本。
#
# 体积（生产 amd64 实测 `du -sx /`，不是估算）：
#   docs 改前 318,040 KB → 改后 349,144 KB，**净 +30.4MB**（镜像表观 295→327MB）
#   pymupdf 自身 65MB；反推 poppler-utils 实际只占 ~34MB
#
# ⚠️ 旧注释写的「poppler +53MB」是错的，本次实测更正。这份文件立的规矩是
# 「体积必须实测镜像真实增量」—— 那个 53 是从更早的注释继承来的估算值，
# 照它算会得出「净 +11MB」，与实际差三倍。
#
# 换成 pymupdf 之后：
#
#   - **渲染快 2.4 倍**（生产 amd64 实测：5 页矢量图纸 @150DPI，
#     pdftoppm 1.92s → pymupdf 0.79s）。差距来自省掉每页起子进程和中间文件。
#   - 像素尺寸完全一致（1755×1240）。
#
# 两个换之前要知道的差异：
#
#   1. **PNG 体积大一倍**（163KB → 343KB）。**别试图用 Pillow 的 optimize=True
#      去压** —— 实测反而涨到 509KB 且慢 5 倍：转 RGB 丢掉了 pymupdf 原本的
#      调色板优化，白纸黑线用索引色存才最省。
#   2. **渲染结果不是逐像素相同**（4.58% 的像素明显不同，抗锯齿策略不同：
#      poppler 更瘦、pymupdf 更饱满）。给人看的图无所谓；**下游有像素级判断的
#      不能随便换** —— 换渲染器等于换测量基准（ZWCAD 那条线用像素 mask 量
#      铜宽，就是这类）。
#
# ⚠️ **skill 里写 `import pymupdf`，不要写 `import fitz`。** fitz 是旧导入名，
# 1.28 起会打 DeprecationWarning，将来会移除。现有 skill 17 / 29 用的都是
# `import fitz` —— 能跑，但要迁。
#
# 已知受影响：skill 26 drawing-tolerance-extractor 调 pdftoppm 出核对图。
# 它自带降级（`if not which("pdftoppm"): 跳过出图，坐标数据不受影响`），
# 所以本次变更不会让它失败，只是暂时少一张图；脚本迁到 pymupdf 后补回。
# ============================================================
FROM ragent-skill-basic:latest

ARG PIP_INDEX_URL=https://mirrors.aliyun.com/pypi/simple
ARG PIP_TRUSTED_HOST=mirrors.aliyun.com
ENV PIP_INDEX_URL=$PIP_INDEX_URL PIP_TRUSTED_HOST=$PIP_TRUSTED_HOST

# **PDF → 图片**由 pymupdf 提供（见下方 pip 段），不再需要 poppler 的命令行工具。
# `page.get_pixmap(matrix=pymupdf.Matrix(z, z)).save(path)` 直接出图。
#
# ⚠️ 能渲染**不等于**能出网：容器默认 --network none，出网仍要 exec-config 的
# needs_network=true（迁移 040）。
#
# ## 不含 OCR 引擎，这是刻意的
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
    "pymupdf>=1.26" \
    "Pillow>=10.0" \
    "beautifulsoup4>=4.12" \
    "lxml>=5.0" \
    "markdownify>=0.13" \
    "tabulate>=0.9" \
    "jinja2>=3.1" \
    "pyyaml>=6.0" \
    "chardet>=5.2"
