-- ragent 开发库最小种子（由 scripts/dump-dev-database.sh 生成）
--
-- ⚠️ 只有数据，没有表结构。**必须先导 docker/db/schema.sql**，
--    否则会得到一千多条 "relation does not exist"。
--    用 scripts/init-dev-env.sh 就不用自己记顺序。
--
-- ADMIN_CREDENTIALS: admin / 123456
--
-- 需要 superuser：导入期间关闭外键检查，结尾自动恢复。

SET session_replication_role = replica;
-- roles：代码按名字判权限，四行都要
INSERT INTO public.roles (id, tenant_id, name, description, is_system, created_at, updated_at) VALUES (1, NULL, '超级管理员', '系统超级管理员，拥有所有权限', 't', NOW(), NOW());
INSERT INTO public.roles (id, tenant_id, name, description, is_system, created_at, updated_at) VALUES (2, NULL, '租户管理员', '租户管理员，管理租户内所有资源', 't', NOW(), NOW());
INSERT INTO public.roles (id, tenant_id, name, description, is_system, created_at, updated_at) VALUES (3, NULL, '部门管理员', '部门管理员，管理部门内资源', 't', NOW(), NOW());
INSERT INTO public.roles (id, tenant_id, name, description, is_system, created_at, updated_at) VALUES (4, NULL, '普通用户', '普通用户，基础权限', 't', NOW(), NOW());

-- role_permissions：缺了它菜单与接口全是 403
INSERT INTO public.role_permissions (role_id, resource_type, permission, created_at) VALUES (1, 'chat', 'admin', NOW());
INSERT INTO public.role_permissions (role_id, resource_type, permission, created_at) VALUES (1, 'dept', 'admin', NOW());
INSERT INTO public.role_permissions (role_id, resource_type, permission, created_at) VALUES (1, 'knowledge', 'admin', NOW());
INSERT INTO public.role_permissions (role_id, resource_type, permission, created_at) VALUES (1, 'prompts', 'admin', NOW());
INSERT INTO public.role_permissions (role_id, resource_type, permission, created_at) VALUES (1, 'sop', 'admin', NOW());
INSERT INTO public.role_permissions (role_id, resource_type, permission, created_at) VALUES (1, 'tenant', 'admin', NOW());
INSERT INTO public.role_permissions (role_id, resource_type, permission, created_at) VALUES (1, 'user', 'admin', NOW());
INSERT INTO public.role_permissions (role_id, resource_type, permission, created_at) VALUES (2, 'chat', 'admin', NOW());
INSERT INTO public.role_permissions (role_id, resource_type, permission, created_at) VALUES (2, 'dept', 'admin', NOW());
INSERT INTO public.role_permissions (role_id, resource_type, permission, created_at) VALUES (2, 'knowledge', 'admin', NOW());
INSERT INTO public.role_permissions (role_id, resource_type, permission, created_at) VALUES (2, 'prompts', 'admin', NOW());
INSERT INTO public.role_permissions (role_id, resource_type, permission, created_at) VALUES (2, 'sop', 'admin', NOW());
INSERT INTO public.role_permissions (role_id, resource_type, permission, created_at) VALUES (2, 'user', 'admin', NOW());
INSERT INTO public.role_permissions (role_id, resource_type, permission, created_at) VALUES (3, 'chat', 'read', NOW());
INSERT INTO public.role_permissions (role_id, resource_type, permission, created_at) VALUES (3, 'knowledge', 'read', NOW());
INSERT INTO public.role_permissions (role_id, resource_type, permission, created_at) VALUES (3, 'sop', 'read', NOW());
INSERT INTO public.role_permissions (role_id, resource_type, permission, created_at) VALUES (3, 'user', 'read', NOW());
INSERT INTO public.role_permissions (role_id, resource_type, permission, created_at) VALUES (4, 'chat', 'read', NOW());
INSERT INTO public.role_permissions (role_id, resource_type, permission, created_at) VALUES (4, 'knowledge', 'read', NOW());
INSERT INTO public.role_permissions (role_id, resource_type, permission, created_at) VALUES (4, 'sop', 'read', NOW());

-- tenant / dept：各一行，名称脱敏（活库里是客户公司名与真实部门名）。
-- ⚠️ 根部门的 path 就等于 code —— 改了 code 必须同步改 path，否则子树判定
--    （is_at_or_below 按 path 前缀比对）会对不上。
INSERT INTO public.tenant (id, name, code, status, max_users, created_at, updated_at)
VALUES (1, 'Dev Tenant', 'DEV', 'active', 100, NOW(), NOW());

