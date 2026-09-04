#!/usr/bin/env bash
#
# 一键初始化本地开发环境：建库 → 导表结构 → 导种子数据 → 同步内置技能 → 打印账号。
#
# ## 用法
#
#   scripts/init-dev-env.sh                  # 自动找 seed.sql
#   scripts/init-dev-env.sh path/to/seed.sql
#   FORCE=1 scripts/init-dev-env.sh          # 库已存在且有数据时也重来（**会删库**）
#
# seed.sql 不在仓库里（它是某台机器某一刻的快照，即使脱敏也不该进版本库）。
# 找项目里已经跑起来的人要一份，或者他在自己机器上跑
# `scripts/dump-dev-database.sh` 生成。
#
# ## 顺序是有讲究的
#
#   1. schema.sql  建 44 张表
#   2. seed.sql    灌数据（它是 data-only，一个 CREATE TABLE 都没有 ——
#                  单独导会得到一千多条 "relation does not exist"）
#   3. 同步内置技能（builtin-skill-creator 的真源在仓库里，不在 seed 里）
#
# 这个脚本存在的理由就是让你不用记这个顺序。
#
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

SCHEMA_SQL="docker/db/schema.sql"
DB_CONTAINER="${DB_CONTAINER:-postgres}"

die() { echo "❌ $*" >&2; exit 1; }
step() { echo; echo "── $* ──"; }

# ── 找 seed.sql ────────────────────────────────────────────────────────────
SEED_SQL="${1:-}"
if [ -z "$SEED_SQL" ]; then
  for cand in seed.sql dev-db-dump/seed.sql ../seed.sql ~/Downloads/seed.sql; do
    if [ -f "$cand" ]; then SEED_SQL="$cand"; break; fi
  done
fi
[ -n "$SEED_SQL" ] || die "找不到 seed.sql。
   它不在仓库里 —— 找项目里已经跑起来的同事要一份，放到仓库根目录再跑我。
   或者显式指定：scripts/init-dev-env.sh /path/to/seed.sql"
[ -f "$SEED_SQL" ] || die "seed.sql 不存在：$SEED_SQL"
[ -f "$SCHEMA_SQL" ] || die "找不到 $SCHEMA_SQL —— 仓库不完整？"

# seed 必须是 data-only。如果有人误把全量 dump 当 seed 传进来，建表语句会跟
# schema.sql 撞一堆 "already exists"，而那时已经导了一半，收拾起来比拦下来麻烦。
if grep -qE '^CREATE TABLE' "$SEED_SQL"; then
  die "$SEED_SQL 里有 CREATE TABLE —— 这看起来是全量 dump，不是 seed。
   要么直接 psql 导它（不要用本脚本），要么让对方用 dump-dev-database.sh 重新生成。"
fi

# ── .env ──────────────────────────────────────────────────────────────────
step "环境变量"
if [ ! -f .env ]; then
  cp env.example .env
  echo "✅ 已从 env.example 创建 .env"
else
  echo "已有 .env，保留不动"
fi

# 从 .env 读连接参数（不 source，避免把带 # 注释的值和空格带进来）
envval() { grep -E "^${1}=" .env 2>/dev/null | tail -1 | cut -d= -f2- | sed 's/[[:space:]]*#.*$//' | xargs || true; }
PGUSER_V="$(envval PGUSER)";              PGUSER_V="${PGUSER_V:-postgres}"
PGDB_V="$(envval POSTGRES_DB)";           PGDB_V="${PGDB_V:-ragent}"
PGHOST_V="$(envval HOST)";                PGHOST_V="${PGHOST_V:-localhost}"
PGPORT_V="$(envval EXPOSE_POSTGRES_PORT)";PGPORT_V="${PGPORT_V:-5432}"
echo "   目标库：${PGDB_V}   用户：${PGUSER_V}   host=${PGHOST_V}:${PGPORT_V}"

# ── 怎么连上 postgres ──────────────────────────────────────────────────────
# 优先 docker exec 进容器：本机不需要装 psql 客户端，也不受 .env 里 HOST 的影响
# （env.example 默认 HOST=postgres，那是 compose 的服务名，从宿主机解析不了）。
step "连接 PostgreSQL"
if docker ps --format '{{.Names}}' 2>/dev/null | grep -qx "$DB_CONTAINER"; then
  MODE=docker
  psql_run() { docker exec -i "$DB_CONTAINER" psql -U "$PGUSER_V" "$@"; }
  echo "✅ 用容器 ${DB_CONTAINER}"
