#!/usr/bin/env bash
#
# 重建自动化功能的数据表（10 张）
#
# ## 为什么需要这个脚本
#
# 自动化的表结构以 `db/automation.sql` 为准，但那份脚本用的全是
# `CREATE TABLE IF NOT EXISTS` —— 表已存在时它**静默跳过**，既不校验结构也不报错。
# 所以在「库里的结构与代码不一致」这个场景下，直接跑它修不好任何东西：
# 它只会打一句 WARNING 说「我不会校验结构」，然后什么都不做。
#
# 本脚本的解法是整组推倒重建。**代价是表里的数据会没**，所以它先确认这些表是空的。
#
# ## 用法
#
#   deploy/init-automation-db.sh            # 表为空则重建；有数据则拒绝并列出
#   deploy/init-automation-db.sh --check    # 只报告当前状态，什么都不改
#   deploy/init-automation-db.sh --force    # 有数据也重建（先打印将删除的行数并要求确认）
#
# ## 为什么有「有数据就拒绝」这道护栏
#
# `automation_mailboxes` 存的是 AES 加密后的 IMAP 授权码；`automation_tasks` 存的是用户
# 建好的自动化，任务之间还会通过 `upstreamAutomationId` 互相引用（「自动化完成触发」）。
#
# 这个脚本会被写进部署文档、被反复执行。今天生产是空的，不代表三个月后还是。删掉之后，
# 用户必须重新去邮箱后台申请授权码、逐条填回来——而且没有任何东西会提示他们发生过什么。
# 护栏的成本是几行判断，收益是这条命令可以放心地每次发版都跑。
#
# ## 环境
#
# 默认走 `docker exec` 进 postgres 容器（与 docs/assets/quickStart/init-dev-env.sh 同一套路）。
# 库名与用户从 `.env` 的 DATABASE_URL 解析——那才是应用真正连的东西。
# 可用环境变量覆盖：DB_CONTAINER / PGUSER / POSTGRES_DB
#
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

SCHEMA_SQL="db/automation.sql"
DB_CONTAINER="${DB_CONTAINER:-postgres}"
FORCE=0
CHECK_ONLY=0

die()  { echo "❌ $*" >&2; exit 1; }
step() { echo; echo "── $* ──"; }

# ── 参数 ────────────────────────────────────────────────────────────────────
for arg in "$@"; do
  case "$arg" in
    --force) FORCE=1 ;;
    --check) CHECK_ONLY=1 ;;
    -h|--help) sed -n '2,30p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) die "未知参数：$arg（可用：--check / --force / --help）" ;;
  esac
done

[ -f "$SCHEMA_SQL" ] || die "找不到 $SCHEMA_SQL —— 仓库不完整？"

# ── 连接参数 ────────────────────────────────────────────────────────────────
# 从 .env 的 DATABASE_URL 解析库名与用户：应用连的就是它，别去猜。
# 不 source .env —— 那会把带 # 注释的值和空格一起带进来。
envval() { grep -E "^${1}=" .env 2>/dev/null | tail -1 | cut -d= -f2- | sed 's/[[:space:]]*#.*$//' | xargs || true; }

DB_URL="$(envval DATABASE_URL)"
PGDB_V="${POSTGRES_DB:-}"
PGUSER_V="${PGUSER:-}"

if [ -n "$DB_URL" ]; then
  # postgresql://user:password@host:port/dbname
  url_rest="${DB_URL#*://}"
  url_userinfo="${url_rest%%@*}"
  url_hostpart="${url_rest#*@}"
  # 用 if 而不是 `[ -z X ] && ...`：后者在 X 非空时整条语句返回 1，
  # 会被 set -e 当成失败而终止脚本。
  if [ -z "$PGUSER_V" ]; then PGUSER_V="${url_userinfo%%:*}"; fi
  if [ -z "$PGDB_V" ]; then PGDB_V="${url_hostpart##*/}"; fi
  PGDB_V="${PGDB_V%%\?*}"   # 去掉可能存在的 ?sslmode=... 之类
fi
PGUSER_V="${PGUSER_V:-postgres}"
PGDB_V="${PGDB_V:-ragent}"