INSERT INTO public.dept (id, tenant_id, parent_id, name, code, level, path, sort_order, status, created_at, updated_at)
VALUES (1, 1, NULL, 'Dev Dept', 'DEV', 1, 'DEV', 0, 'active', NOW(), NOW());

-- sandbox_images：可执行 skill 的镜像白名单，只导启用中的
INSERT INTO public.sandbox_images (id, name, tag, digest, description, is_enabled, created_by, created_at, updated_at) VALUES (8, 'ragent-skill-basic', 'latest', NULL, 'python:3.11-slim + curl + ca-certificates + xz-utils。所有 skill 的公共底座：只放"每个 skill 都可能用到"的东西。装了 curl 不等于能出网——出网仍需 exec 配置的 needs_network。', true, NULL, NOW(), NOW());
INSERT INTO public.sandbox_images (id, name, tag, digest, description, is_enabled, created_by, created_at, updated_at) VALUES (9, 'ragent-skill-docs', 'latest', NULL, '文档处理环境：通用档 + openpyxl / python-docx / pypdf / Pillow / openai / requests / pydantic。处理 Excel、Word、PDF、图像或调 LLM 时选它。', true, NULL, NOW(), NOW());
INSERT INTO public.sandbox_images (id, name, tag, digest, description, is_enabled, created_by, created_at, updated_at) VALUES (10, 'ragent-skill-general', 'latest', NULL, 'basic + Node 22 运行时（node/npm/npx）。⚠️ 提供的是运行时，不是"任意 npm 包随取随用"：沙箱默认 --network none 且 /tmp 挂 noexec，`npx <包名>` 会卡在 registry 超时而非快速失败。要跑固定的 npm 工具请在镜像构建时 npm install -g。', true, NULL, NOW(), NOW());

-- tools：两行基线 MCP 工具（原先由迁移 044 / 046 预置，迁移删除后移到这里）
--
-- ⚠️ **密钥与主机地址一律占位。** 活库里这两行带着真的 Tavily key、
--    某台机器的家目录路径和一个局域网 IP —— 照抄进来就是把它们提交进版本库。
--    test_native_tool_roster.py 与 test_workflow_dependency_gate.py 会检查这一点。
INSERT INTO public.tools (name, display_name, description, tool_type, category, default_config, is_enabled, is_system, version, author, created_at, updated_at)
VALUES ('mcp-search-tavily', 'Tavily 搜索', '联网搜索（Tavily）', 'mcp', 'search',
        '{"transport": "stdio", "command": "npx", "args": ["-y", "tavily-mcp"], "env": {"TAVILY_API_KEY": "${TAVILY_API_KEY}"}}'::jsonb,
        true, false, '1.0.0', NULL, NOW(), NOW());


-- 唯一账号：超级管理员。另外 15 个真实用户一个都不导。
INSERT INTO public.users (id, username, nickname, password, email, tenant_id, dept_id, status, created_at, updated_at, wechat_id, api_key)
VALUES (1, 'admin', 'Admin', '$2b$12$S3PIBGgtX0KMh1IY8yvkouwEuyunWKC3LDjhSJaRM7dyuN67EERrS', 'admin@example.local', 1, 1, 'active', NOW(), NOW(), NULL, NULL);

-- 绑超级管理员角色：按名字查 role_id，不写死数字
INSERT INTO public.user_roles (user_id, role_id, created_at)
SELECT 1, id, NOW() FROM public.roles WHERE name = '超级管理员';

-- 显式插了 id，序列还停在 1 —— 不校准的话建第二个用户就撞
-- "duplicate key value violates unique constraint users_pkey"，
-- 而且是几天后才撞上，看不出跟导库有关。
DO $fix$
DECLARE r RECORD; sq TEXT; mx BIGINT;
BEGIN
  FOR r IN SELECT table_name, column_name FROM information_schema.columns
           WHERE table_schema = 'public'
             AND (column_default LIKE 'nextval%' OR is_identity = 'YES')
  LOOP
    sq := pg_get_serial_sequence('public.' || quote_ident(r.table_name), r.column_name);
    IF sq IS NOT NULL THEN
      EXECUTE format('SELECT COALESCE(max(%I), 0) FROM public.%I', r.column_name, r.table_name) INTO mx;
      PERFORM setval(sq, GREATEST(mx, 1), mx > 0);
    END IF;
  END LOOP;
END $fix$;

SET session_replication_role = DEFAULT;