elif command -v psql >/dev/null 2>&1; then
  MODE=local
  psql_run() { psql -h "$PGHOST_V" -p "$PGPORT_V" -U "$PGUSER_V" "$@"; }
  echo "✅ 用本机 psql（${PGHOST_V}:${PGPORT_V}）"
else
  die "既没有名为 ${DB_CONTAINER} 的容器，本机也没有 psql。
   先起数据库：cd docker && docker-compose up -d postgres"
fi
psql_run -q -c 'SELECT 1' >/dev/null 2>&1 || die "连不上 PostgreSQL。
   容器起了吗？  cd docker && docker-compose up -d postgres"

# pgvector 必须有：knowledge_segments / datasets 有 vector(1024) 列，绕不开。
# 提前查，不然等 schema.sql 导到一半才报 "type vector does not exist"。
if ! psql_run -t -A -c "SELECT 1 FROM pg_available_extensions WHERE name='vector'" | grep -q 1; then
  die "这个 PostgreSQL 没有 pgvector 扩展。
   knowledge_segments / datasets 有 vector(1024) 列，没它建不出表。
   换镜像：docker/docker-compose.yml 里用的是 pgvector/pgvector:pg17。"
fi

# ── 建库 ──────────────────────────────────────────────────────────────────
step "创建数据库 ${PGDB_V}"
EXISTS=$(psql_run -t -A -c "SELECT 1 FROM pg_database WHERE datname='${PGDB_V}'" | tr -d '[:space:]')
if [ "$EXISTS" = "1" ]; then
  NTABLES=$(psql_run -d "$PGDB_V" -t -A \
            -c "SELECT count(*) FROM pg_tables WHERE schemaname='public'" | tr -d '[:space:]')
  if [ "${NTABLES:-0}" != "0" ]; then
    if [ "${FORCE:-0}" != "1" ]; then
      die "库 ${PGDB_V} 已存在且有 ${NTABLES} 张表。
   我不会动它 —— 里面可能是你正在用的数据。
   确定要重来（**删掉整个库**）：FORCE=1 scripts/init-dev-env.sh ${SEED_SQL}"
    fi
    echo "⚠️  FORCE=1：删掉已有的 ${PGDB_V}（${NTABLES} 张表）"
    psql_run -q -c "DROP DATABASE ${PGDB_V}" \
      || die "删库失败 —— 通常是还有连接占着（关掉后端进程再试）"
    psql_run -q -c "CREATE DATABASE ${PGDB_V}"
  else
    echo "库已存在但是空的，直接用"
  fi
else
  psql_run -q -c "CREATE DATABASE ${PGDB_V}"
  echo "✅ 已创建"
fi

# ── 导结构 + 数据 ─────────────────────────────────────────────────────────
import_sql() {  # $1=文件 $2=人话名字
  local errs
  errs=$(psql_run -d "$PGDB_V" < "$1" 2>&1 | grep '^ERROR' | head -5 || true)
  if [ -n "$errs" ]; then
    echo "❌ 导入 $2 出错：" >&2
    echo "$errs" | sed 's/^/   /' >&2
    exit 1
  fi
  echo "✅ $2"
}
step "导入表结构（${SCHEMA_SQL}）"
import_sql "$SCHEMA_SQL" "表结构 $(grep -c '^CREATE TABLE' "$SCHEMA_SQL") 张表"

step "导入种子数据（${SEED_SQL}）"
import_sql "$SEED_SQL" "种子数据"

# seed 导入时外键检查是关着的（数据按表逐个插，保证不了全局拓扑顺序），
# 所以必须自己验一遍 —— 不验的话"导入成功但数据是断的"看不出来。
ORPHANS=$(psql_run -d "$PGDB_V" -t -A <<'SQL' | tr -d '[:space:]'
SELECT COALESCE(sum(n), 0) FROM (
  SELECT count(*) n FROM user_roles ur LEFT JOIN users u ON u.id=ur.user_id WHERE u.id IS NULL
  UNION ALL SELECT count(*) FROM user_roles ur LEFT JOIN roles r ON r.id=ur.role_id WHERE r.id IS NULL
  UNION ALL SELECT count(*) FROM users u LEFT JOIN tenant t ON t.id=u.tenant_id
    WHERE u.tenant_id IS NOT NULL AND t.id IS NULL
  UNION ALL SELECT count(*) FROM users u LEFT JOIN dept d ON d.id=u.dept_id
    WHERE u.dept_id IS NOT NULL AND d.id IS NULL
) t;
SQL
)
[ "$ORPHANS" = "0" ] || die "种子里有 ${ORPHANS} 行孤儿引用 —— 导入看似成功，数据却是断的"
echo "✅ 无孤儿引用"