# 两个函数必须分开：
#
#   psql_query  —— 跑 -c 查询。**不能带 -i**：docker exec -i 会附上脚本自己的 stdin
#                  并把它读走，导致后面读确认输入的 `read` 拿到 EOF —— 在 set -e 下
#                  表现为"脚本莫名其妙退出、连错误信息都没打"。这里额外 < /dev/null 兜底。
#   psql_import —— 跑 < 文件 的导入，这里**必须带 -i**，否则 psql 读不到脚本内容。
if docker ps --format '{{.Names}}' 2>/dev/null | grep -qx "$DB_CONTAINER"; then
  psql_query()  { docker exec "$DB_CONTAINER" psql -U "$PGUSER_V" "$@" < /dev/null; }
  psql_import() { docker exec -i "$DB_CONTAINER" psql -U "$PGUSER_V" "$@"; }
  REACH="容器 ${DB_CONTAINER}"
elif command -v psql >/dev/null 2>&1; then
  DBPORT="${EXPOSE_POSTGRES_PORT:-5432}"
  psql_query()  { PGPASSWORD="${PGPASSWORD:-}" psql -h "${DBHOST:-127.0.0.1}" -p "$DBPORT" -U "$PGUSER_V" "$@" < /dev/null; }
  psql_import() { PGPASSWORD="${PGPASSWORD:-}" psql -h "${DBHOST:-127.0.0.1}" -p "$DBPORT" -U "$PGUSER_V" "$@"; }
  REACH="本机 psql"
else
  die "既没有名为 ${DB_CONTAINER} 的容器，本机也没有 psql。
   先起数据库，或用 DB_CONTAINER=<名字> 指定容器。"
fi

echo "目标库：${PGDB_V}   用户：${PGUSER_V}   经由：${REACH}"

psql_query -q -c 'SELECT 1' >/dev/null 2>&1 || die "连不上数据库。
   容器起了吗？库名对吗？（当前按 DATABASE_URL 解析出：${PGDB_V}）"

# ── 表清单：从 SQL 文件派生，不写死 ─────────────────────────────────────────
# 写死的话，以后往 db/automation.sql 里加了表而忘了改这里，那张表就不会被重建——
# 正是本脚本要消灭的那类静默错配。
mapfile -t TABLES < <(
  tr -d '\r' < "$SCHEMA_SQL" \
    | grep -oE '^CREATE TABLE IF NOT EXISTS [a-z_]+' \
    | awk '{print $NF}' \
    | sort
)
[ "${#TABLES[@]}" -gt 0 ] || die "从 $SCHEMA_SQL 里没解析到任何 CREATE TABLE —— 文件格式变了？"

# ── 数行数 ──────────────────────────────────────────────────────────────────
step "检查现有数据（${#TABLES[@]} 张表）"

EXISTING=()
ROW_TOTAL=0
ROW_REPORT=""

for t in "${TABLES[@]}"; do
  exists=$(psql_query -t -A -d "$PGDB_V" -c "SELECT to_regclass('public.${t}') IS NOT NULL" | tr -d '[:space:]')
  if [ "$exists" != "t" ]; then
    printf '  %-42s %s\n' "$t" "（不存在）"
    continue
  fi
  EXISTING+=("$t")
  n=$(psql_query -t -A -d "$PGDB_V" -c "SELECT count(*) FROM ${t}" | tr -d '[:space:]')
  printf '  %-42s %s 行\n' "$t" "$n"
  if [ "${n:-0}" != "0" ]; then
    ROW_TOTAL=$((ROW_TOTAL + n))
    ROW_REPORT="${ROW_REPORT}    ${t}: ${n} 行"$'\n'
  fi
done

# ── 判断 ────────────────────────────────────────────────────────────────────
if [ "$CHECK_ONLY" = "1" ]; then
  step "结果（--check，未做任何修改）"
  echo "  已存在的表：${#EXISTING[@]} / ${#TABLES[@]}"
  echo "  非空表的总行数：${ROW_TOTAL}"
  exit 0
fi

if [ "$ROW_TOTAL" != "0" ] && [ "$FORCE" != "1" ]; then
  cat >&2 <<EOF

❌ 拒绝执行：这些表里有数据，重建会把它们删掉。

${ROW_REPORT}
  合计 ${ROW_TOTAL} 行。

automation_mailboxes 存的是加密后的 IMAP 授权码，automation_tasks 存的是用户建好的自动化
（任务之间还会通过 upstreamAutomationId 互相引用）。删掉之后用户得重新申请授权码、逐条重填。

如果你确认这些数据可以丢：
    deploy/init-automation-db.sh --force

如果只是想看看现在的状态：
    deploy/init-automation-db.sh --check
EOF
  exit 1
fi

if [ "$ROW_TOTAL" != "0" ]; then
  cat <<EOF

⚠️  --force：以下数据将被永久删除

${ROW_REPORT}
  合计 ${ROW_TOTAL} 行。
EOF
  printf '输入 yes 继续，其它任何输入都会中止：'
  read -r answer
  [ "$answer" = "yes" ] || die "已中止，未做任何修改。"
fi

# ── 重建 ────────────────────────────────────────────────────────────────────
if [ "${#EXISTING[@]}" -gt 0 ]; then
  step "删除现有表（${#EXISTING[@]} 张）"
  # CASCADE 处理表之间的外键（run_review_history / run_actions → runs）。
  # 这些外键全部落在 automation_* 内部，不会波及别的功能。
  DROP_LIST="$(printf '%s, ' "${EXISTING[@]}")"
  psql_query -q -d "$PGDB_V" -c "DROP TABLE IF EXISTS ${DROP_LIST%, } CASCADE" \
    || die "删表失败 —— 通常是还有连接占着这些表"
  echo "  已删除：${DROP_LIST%, }"
else
  step "库里没有这些表，直接建"
fi

step "执行 $SCHEMA_SQL"
if ! psql_import -v ON_ERROR_STOP=1 -d "$PGDB_V" < "$SCHEMA_SQL"; then
  die "建表失败 —— 库现在处于不完整状态，修好后重新执行本脚本即可（它是幂等的）"
fi

# ── 复查 ────────────────────────────────────────────────────────────────────
# 与 lib/automation/schema.ts 的启动校验查同一批事实：应用启动时会查它们，
# 这里先查一遍，免得跑完脚本还要去翻启动日志。
step "复查"

FAIL=0

MISSING=$(psql_query -t -A -d "$PGDB_V" -c "
  SELECT string_agg(name, ', ') FROM unnest(ARRAY[$(printf "'%s'," "${TABLES[@]}" | sed 's/,$//')]::text[]) AS name
   WHERE to_regclass('public.' || name) IS NULL" | sed 's/^ *//;s/ *$//')
if [ -n "$MISSING" ]; then
  echo "  ❌ 仍缺表：$MISSING"; FAIL=1
else
  echo "  ✅ ${#TABLES[@]} 张表齐全"
fi

CONSTRAINT=$(psql_query -t -A -d "$PGDB_V" -c "
  SELECT COALESCE(pg_get_constraintdef(oid), '') FROM pg_constraint
   WHERE conname = 'automation_email_processed_once_per_automation' AND contype = 'u'" | sed 's/^ *//;s/ *$//')
if printf '%s' "$CONSTRAINT" | grep -q 'created_by_user_id, mailbox_id, message_key, automation_id'; then
  echo "  ✅ 去重表唯一键是四列（含 automation_id）"
else
  echo "  ❌ 去重表唯一键不对：${CONSTRAINT:-（不存在）}"; FAIL=1
fi

LEGACY=$(psql_query -t -A -d "$PGDB_V" -c "
  SELECT count(*) FROM information_schema.columns
   WHERE table_name = 'automation_email_rule_events'
     AND column_name IN ('priority', 'winner_automation_id')" | tr -d '[:space:]')
if [ "$LEGACY" = "0" ]; then
  echo "  ✅ 废弃列 priority / winner_automation_id 已不存在"
else
  echo "  ❌ 仍有 ${LEGACY} 条废弃列（priority / winner_automation_id）"; FAIL=1
fi

echo
if [ "$FAIL" = "0" ]; then
  echo "═══════════════════════════════════════════════"
  echo "  ✅ ${PGDB_V} 的自动化表已重建并通过复查"
  echo
  echo "  下一步：重启前端进程。"
  echo "  调度器在模块加载期注册，启动时校验不过就只打一行日志、不会重试——"
  echo "  不重启的话界面正常，但自动化一封邮件都不会处理。"
  echo "═══════════════════════════════════════════════"
else
  die "复查未通过，见上面的 ❌。库可能处于不完整状态。"
fi