# ── 同步内置技能 ──────────────────────────────────────────────────────────
step "同步内置技能（builtin_skills/ → 数据库）"
# 这一步跑的是宿主机 python，走 app.config 的 settings.database_url，
# 也就是 .env 里的 HOST —— 跟前面的 docker exec 是**两条不同的连接路径**。
# env.example 默认 HOST=postgres（compose 服务名），宿主机解析不了，
# 所以前面导库能成、这一步却会失败。先探一下，别让它炸在 traceback 里。
PY=python3; command -v python >/dev/null 2>&1 && PY=python
if ! "$PY" -c "
import sys
sys.path.insert(0, '.')
try:
    from app.config import settings
    from sqlalchemy import create_engine, text
    create_engine(settings.database_url).connect().execute(text('SELECT 1'))
except Exception as e:
    print(type(e).__name__, e, file=sys.stderr); sys.exit(1)
" 2>/dev/null; then
  echo "⚠️  跳过：宿主机 python 连不上数据库。"
  echo
  echo "   前面导库走的是 docker exec（容器内），这一步走的是 .env 里的连接串。"
  echo "   .env 现在是 HOST=${PGHOST_V} —— 如果它是 'postgres'，那是 compose 的"
  echo "   服务名，只在容器网络里能解析。改成 localhost 再补跑："
  echo
  echo "       sed -i '' 's/^HOST=postgres.*/HOST=localhost/' .env   # macOS"
  echo "       ${PY} scripts/sync_builtin_skills.py"
  echo
  echo "   （也可能是依赖没装：pip install -r requirements.txt）"
  SYNC_SKIPPED=1
else
  "$PY" scripts/sync_builtin_skills.py || die "同步内置技能失败"
  SYNC_SKIPPED=0
fi

# ── 报告 ──────────────────────────────────────────────────────────────────
step "结果"
psql_run -d "$PGDB_V" -t -A <<'SQL' | sed 's/^/   /'
SELECT '表        ' || count(*) FROM pg_tables WHERE schemaname='public';
SELECT '角色      ' || count(*) FROM roles;
SELECT '用户      ' || count(*) FROM users;
SELECT '租户/部门 ' || (SELECT count(*) FROM tenant) || ' / ' || count(*) FROM dept;
SELECT '沙箱镜像  ' || COALESCE(string_agg(name, ', ' ORDER BY id), '(无)') FROM sandbox_images WHERE is_enabled;
SELECT '内置技能  ' || COALESCE(string_agg(name, ', ' ORDER BY id), '(无 —— 同步这步没跑成)')
  FROM skills WHERE is_managed;
SQL

# 账号从 seed.sql 的头部注释读，不写死在这里 —— 别人用不同密码重新生成过 seed 时，
# 写死的那个会变成一句谎话。
CREDS=$(grep -m1 '^-- ADMIN_CREDENTIALS:' "$SEED_SQL" 2>/dev/null | sed 's/^-- ADMIN_CREDENTIALS:[[:space:]]*//' || true)
DBUSER=$(psql_run -d "$PGDB_V" -t -A -c \
  "SELECT u.username FROM users u JOIN user_roles ur ON ur.user_id=u.id
     JOIN roles r ON r.id=ur.role_id WHERE r.name='超级管理员' ORDER BY u.id LIMIT 1" | tr -d '[:space:]')

echo
echo "═══════════════════════════════════════════════"
echo "  ✅ 初始化完成"
echo
if [ -n "$CREDS" ]; then
  echo "  登录账号：${CREDS}"
  echo "  （超级管理员。这是本地开发用的弱密码，别带到任何其它环境）"
else
  echo "  登录账号：${DBUSER:-?}"
  echo "  密码不在 seed.sql 里写明 —— 问给你 seed 的人。"
fi
echo
echo "  下一步："
echo "    1. 编辑 .env 填自己的模型 API Key（DEEPSEEK_API_KEY 等）"
echo "    2. python main.py           # 起后端，http://localhost:8010/docs"
if [ "${SYNC_SKIPPED:-0}" = "1" ]; then
  echo "    3. ⚠️ 内置技能还没同步 —— 见上面那段提示"
fi
echo "═══════════════════════════════════════════════"
