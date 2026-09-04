--
-- PostgreSQL database dump
--

\restrict dEH654jICKosgMjp3SoC1CjNTxO70EaCG5CV4iWvEthMaNa2KbfE0pjfv2tZdhQ

-- Dumped from database version 17.10 (Debian 17.10-1.pgdg12+1)
-- Dumped by pg_dump version 17.10 (Debian 17.10-1.pgdg12+1)

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: pg_trgm; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA public;


--
-- Name: EXTENSION pg_trgm; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON EXTENSION pg_trgm IS 'text similarity measurement and index searching based on trigrams';


--
-- Name: vector; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS vector WITH SCHEMA public;


--
-- Name: EXTENSION vector; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON EXTENSION vector IS 'vector data type and ivfflat and hnsw access methods';


--
-- Name: auto_generate_api_key(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.auto_generate_api_key() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    -- 如果 api_key 为空或 NULL，自动生成一个
    IF NEW.api_key IS NULL OR NEW.api_key = '' THEN
        NEW.api_key := generate_api_key();
    END IF;
    RETURN NEW;
END;
$$;


--
-- Name: FUNCTION auto_generate_api_key(); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.auto_generate_api_key() IS '在插入用户时自动生成 api_key（如果未提供）';


--
-- Name: auto_reset_dataset_embedding_model(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.auto_reset_dataset_embedding_model() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
      DECLARE
  v_old_segment_model TEXT;
  v_new_segment_model TEXT;
  v_old_split_mode TEXT;
  v_new_split_mode TEXT;
  v_dataset_name TEXT;
  v_files_count INTEGER;
  v_segments_affected INTEGER;
  v_operation_type TEXT;
BEGIN
  -- Extract segment model and split mode from old and new settings
  v_old_segment_model := COALESCE(OLD.settings->>'segmentModel', 'not_set');
  v_new_segment_model := COALESCE(NEW.settings->>'segmentModel', 'not_set');
  v_old_split_mode := COALESCE(OLD.settings->>'splitMode', 'not_set');
  v_new_split_mode := COALESCE(NEW.settings->>'splitMode', 'not_set');
  
  -- Determine what changed
  v_operation_type := 'none';
  IF v_old_segment_model != v_new_segment_model AND v_old_split_mode != v_new_split_mode THEN
    v_operation_type := 'both';
  ELSIF v_old_segment_model != v_new_segment_model THEN
    v_operation_type := 'segment_model';
  ELSIF v_old_split_mode != v_new_split_mode THEN
    v_operation_type := 'split_mode';
  END IF;
  
  -- Only proceed if something actually changed
  IF v_operation_type = 'none' THEN
    RETURN NEW;
  END IF;
  
  -- 移除模型验证限制，允许任何模型
  
  -- Get dataset name for logging
  v_dataset_name := NEW.name;
  
  -- Get count of files that will be affected
  SELECT COUNT(*) INTO v_files_count
  FROM knowledge_files 
  WHERE dataset_id = NEW.id;
  
  -- Log the automatic reset operation
  INSERT INTO system_logs (action, details, user_id, created_at) VALUES (
    'auto_reset_dataset_embedding_model',
    json_build_object(
      'dataset_id', NEW.id,
      'dataset_name', v_dataset_name,
      'old_segment_model', v_old_segment_model,
      'new_segment_model', v_new_segment_model,
      'old_split_mode', v_old_split_mode,
      'new_split_mode', v_new_split_mode,
      'operation_type', v_operation_type,
      'triggered_by', 'database_trigger',
      'files_affected', v_files_count
    )::text,
    NULL, -- system operation
    CURRENT_TIMESTAMP
  );
  
  -- Reset all file statuses to pending
  UPDATE knowledge_files 
  SET 
    status = 'pending',
    updated_at = CURRENT_TIMESTAMP 
  WHERE dataset_id = NEW.id;
  
  -- Handle different operation types
  IF v_operation_type = 'split_mode' OR v_operation_type = 'both' THEN
    -- Split mode changed: Delete all segments (they need to be re-segmented)
    DELETE FROM knowledge_segments 
    WHERE file_id IN (
      SELECT id FROM knowledge_files WHERE dataset_id = NEW.id
    );
    GET DIAGNOSTICS v_segments_affected = ROW_COUNT;
    
    RAISE NOTICE 'Split mode changed for dataset %. Deleted % segments. Files affected: %', 
      v_dataset_name, v_segments_affected, v_files_count;
      
  ELSIF v_operation_type = 'segment_model' THEN
    -- Segment model changed: Clear vectors and embedding_model, keep segments
    UPDATE knowledge_segments 
    SET 
      embedding_vector = NULL,
      embedding_model = NULL,
      status = 'pending'
    WHERE file_id IN (
      SELECT id FROM knowledge_files WHERE dataset_id = NEW.id
    );
    GET DIAGNOSTICS v_segments_affected = ROW_COUNT;
    
    RAISE NOTICE 'Segment model changed for dataset %. Updated % segments (cleared vectors and embedding_model). Files affected: %', 
      v_dataset_name, v_segments_affected, v_files_count;
  END IF;
  
  -- Log the completion
  INSERT INTO system_logs (action, details, user_id, created_at) VALUES (
    'auto_reset_dataset_embedding_model_completed',
    json_build_object(
      'dataset_id', NEW.id,
      'dataset_name', v_dataset_name,
      'old_segment_model', v_old_segment_model,
      'new_segment_model', v_new_segment_model,
      'old_split_mode', v_old_split_mode,
      'new_split_mode', v_new_split_mode,
      'operation_type', v_operation_type,
      'files_affected', v_files_count,
      'segments_affected', v_segments_affected,
      'status', 'completed'
    )::text,
    NULL, -- system operation
    CURRENT_TIMESTAMP
  );
    
  RETURN NEW;
END;
      $$;


--
-- Name: batch_reset_datasets_embedding_models(uuid[], text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.batch_reset_datasets_embedding_models(p_dataset_ids uuid[], p_new_segment_model text) RETURNS json
    LANGUAGE plpgsql
    AS $$
DECLARE
  v_dataset_id UUID;
  v_results JSONB := '[]'::jsonb;
  v_result JSON;
  v_success_count INTEGER := 0;
  v_failure_count INTEGER := 0;
BEGIN
  -- Validate new segment model
  IF p_new_segment_model NOT IN ('bge', 'openai') THEN
    RAISE EXCEPTION 'Invalid segment model: %. Must be "bge" or "openai"', p_new_segment_model;
  END IF;
  
  -- Process each dataset
  FOREACH v_dataset_id IN ARRAY p_dataset_ids
  LOOP
    BEGIN
      v_result := reset_dataset_embedding_model(v_dataset_id, p_new_segment_model);
      
      -- Parse result to check success
      IF (v_result->>'success')::boolean THEN
        v_success_count := v_success_count + 1;
      ELSE
        v_failure_count := v_failure_count + 1;
      END IF;
      
      -- Add to results array
      v_results := v_results || to_jsonb(v_result);
      
    EXCEPTION
      WHEN OTHERS THEN
        v_failure_count := v_failure_count + 1;
        v_results := v_results || jsonb_build_object(
          'dataset_id', v_dataset_id,
          'success', false,
          'error', SQLERRM
        );
    END;
  END LOOP;
  
  -- Return summary
  RETURN json_build_object(
    'success', true,
    'summary', json_build_object(
      'total_datasets', array_length(p_dataset_ids, 1),
      'success_count', v_success_count,
      'failure_count', v_failure_count
    ),
    'results', v_results
  );
END;
$$;


--
-- Name: calculate_duration_ms(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.calculate_duration_ms() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    -- 只有当 answered_at 和 submitted_at 都存在时才计算 duration_ms
    IF NEW.answered_at IS NOT NULL AND NEW.submitted_at IS NOT NULL THEN
        -- 计算时间差
        NEW.duration_ms := EXTRACT(EPOCH FROM (NEW.answered_at - NEW.submitted_at)) * 1000;
        
        -- 如果时间差太小（小于10毫秒），设置为100毫秒
        IF NEW.duration_ms < 10 THEN
            NEW.duration_ms := 100;
        END IF;
    END IF;
    
    RETURN NEW;
END;
$$;


--
-- Name: can_access_app(integer, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.can_access_app(p_user_id integer, p_app_id integer) RETURNS boolean
    LANGUAGE plpgsql STABLE
    AS $$
DECLARE
    v_user_tenant_id INTEGER;
    v_user_dept_id INTEGER;
    v_user_roles TEXT[];
    v_app_user_id INTEGER;
    v_app_is_default BOOLEAN;
    v_app_status VARCHAR(20);
    v_app_visibility VARCHAR(20);
    v_owner_dept_id INTEGER;
    v_owner_tenant_id INTEGER;
    v_user_exists BOOLEAN;
BEGIN
    -- 用户存在性
    SELECT EXISTS(SELECT 1 FROM users WHERE id = p_user_id) INTO v_user_exists;
    IF NOT v_user_exists THEN
        RETURN FALSE;
    END IF;

    -- 应用信息（不存在直接 FALSE）
    SELECT user_id, is_default, status, visibility, owner_dept_id, owner_tenant_id
    INTO v_app_user_id, v_app_is_default, v_app_status, v_app_visibility, v_owner_dept_id, v_owner_tenant_id
    FROM apps
    WHERE id = p_app_id;
    IF NOT FOUND THEN
        RETURN FALSE;
    END IF;

    -- 用户信息（dept_id, tenant_id, roles）
    SELECT u.tenant_id, u.dept_id, COALESCE(array_agg(r.name) FILTER (WHERE r.name IS NOT NULL), ARRAY[]::TEXT[])
    INTO v_user_tenant_id, v_user_dept_id, v_user_roles
    FROM users u
    LEFT JOIN user_roles ur ON u.id = ur.user_id
    LEFT JOIN roles r ON ur.role_id = r.id
    WHERE u.id = p_user_id
    GROUP BY u.tenant_id, u.dept_id;

    -- 1. 超级管理员全见（含草稿）
    IF '超级管理员' = ANY(v_user_roles) THEN
        RETURN TRUE;
    END IF;

    -- 2. owner 全见（含草稿）
    IF v_app_user_id = p_user_id THEN
        RETURN TRUE;
    END IF;

    -- 3. 非 published：仅审核人（同租户的租户管理员）可见可用——待审队列/审核测试需要
    IF v_app_status IS DISTINCT FROM 'published' THEN
        IF '租户管理员' = ANY(v_user_roles)
           AND v_user_tenant_id IS NOT NULL
           AND v_user_tenant_id = v_owner_tenant_id THEN
            RETURN TRUE;
        END IF;
        RETURN FALSE;
    END IF;

    -- 4. private = 只有 owner 与超管（两者都已在上面 return TRUE 过）。
    --
    --    必须在下面的「部门管理员全见」与「默认应用全员可见」**之前**：那两条不看
    --    visibility，任一个都会把 private 应用漏给别人。原先 private 只是"掉到最后
    --    没被任何分支接住"，于是先被这两条截走了——一个部门管理员能看到别人的 private。
    --
    --    private + is_default 是自相矛盾的配置（前者说只给我，后者说给所有人）：
    --    这里让 private 赢。is_default 只有超管能设，配错了改回来就是；而把私有应用
    --    漏出去是不可撤回的。
    IF v_app_visibility = 'private' THEN
        RETURN FALSE;
    END IF;

    -- ── 以下 published 分支 = 迁移前 legacy 语义原样保留（存量行为零变化）──

    -- 5. 部门管理员可以访问所有已发布应用（legacy 规则 1 的非超管半边）
    IF '部门管理员' = ANY(v_user_roles) THEN
        RETURN TRUE;
    END IF;

    -- 6. 默认应用所有人可见
    IF v_app_is_default THEN
        RETURN TRUE;
    END IF;

    -- 7. visibility 三元组（private 已在第 4 条拦掉，这里只剩 public/dept/tenant）
    IF v_app_visibility = 'public' THEN
        RETURN TRUE;
    ELSIF v_app_visibility = 'dept' THEN
        RETURN v_user_dept_id IS NOT NULL AND v_user_dept_id = v_owner_dept_id;
    ELSIF v_app_visibility = 'tenant' THEN
        -- legacy 混合语义（存量回填值即 tenant）：
        --   同 owner 部门可见；无部门用户按 owner 租户匹配可见。
        -- 有部门用户跨部门（即使同租户）不可见——与迁移前一致，勿"修正"成纯租户匹配。
        IF v_user_dept_id IS NOT NULL AND v_owner_dept_id IS NOT NULL
           AND v_user_dept_id = v_owner_dept_id THEN
            RETURN TRUE;
        END IF;
        IF v_user_dept_id IS NULL AND v_user_tenant_id IS NOT NULL
           AND v_user_tenant_id = v_owner_tenant_id THEN
            RETURN TRUE;
        END IF;
        RETURN FALSE;
    END IF;

    -- private 且非 owner（及未知值）默认拒绝
    RETURN FALSE;
END;
$$;


--
-- Name: FUNCTION can_access_app(p_user_id integer, p_app_id integer); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.can_access_app(p_user_id integer, p_app_id integer) IS '检查用户是否可以访问指定应用（v3）。
规则：
1. 超级管理员全见（含草稿）
2. owner 全见（含草稿）
3. 非 published 应用：仅同租户的租户管理员（审核人）可见可用，其余拒绝
4. private：仅 owner 与超管（在部门管理员/默认应用两条之前判定，v3 新增）
5. published：部门管理员全见（legacy 保留）
6. published：默认应用全员可见
7. published：按 visibility——public 全见 / dept 同 owner 部门 /
   tenant=legacy 混合语义（同 owner 部门 OR 无部门用户同 owner 租户）';


--
-- Name: can_access_dataset(integer, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.can_access_dataset(p_user_id integer, p_dataset_id uuid) RETURNS boolean
    LANGUAGE plpgsql
    AS $$
DECLARE
    v_user_tenant_id INTEGER;
    v_user_dept_id INTEGER;
    v_user_roles TEXT[];
    v_dataset_visibility VARCHAR(20);
    v_dataset_owner_dept_id INTEGER;
    v_dataset_owner_tenant_id INTEGER;
    v_dataset_user_id INTEGER;
BEGIN
    -- 获取用户信息
    SELECT u.tenant_id, u.dept_id, array_agg(r.name)
    INTO v_user_tenant_id, v_user_dept_id, v_user_roles
    FROM users u
    LEFT JOIN user_roles ur ON u.id = ur.user_id
    LEFT JOIN roles r ON ur.role_id = r.id
    WHERE u.id = p_user_id
    GROUP BY u.tenant_id, u.dept_id;
    
    -- 获取数据集信息
    SELECT visibility, owner_dept_id, owner_tenant_id, user_id
    INTO v_dataset_visibility, v_dataset_owner_dept_id, v_dataset_owner_tenant_id, v_dataset_user_id
    FROM datasets
    WHERE id = p_dataset_id;
    
    -- 超级管理员可以访问所有数据集
    IF '超级管理员' = ANY(v_user_roles) THEN
        RETURN TRUE;
    END IF;
    
    -- 租户管理员只能访问自己租户内的数据集
    IF '租户管理员' = ANY(v_user_roles) THEN
        RETURN v_user_tenant_id = v_dataset_owner_tenant_id;
    END IF;
    
    -- 数据集所有者可以访问自己的数据集
    IF v_dataset_user_id = p_user_id THEN
        RETURN TRUE;
    END IF;
    
    -- 根据数据集可见性判断访问权限
    CASE v_dataset_visibility
        WHEN 'private' THEN
            -- 私有数据集只有所有者可以访问
            RETURN v_dataset_user_id = p_user_id;
            
        WHEN 'dept' THEN
            -- 部门共享：同部门用户可以访问
            RETURN v_user_dept_id = v_dataset_owner_dept_id;
            
        WHEN 'tenant' THEN
            -- 租户共享：同租户用户可以访问
            RETURN v_user_tenant_id = v_dataset_owner_tenant_id;
            
        WHEN 'public' THEN
            -- 公开数据集：所有用户都可以访问
            RETURN TRUE;
            
        ELSE
            RETURN FALSE;
    END CASE;
END;
$$;


--
-- Name: FUNCTION can_access_dataset(p_user_id integer, p_dataset_id uuid); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.can_access_dataset(p_user_id integer, p_dataset_id uuid) IS '检查用户是否有权限访问指定数据集';


--
-- Name: can_access_knowledge_file(integer, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.can_access_knowledge_file(p_user_id integer, p_file_id integer) RETURNS boolean
    LANGUAGE plpgsql
    AS $$
      DECLARE
    v_dataset_id UUID;
BEGIN
    -- 获取文件所属的 dataset_id
    SELECT dataset_id INTO v_dataset_id
    FROM knowledge_files
    WHERE id = p_file_id;
    
    -- 如果没有关联 dataset，拒绝访问
    IF v_dataset_id IS NULL THEN
        RETURN FALSE;
    END IF;
    
    -- 使用 dataset 的权限检查函数
    RETURN can_access_dataset(p_user_id, v_dataset_id);
END;
      $$;


--
-- Name: can_edit_dataset(integer, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.can_edit_dataset(p_user_id integer, p_dataset_id uuid) RETURNS boolean
    LANGUAGE plpgsql
    AS $$
DECLARE
    v_user_tenant_id INTEGER;
    v_user_dept_id INTEGER;
    v_user_roles TEXT[];
    v_dataset_visibility VARCHAR(20);
    v_dataset_owner_dept_id INTEGER;
    v_dataset_owner_tenant_id INTEGER;
    v_dataset_user_id INTEGER;
    v_creator_dept_id INTEGER;
    v_creator_tenant_id INTEGER;
    v_is_super_admin BOOLEAN;
    v_is_tenant_admin BOOLEAN;
    v_is_dept_admin BOOLEAN;
BEGIN
    -- 获取用户信息
    SELECT u.tenant_id, u.dept_id, array_agg(r.name)
    INTO v_user_tenant_id, v_user_dept_id, v_user_roles
    FROM users u
    LEFT JOIN user_roles ur ON u.id = ur.user_id
    LEFT JOIN roles r ON ur.role_id = r.id
    WHERE u.id = p_user_id
    GROUP BY u.tenant_id, u.dept_id;
    
    -- 检查用户角色
    v_is_super_admin := '超级管理员' = ANY(v_user_roles);
    v_is_tenant_admin := '租户管理员' = ANY(v_user_roles);
    v_is_dept_admin := '部门管理员' = ANY(v_user_roles);
    
    -- 获取数据集信息
    SELECT visibility, owner_dept_id, owner_tenant_id, user_id
    INTO v_dataset_visibility, v_dataset_owner_dept_id, v_dataset_owner_tenant_id, v_dataset_user_id
    FROM datasets
    WHERE id = p_dataset_id;
    
    -- 超级管理员可以编辑所有数据集
    IF v_is_super_admin THEN
        RETURN TRUE;
    END IF;
    
    -- 租户管理员可以编辑当前租户下的所有知识库
    IF v_is_tenant_admin AND v_user_tenant_id = v_dataset_owner_tenant_id THEN
        RETURN TRUE;
    END IF;
    
    -- 检查是否是创建者
    IF v_dataset_user_id = p_user_id THEN
        RETURN TRUE;
    END IF;
    
    -- 获取创建者的部门ID和租户ID（用于检查创建者的部门管理员）
    SELECT u.dept_id, u.tenant_id
    INTO v_creator_dept_id, v_creator_tenant_id
    FROM users u
    WHERE u.id = v_dataset_user_id;
    
    -- 检查当前用户与创建者是否是同部门的用户
    IF v_user_dept_id IS NOT NULL AND v_creator_dept_id IS NOT NULL AND v_user_dept_id = v_creator_dept_id THEN
        RETURN TRUE;
    END IF;
    
    -- 根据数据集可见性判断编辑权限
    CASE v_dataset_visibility
        WHEN 'private' THEN
            -- 私有数据集：只有创建者可以编辑（已在前面检查，如果不是创建者则返回 FALSE）
            RETURN FALSE;
            
        WHEN 'dept' THEN
            -- 部门共享数据集：
            -- 1. 创建者可以编辑（已在前面检查）
            -- 2. 创建者的部门管理员可以编辑
            -- 3. owner_dept_id 的部门管理员可以编辑
            IF v_is_dept_admin THEN
                -- 检查是否是创建者的部门管理员
                IF v_user_dept_id = v_creator_dept_id THEN
                    RETURN TRUE;
                END IF;
                
                -- 检查是否是 owner_dept_id 的部门管理员
                IF v_user_dept_id = v_dataset_owner_dept_id THEN
                    RETURN TRUE;
                END IF;
            END IF;
            
            RETURN FALSE;
            
        WHEN 'tenant' THEN
            -- 租户共享数据集：
            -- 1. 创建者可以编辑（已在前面检查）
            -- 2. 创建者的部门管理员可以编辑
            -- 3. 创建者的租户管理员可以编辑
            -- 4. 租户管理员（如果 owner_tenant_id = 当前用户租户）可以编辑
            IF v_is_dept_admin AND v_user_dept_id = v_creator_dept_id THEN
                -- 创建者的部门管理员可以编辑
                RETURN TRUE;
            END IF;
            
            IF v_is_tenant_admin THEN
                -- 创建者的租户管理员可以编辑
                IF v_user_tenant_id = v_creator_tenant_id THEN
                    RETURN TRUE;
                END IF;
                
                -- 租户管理员（如果 owner_tenant_id = 当前用户租户）可以编辑
                IF v_user_tenant_id = v_dataset_owner_tenant_id THEN
                    RETURN TRUE;
                END IF;
            END IF;
            
            RETURN FALSE;
            
        WHEN 'public' THEN
            -- 公开数据集：只有创建者、创建者的部门管理员、创建者的租户管理员可以编辑
            IF v_is_dept_admin AND v_user_dept_id = v_creator_dept_id THEN
                RETURN TRUE;
            END IF;
            
            IF v_is_tenant_admin AND v_user_tenant_id = v_creator_tenant_id THEN
                RETURN TRUE;
            END IF;
            
            RETURN FALSE;
            
        ELSE
            RETURN FALSE;
    END CASE;
END;
$$;


--
-- Name: FUNCTION can_edit_dataset(p_user_id integer, p_dataset_id uuid); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.can_edit_dataset(p_user_id integer, p_dataset_id uuid) IS '检查用户是否有权限编辑（添加和修改）指定数据集';


--
-- Name: cleanup_old_tasks(integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.cleanup_old_tasks(days_to_keep integer DEFAULT 30) RETURNS integer
    LANGUAGE plpgsql
    AS $$
DECLARE
    deleted_count INTEGER;
BEGIN
    DELETE FROM tasks
    WHERE completed_at < NOW() - INTERVAL '1 day' * days_to_keep
      AND status IN ('done', 'failed');

    GET DIAGNOSTICS deleted_count = ROW_COUNT;

    RETURN deleted_count;
END;
$$;


--
-- Name: FUNCTION cleanup_old_tasks(days_to_keep integer); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.cleanup_old_tasks(days_to_keep integer) IS '清理过期任务，删除指定天数前完成的任务（默认30天）';


--
-- Name: generate_api_key(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.generate_api_key() RETURNS text
    LANGUAGE plpgsql
    AS $$
BEGIN
    -- 生成一个唯一的 API key（使用 UUID，去掉连字符，32 字符）
    RETURN replace(gen_random_uuid()::text, '-', '');
END;
$$;


--
-- Name: FUNCTION generate_api_key(); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.generate_api_key() IS '生成唯一的 API key（32 字符的 UUID，无连字符）';


--
-- Name: get_dataset_embedding_status(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_dataset_embedding_status(p_dataset_id uuid) RETURNS TABLE(dataset_name text, current_segment_model text, files_count integer, pending_files integer, indexed_files integer, failed_files integer, segments_count integer)
    LANGUAGE plpgsql
    AS $$
BEGIN
  RETURN QUERY
  SELECT 
    d.name,
    COALESCE(d.settings->>'segmentModel', 'not_set') as current_segment_model,
    COUNT(f.id) as files_count,
    COUNT(CASE WHEN f.status = 'pending' THEN 1 END) as pending_files,
    COUNT(CASE WHEN f.status = 'indexed' THEN 1 END) as indexed_files,
    COUNT(CASE WHEN f.status = 'failed' THEN 1 END) as failed_files,
    COUNT(s.id) as segments_count
  FROM datasets d
  LEFT JOIN knowledge_files f ON d.id = f.dataset_id
  LEFT JOIN knowledge_segments s ON f.id = s.file_id
  WHERE d.id = p_dataset_id
  GROUP BY d.id, d.name, d.settings;
END;
$$;


--
-- Name: get_user_accessible_files(integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_user_accessible_files(p_user_id integer) RETURNS TABLE(file_id integer, filename character varying, originalname character varying, mimetype character varying, size bigint, upload_time timestamp without time zone, status character varying, dataset_id uuid, user_id integer, category_id integer, meta jsonb, path character varying)
    LANGUAGE plpgsql
    AS $$
BEGIN
    RETURN QUERY
    SELECT 
        kf.id,
        kf.filename,
        kf.originalname,
        kf.mimetype,
        kf.size,
        kf.upload_time,
        kf.status,
        kf.dataset_id,
        kf.user_id,
        kf.category_id,
        kf.meta,
        kf.path
    FROM knowledge_files kf
    WHERE can_access_knowledge_file(p_user_id, kf.id);
END;
$$;


--
-- Name: is_dept_ancestor_or_self(integer, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.is_dept_ancestor_or_self(p_user_dept_id integer, p_target_dept_id integer) RETURNS boolean
    LANGUAGE plpgsql
    AS $$
      DECLARE
    v_user_dept_path VARCHAR(500);
    v_target_dept_path VARCHAR(500);
BEGIN
    -- 如果部门ID相同，直接返回true
    IF p_user_dept_id = p_target_dept_id THEN
        RETURN TRUE;
    END IF;
    
    -- 获取用户部门路径
    SELECT path INTO v_user_dept_path
    FROM dept 
    WHERE id = p_user_dept_id;
    
    -- 获取目标部门路径
    SELECT path INTO v_target_dept_path
    FROM dept 
    WHERE id = p_target_dept_id;
    
    -- 如果任一部门不存在，返回false
    IF v_user_dept_path IS NULL OR v_target_dept_path IS NULL THEN
        RETURN FALSE;
    END IF;
    
    -- 检查用户部门是否是目标部门的上级部门（路径前缀匹配）
    -- 例如：用户部门路径是 "tech"，目标部门路径是 "tech/dev"，则用户可以看到目标部门的数据
    RETURN v_target_dept_path LIKE v_user_dept_path || '/%' OR v_target_dept_path = v_user_dept_path;
END
      $$;


--
-- Name: reset_dataset_embedding_model(uuid, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.reset_dataset_embedding_model(p_dataset_id uuid, p_new_segment_model text) RETURNS json
    LANGUAGE plpgsql
    AS $$
      DECLARE
  v_dataset_name TEXT;
  v_old_segment_model TEXT;
  v_files_count INTEGER;
  v_segments_deleted INTEGER;
  v_settings JSONB;
  v_result JSON;
BEGIN
  -- Check if dataset exists
  SELECT name, settings INTO v_dataset_name, v_settings
  FROM datasets 
  WHERE id = p_dataset_id;
  
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Dataset not found: %', p_dataset_id;
  END IF;
  
  -- Check if segment model is actually changing
  v_old_segment_model := COALESCE(v_settings->>'segmentModel', 'not_set');
  IF v_old_segment_model = p_new_segment_model THEN
    RETURN json_build_object(
      'success', false,
      'message', 'Segment model is already set to the target value',
      'current_model', v_old_segment_model
    );
  END IF;
  
  -- Validate new segment model
  IF p_new_segment_model NOT IN ('bge', 'openai') THEN
    RAISE EXCEPTION 'Invalid segment model: %. Must be "bge" or "openai"', p_new_segment_model;
  END IF;
  
  -- Get count of files that will be affected
  SELECT COUNT(*) INTO v_files_count
  FROM knowledge_files 
  WHERE dataset_id = p_dataset_id;
  
  -- Start transaction
  BEGIN
    -- Update dataset settings
    UPDATE datasets 
    SET 
      settings = jsonb_set(
        COALESCE(settings, '{}'::jsonb), 
        '{segmentModel}', 
        to_jsonb(p_new_segment_model)
      ),
      updated_at = CURRENT_TIMESTAMP 
    WHERE id = p_dataset_id;
    
    -- Reset all file statuses to pending
    UPDATE knowledge_files 
    SET 
      status = 'pending',
      updated_at = CURRENT_TIMESTAMP 
    WHERE dataset_id = p_dataset_id;
    
    -- Delete all existing segments (they need to be re-vectorized with new model)
    DELETE FROM knowledge_segments 
    WHERE file_id IN (
      SELECT id FROM knowledge_files WHERE dataset_id = p_dataset_id
    );
    
    GET DIAGNOSTICS v_segments_deleted = ROW_COUNT;
    
    -- Log the operation
    INSERT INTO system_logs (action, details, user_id, created_at) VALUES (
      'reset_dataset_embedding_model',
      json_build_object(
        'dataset_id', p_dataset_id,
        'dataset_name', v_dataset_name,
        'old_segment_model', v_old_segment_model,
        'new_segment_model', p_new_segment_model,
        'files_affected', v_files_count,
        'segments_deleted', v_segments_deleted
      )::text,
      NULL, -- system operation
      CURRENT_TIMESTAMP
    );
    
    -- Return success result
    v_result := json_build_object(
      'success', true,
      'message', 'Dataset embedding model reset successfully',
      'dataset_id', p_dataset_id,
      'dataset_name', v_dataset_name,
      'old_segment_model', v_old_segment_model,
      'new_segment_model', p_new_segment_model,
      'files_affected', v_files_count,
      'segments_deleted', v_segments_deleted,
      'next_steps', ARRAY[
        'All files status reset to pending',
        'Existing segments deleted',
        'Need to re-run vectorization process',
        'Use vectorize API to reprocess files'
      ]
    );
    
    RETURN v_result;
    
  EXCEPTION
    WHEN OTHERS THEN
      -- Rollback transaction on error
      RAISE EXCEPTION 'Failed to reset dataset embedding model: %', SQLERRM;
  END;
  
END;
      $$;


--
-- Name: set_answered_at_and_duration_on_answer_update(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.set_answered_at_and_duration_on_answer_update() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    -- 当answer字段被设置且answered_at为空时，自动设置answered_at和duration_ms
    IF NEW.answer IS NOT NULL AND NEW.answered_at IS NULL THEN
        NEW.answered_at = clock_timestamp();
        
        -- 如果submitted_at也存在，计算duration_ms
        IF NEW.submitted_at IS NOT NULL THEN
            NEW.duration_ms := EXTRACT(EPOCH FROM (NEW.answered_at - NEW.submitted_at)) * 1000;
            
            -- 如果时间差太小（小于10毫秒），设置为100毫秒
            IF NEW.duration_ms < 10 THEN
                NEW.duration_ms := 100;
            END IF;
        END IF;
    END IF;
    
    RETURN NEW;
END;
$$;


--
-- Name: set_answered_at_on_answer_update(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.set_answered_at_on_answer_update() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    -- 当answer字段被设置且answered_at为空时，自动设置answered_at
    IF NEW.answer IS NOT NULL AND NEW.answered_at IS NULL THEN
        NEW.answered_at = NOW();
    END IF;
    
    RETURN NEW;
END;
$$;


--
-- Name: set_submitted_at_on_question_update(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.set_submitted_at_on_question_update() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    -- 当question字段被设置且submitted_at为空时，自动设置submitted_at
    IF NEW.question IS NOT NULL AND NEW.submitted_at IS NULL THEN
        NEW.submitted_at = clock_timestamp();
    END IF;
    
    RETURN NEW;
END;
$$;


--
-- Name: sync_existing_knowledge_files(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.sync_existing_knowledge_files() RETURNS integer
    LANGUAGE plpgsql
    AS $$
DECLARE
    updated_count INTEGER;
BEGIN
    -- 由于knowledge_files表中没有owner_dept_id和owner_tenant_id字段，
    -- 这个函数现在只记录日志，不执行实际的更新操作
    SELECT COUNT(*) INTO updated_count FROM knowledge_files kf
    JOIN users u ON kf.user_id = u.id;
    
    RAISE NOTICE 'Found % knowledge_files associated with users', updated_count;
    
    RETURN updated_count;
END;
$$;


--
-- Name: update_datasets_updated_at(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.update_datasets_updated_at() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$;


--
-- Name: update_knowledge_files_on_user_change(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.update_knowledge_files_on_user_change() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    -- 当用户的部门或租户发生变化时
    IF OLD.dept_id IS DISTINCT FROM NEW.dept_id OR OLD.tenant_id IS DISTINCT FROM NEW.tenant_id THEN
        -- 记录变更日志（可选）
        RAISE NOTICE 'User % changed: dept_id % -> %, tenant_id % -> %', 
            NEW.id, OLD.dept_id, NEW.dept_id, OLD.tenant_id, NEW.tenant_id;
    END IF;
    
    RETURN NEW;
END;
$$;


--
-- Name: update_prompts_updated_at(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.update_prompts_updated_at() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
      BEGIN
  NEW.updated_at = CURRENT_TIMESTAMP;
  RETURN NEW;
END;
      $$;


--
-- Name: update_tasks_updated_at(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.update_tasks_updated_at() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$;


--
-- Name: update_updated_at_column(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.update_updated_at_column() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$;


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: _archive_cad_workflow_rows; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public._archive_cad_workflow_rows (
    tool_id integer,
    name character varying(100),
    tool_type character varying(50),
    display_name character varying(200),
    description text,
    category character varying(50),
    default_config json,
    is_enabled boolean,
    is_system boolean,
    app_id integer,
    custom_config json,
    priority integer,
    archived_at timestamp with time zone
);


--
-- Name: TABLE _archive_cad_workflow_rows; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public._archive_cad_workflow_rows IS '迁移 045 删除 cad.* workflow 行前的备份。这些行只承载 per-kind 的 is_enabled，现由 mcp-mz-cad 的依赖门覆盖（WorkflowSpec.requires_tool）。';


--
-- Name: _archive_native_tool_rows; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public._archive_native_tool_rows (
    tool_id integer,
    name character varying(100),
    tool_type character varying(50),
    description text,
    default_config json,
    is_enabled boolean,
    app_id integer,
    custom_config json,
    priority integer,
    archived_at timestamp with time zone
);


--
-- Name: TABLE _archive_native_tool_rows; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public._archive_native_tool_rows IS '迁移 042 删除 native tools/app_tools 行前的备份。原生工具改为代码名册 + 代码授权判据（app/tools/native_registry.py），这些行已不被消费；保留仅为可回溯。';


--
-- Name: app_datasets; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.app_datasets (
    app_id integer NOT NULL,
    dataset_id character varying(255) NOT NULL
);


--
-- Name: app_skills; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.app_skills (
    id integer NOT NULL,
    app_id integer NOT NULL,
    skill_id integer NOT NULL,
    created_at timestamp without time zone DEFAULT now(),
    updated_at timestamp without time zone DEFAULT now()
);


--
-- Name: TABLE app_skills; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.app_skills IS '应用-Skill 绑定（绑定即启用，注入 published_content 按绑定顺序 id 升序）';


--
-- Name: app_skills_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.app_skills_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: app_skills_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.app_skills_id_seq OWNED BY public.app_skills.id;


--
-- Name: app_tools; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.app_tools (
    id integer NOT NULL,
    app_id integer NOT NULL,
    tool_id integer NOT NULL,
    custom_config json,
    priority integer DEFAULT 0,
    created_at timestamp without time zone,
    updated_at timestamp without time zone
);


--
-- Name: TABLE app_tools; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.app_tools IS '应用-工具关联表';


--
-- Name: COLUMN app_tools.custom_config; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.app_tools.custom_config IS '应用级别的个性化配置（覆盖工具默认配置）';


--
-- Name: COLUMN app_tools.priority; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.app_tools.priority IS '优先级（用于排序）';


--
-- Name: app_tools_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.app_tools_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: app_tools_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.app_tools_id_seq OWNED BY public.app_tools.id;


--
-- Name: apps; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.apps (
    id integer NOT NULL,
    name character varying(255) NOT NULL,
    description text,
    app_type character varying(50),
    platform character varying(50),
    user_id integer NOT NULL,
    ai_model character varying(100),
    settings jsonb DEFAULT '{}'::jsonb,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    email character varying,
    is_default boolean DEFAULT false,
    agent_md text,
    status character varying(20) DEFAULT 'published'::character varying NOT NULL,
    visibility character varying(20) DEFAULT 'tenant'::character varying NOT NULL,
    owner_dept_id integer,
    owner_tenant_id integer,
    avatar_url text,
    CONSTRAINT apps_status_check CHECK (((status)::text = ANY ((ARRAY['draft'::character varying, 'pending_review'::character varying, 'rejected'::character varying, 'published'::character varying])::text[]))),
    CONSTRAINT apps_visibility_check CHECK (((visibility)::text = ANY ((ARRAY['private'::character varying, 'dept'::character varying, 'tenant'::character varying, 'public'::character varying])::text[])))
);


--
-- Name: COLUMN apps.agent_md; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.apps.agent_md IS '应用 Agent.md 全文（frontmatter+正文）。NULL=沿用 prompt_id 组装（legacy）。运行时优先本列。';


--
-- Name: COLUMN apps.status; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.apps.status IS '审核状态：draft/pending_review/rejected/published；非 published 仅 owner/审核人可见可用';


--
-- Name: COLUMN apps.visibility; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.apps.visibility IS 'published 后的可见范围：private/dept/tenant/public（tenant=legacy 混合语义，见 can_access_app）';


--
-- Name: COLUMN apps.owner_dept_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.apps.owner_dept_id IS '创建者部门快照（迁移回填/创建时落）';


--
-- Name: COLUMN apps.owner_tenant_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.apps.owner_tenant_id IS '创建者租户快照（迁移回填/创建时落）';


--
-- Name: COLUMN apps.avatar_url; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.apps.avatar_url IS '数字员工头像 URL：内置头像的静态路径（/avatars/*.svg）或上传后的 OSS 读代理路径（/api/oss/...）。NULL=未设置，前端按名称生成占位';


--
-- Name: apps_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.apps_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: apps_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.apps_id_seq OWNED BY public.apps.id;


--
-- Name: billing_rate_audit; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.billing_rate_audit (
    id bigint NOT NULL,
    rate_type character varying(20) NOT NULL,
    ref_key character varying(200) NOT NULL,
    old_coefficient numeric(10,4),
    new_coefficient numeric(10,4),
    changed_by integer,
    reason text,
    changed_at timestamp without time zone DEFAULT now() NOT NULL
);


--
-- Name: billing_rate_audit_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.billing_rate_audit_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: billing_rate_audit_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.billing_rate_audit_id_seq OWNED BY public.billing_rate_audit.id;


--
-- Name: billing_rates; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.billing_rates (
    id integer NOT NULL,
    rate_type character varying(20) NOT NULL,
    ref_key character varying(200) NOT NULL,
    coefficient numeric(10,4) NOT NULL,
    note text,
    updated_by integer,
    updated_at timestamp without time zone DEFAULT now() NOT NULL,
    created_at timestamp without time zone DEFAULT now() NOT NULL
);


--
-- Name: TABLE billing_rates; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.billing_rates IS '计费系数。只存显式设置的行；缺行回落到 ref_key=''*'' 的全局默认。
     「缺行」本身是有意义的状态：管理页据此标出哪些在吃默认值。';


--
-- Name: COLUMN billing_rates.ref_key; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.billing_rates.ref_key IS '模型名 / skill_id / tool_id 的字符串形式；''*'' 表示该类型的全局默认值';


--
-- Name: COLUMN billing_rates.coefficient; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.billing_rates.coefficient IS 'model：相对基准模型的价格倍率（deepseek=1）。
     skill / tool：每次调用的积分数（免费工具显式设 0）';


--
-- Name: billing_rates_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.billing_rates_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: billing_rates_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.billing_rates_id_seq OWNED BY public.billing_rates.id;


--
-- Name: chat_session; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.chat_session (
    id integer NOT NULL,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    user_id integer,
    knowledge_files_ids character varying,
    summary text,
    app_id integer,
    dataset_ids text[]
);


--
-- Name: chat_session_detail; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.chat_session_detail (
    id integer NOT NULL,
    session_id integer,
    question text,
    answer text,
    submitted_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    answered_at timestamp without time zone,
    duration_ms integer,
    feedback text,
    vote_good boolean,
    vote_bad boolean,
    segments_ids integer[],
    segment_similarities double precision[],
    "references" integer[],
    workflow_run_id bigint,
    prompt_tokens integer,
    completion_tokens integer,
    total_tokens integer,
    llm_calls integer,
    model_name character varying(100),
    usage_partial boolean,
    cache_read_tokens integer,
    cache_write_tokens integer,
    tenant_id integer
);


--
-- Name: COLUMN chat_session_detail.workflow_run_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.chat_session_detail.workflow_run_id IS '若该消息触发了长任务，关联 workflow_runs.id；run 被删时置 NULL（保留消息）';


--
-- Name: COLUMN chat_session_detail.prompt_tokens; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.chat_session_detail.prompt_tokens IS '本轮全部 LLM 调用的输入 token 之和。NULL=未记录，与 0 语义不同';


--
-- Name: COLUMN chat_session_detail.completion_tokens; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.chat_session_detail.completion_tokens IS '本轮全部 LLM 调用的输出 token 之和。NULL=未记录';


--
-- Name: COLUMN chat_session_detail.total_tokens; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.chat_session_detail.total_tokens IS '通常等于 prompt+completion；由 provider 直接给出时以其为准（可能含缓存命中等口径差异）';


--
-- Name: COLUMN chat_session_detail.llm_calls; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.chat_session_detail.llm_calls IS '本轮调了几次模型。一轮对话不等于一次调用：agent 每个工具轮次都重发一次完整上下文
     （max_tool_rounds 默认 20），input token 因此逐轮累积。没有这个数，事后看到一个
     异常大的 input 无法区分「上下文长」还是「工具轮次多」，而这两者的处置完全不同。';


--
-- Name: COLUMN chat_session_detail.model_name; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.chat_session_detail.model_name IS '本轮实际使用的模型。模型是每请求解析的（resolve_runtime_model：本地 Ollama
     或远程 DeepSeek），不记下来事后就算不出钱——「用量明细」要按模型分摊单价。';


--
-- Name: COLUMN chat_session_detail.usage_partial; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.chat_session_detail.usage_partial IS 'TRUE=这是中断时落下的部分用量（用户关页面/点停止）。用户裁定：中断也要落已知用量
     ——模型的钱已经花了，不记账会系统性偏小。但它不完整，做汇总时要能把它单独拎出来。';


--
-- Name: COLUMN chat_session_detail.cache_read_tokens; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.chat_session_detail.cache_read_tokens IS '本轮输入里命中缓存的部分（prompt_tokens 的子集），按约 1/10 计价。
     采集时三个位置都收：LangChain 标准位 input_token_details.cache_read、
     DeepSeek 平铺的 prompt_cache_hit_tokens、OpenAI 的
     prompt_tokens_details.cached_tokens —— 只认一个就会有 provider 静默记成 0。';


--
-- Name: COLUMN chat_session_detail.cache_write_tokens; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.chat_session_detail.cache_write_tokens IS '写入缓存的 token（Anthropic 系按更高价计费）。DeepSeek 无此概念，恒为 0。';


--
-- Name: COLUMN chat_session_detail.tenant_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.chat_session_detail.tenant_id IS '该轮次归属的租户，落库时从 session → user → tenant 推导后冗余。
     NULL = 该用户没有租户归属。用户换租户后历史行保持原值 ——
     那些消耗确实发生在旧租户账上，不随迁移改变。';


--
-- Name: chat_session_detail_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.chat_session_detail_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: chat_session_detail_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.chat_session_detail_id_seq OWNED BY public.chat_session_detail.id;


--
-- Name: chat_session_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.chat_session_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: chat_session_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.chat_session_id_seq OWNED BY public.chat_session.id;


--
-- Name: credit_accounts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.credit_accounts (
    tenant_id integer NOT NULL,
    overdraft_limit numeric(14,2) DEFAULT 0 NOT NULL,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL
);


--
-- Name: TABLE credit_accounts; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.credit_accounts IS '租户积分账户。**不存余额** —— 余额从 credit_transactions 现算（见迁移 064）。
     本表当前只承载 overdraft_limit，供 P3 的余额拦截使用';


--
-- Name: COLUMN credit_accounts.overdraft_limit; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.credit_accounts.overdraft_limit IS '允许透支到的负值下限（正数表示额度，10 = 可用到 -10）。
     默认 0：余额必须 > 0 才能开新一轮。
     判据只在**开始**一轮时生效 —— 已经开跑的一轮一定跑完，哪怕它把余额压成负数。
     流式开始时无法预知这轮要花多少，预扣要么占用余额、要么中途掐断用户的话。';


--
-- Name: credit_transactions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.credit_transactions (
    id bigint NOT NULL,
    tenant_id integer NOT NULL,
    user_id integer,
    tx_type character varying(20) NOT NULL,
    amount numeric(12,2) NOT NULL,
    balance_after numeric(14,2),
    chat_session_detail_id bigint,
    breakdown jsonb,
    rate_snapshot jsonb,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    operator_id integer,
    note text,
    idempotency_key character varying(64)
);


--
-- Name: COLUMN credit_transactions.amount; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.credit_transactions.amount IS '一律正数；是收是支由 tx_type 决定。用带符号的数会让"这个月消耗了多少"
     写成 sum(-amount)，读的人容易把符号搞反';


--
-- Name: COLUMN credit_transactions.balance_after; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.credit_transactions.balance_after IS 'P1 阶段为 NULL：只记账不拦截，不维护余额。P3 开启扣费后才填';


--
-- Name: COLUMN credit_transactions.breakdown; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.credit_transactions.breakdown IS '分项：{"token": {...}, "skills": [...], "tools": [...]}。
     用户对账时要能展开到「这笔钱由什么构成」（§6.3）';


--
-- Name: COLUMN credit_transactions.rate_snapshot; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.credit_transactions.rate_snapshot IS '**当时**用的系数。展示时绝不反查当前系数 —— 系数改过之后，
     反查会让历史账单跟着变，用户对账时这是灾难（§6.3）';


--
-- Name: COLUMN credit_transactions.operator_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.credit_transactions.operator_id IS '执行这笔操作的人（充值/调整时是超管本人）。刻意不加外键：
     这是账目留档，账要在人被删之后依然读得懂';


--
-- Name: COLUMN credit_transactions.note; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.credit_transactions.note IS '充值备注（打款单号、合同号、赠送理由）。对账时「这笔钱哪来的」全靠它';


--
-- Name: credit_transactions_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.credit_transactions_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: credit_transactions_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.credit_transactions_id_seq OWNED BY public.credit_transactions.id;


--
-- Name: knowledge_files; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.knowledge_files (
    id integer NOT NULL,
    filename character varying NOT NULL,
    originalname character varying NOT NULL,
    mimetype character varying NOT NULL,
    size bigint NOT NULL,
    upload_time timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    status character varying DEFAULT 'pending'::character varying,
    path character varying,
    category_id integer,
    graph_status character varying DEFAULT 'pending'::character varying,
    user_id integer,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    dataset_id uuid,
    object_key character varying(500),
    summary text
);


--
-- Name: knowledge_segments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.knowledge_segments (
    id integer NOT NULL,
    file_id integer,
    segment_index integer,
    segment_text text,
    embedding_vector public.vector,
    status character varying,
    split_mode character varying,
    created_at timestamp without time zone DEFAULT now(),
    embedding_model character varying(50)
);


--
-- Name: dataset_segment_stats; Type: MATERIALIZED VIEW; Schema: public; Owner: -
--

CREATE MATERIALIZED VIEW public.dataset_segment_stats AS
 SELECT f.dataset_id,
    count(DISTINCT s.id) AS n_segments,
    (COALESCE(avg(length(s.segment_text)), 1.0))::double precision AS avg_doc_length
   FROM (public.knowledge_segments s
     JOIN public.knowledge_files f ON ((s.file_id = f.id)))
  GROUP BY f.dataset_id
  WITH NO DATA;


--
-- Name: MATERIALIZED VIEW dataset_segment_stats; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON MATERIALIZED VIEW public.dataset_segment_stats IS 'BM25 dataset 级统计缓存。每 5 分钟由 dataset_stats_refresher 协程 REFRESH CONCURRENTLY。';


--
-- Name: datasets; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.datasets (
    id uuid NOT NULL,
    name text NOT NULL,
    settings jsonb,
    created_at timestamp without time zone DEFAULT now(),
    user_id integer,
    visibility character varying(20) DEFAULT 'dept'::character varying,
    owner_dept_id integer,
    owner_tenant_id integer,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    graph_status character varying(20) DEFAULT 'pending'::character varying,
    description text,
    keywords jsonb DEFAULT '[]'::jsonb,
    embedding_vector public.vector(1024),
    priority integer DEFAULT 0,
    CONSTRAINT datasets_visibility_check CHECK (((visibility)::text = ANY ((ARRAY['private'::character varying, 'dept'::character varying, 'tenant'::character varying, 'public'::character varying])::text[])))
);


--
-- Name: COLUMN datasets.user_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.datasets.user_id IS '数据集创建者ID';


--
-- Name: COLUMN datasets.visibility; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.datasets.visibility IS '数据集可见性：private(私有)、dept(部门共享)、tenant(租户共享)、public(公开)';


--
-- Name: COLUMN datasets.owner_dept_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.datasets.owner_dept_id IS '数据集所属部门ID';


--
-- Name: COLUMN datasets.owner_tenant_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.datasets.owner_tenant_id IS '数据集所属租户ID';


--
-- Name: COLUMN datasets.updated_at; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.datasets.updated_at IS '最后更新时间';


--
-- Name: COLUMN datasets.graph_status; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.datasets.graph_status IS '知识图谱状态：pending-待处理, processing-处理中, done-完成, warning-部分失败';


--
-- Name: COLUMN datasets.description; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.datasets.description IS '数据集描述，用于智能分类（可选）';


--
-- Name: COLUMN datasets.keywords; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.datasets.keywords IS '关键词列表，用于智能分类（可选）["React", "Vue", "前端"]';


--
-- Name: COLUMN datasets.embedding_vector; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.datasets.embedding_vector IS 'E5 向量（1024维），用于语义相似度计算';


--
-- Name: COLUMN datasets.priority; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.datasets.priority IS '优先级，用于相似度相同时排序（默认0）';


--
-- Name: dept; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.dept (
    id integer NOT NULL,
    tenant_id integer,
    parent_id integer,
    name character varying(255) NOT NULL,
    code character varying(100) NOT NULL,
    level integer DEFAULT 1,
    path character varying(500),
    sort_order integer DEFAULT 0,
    status character varying(20) DEFAULT 'active'::character varying,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: dept_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.dept_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: dept_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.dept_id_seq OWNED BY public.dept.id;


--
-- Name: knowledge_category; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.knowledge_category (
    id integer NOT NULL,
    name character varying NOT NULL,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    graph_status character varying DEFAULT 'pending'::character varying,
    user_id integer
);


--
-- Name: knowledge_category_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.knowledge_category_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: knowledge_category_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.knowledge_category_id_seq OWNED BY public.knowledge_category.id;


--
-- Name: knowledge_file_contents; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.knowledge_file_contents (
    id integer NOT NULL,
    file_id integer NOT NULL,
    content_data jsonb,
    content_hash character varying(64),
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: knowledge_file_contents_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.knowledge_file_contents_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: knowledge_file_contents_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.knowledge_file_contents_id_seq OWNED BY public.knowledge_file_contents.id;


--
-- Name: knowledge_file_tags; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.knowledge_file_tags (
    id integer NOT NULL,
    file_id integer NOT NULL,
    tag_id integer NOT NULL,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: knowledge_file_tags_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.knowledge_file_tags_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: knowledge_file_tags_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.knowledge_file_tags_id_seq OWNED BY public.knowledge_file_tags.id;


--
-- Name: knowledge_files_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.knowledge_files_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: knowledge_files_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.knowledge_files_id_seq OWNED BY public.knowledge_files.id;


--
-- Name: knowledge_segments_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.knowledge_segments_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: knowledge_segments_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.knowledge_segments_id_seq OWNED BY public.knowledge_segments.id;


--
-- Name: knowledge_tags; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.knowledge_tags (
    id integer NOT NULL,
    name character varying(100) NOT NULL,
    color character varying(7) DEFAULT '#3b82f6'::character varying,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: knowledge_tags_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.knowledge_tags_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: knowledge_tags_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.knowledge_tags_id_seq OWNED BY public.knowledge_tags.id;


--
-- Name: password_reset_tokens; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.password_reset_tokens (
    id integer NOT NULL,
    user_id integer NOT NULL,
    token character varying(255) NOT NULL,
    expires_at timestamp without time zone NOT NULL,
    used boolean DEFAULT false,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: TABLE password_reset_tokens; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.password_reset_tokens IS '密码重置令牌表';


--
-- Name: COLUMN password_reset_tokens.user_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.password_reset_tokens.user_id IS '用户ID，关联users表';


--
-- Name: COLUMN password_reset_tokens.token; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.password_reset_tokens.token IS '重置令牌，使用UUID生成';


--
-- Name: COLUMN password_reset_tokens.expires_at; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.password_reset_tokens.expires_at IS '令牌过期时间';


--
-- Name: COLUMN password_reset_tokens.used; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.password_reset_tokens.used IS '令牌是否已使用';


--
-- Name: COLUMN password_reset_tokens.created_at; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.password_reset_tokens.created_at IS '创建时间';


--
-- Name: password_reset_tokens_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.password_reset_tokens_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: password_reset_tokens_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.password_reset_tokens_id_seq OWNED BY public.password_reset_tokens.id;


--
-- Name: products; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.products (
    id integer NOT NULL,
    sn character varying(100) NOT NULL,
    name character varying(255) NOT NULL,
    category text,
    material character varying(255),
    spec text,
    description text,
    memo text,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    embedding_status character varying(50) DEFAULT 'pending'::character varying,
    embedding_text text,
    embedding_vector public.vector(1024),
    embedding_vector_oai public.vector(1536)
);


--
-- Name: COLUMN products.embedding_vector; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.products.embedding_vector IS '本地 BGE embedding 向量数据 (1024 维度)';


--
-- Name: COLUMN products.embedding_vector_oai; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.products.embedding_vector_oai IS '原有的 OpenAI embedding 向量数据备份 (1536 维度)';


--
-- Name: products_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.products_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: products_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.products_id_seq OWNED BY public.products.id;


--
-- Name: review_log; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.review_log (
    id integer NOT NULL,
    target_type character varying(20) NOT NULL,
    target_id integer NOT NULL,
    action character varying(20) NOT NULL,
    reviewer_id integer,
    comment text,
    created_at timestamp without time zone DEFAULT now(),
    CONSTRAINT review_log_action_check CHECK (((action)::text = ANY ((ARRAY['submit'::character varying, 'approve'::character varying, 'reject'::character varying, 'self_publish'::character varying])::text[]))),
    CONSTRAINT review_log_target_type_check CHECK (((target_type)::text = ANY ((ARRAY['skill'::character varying, 'app'::character varying])::text[])))
);


--
-- Name: TABLE review_log; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.review_log IS '审核审计日志：skill/app 的 submit/approve/reject/self_publish 全记录';


--
-- Name: COLUMN review_log.reviewer_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.review_log.reviewer_id IS '动作执行人：submit=提交者，approve/reject/self_publish=审核人';


--
-- Name: review_log_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.review_log_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: review_log_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.review_log_id_seq OWNED BY public.review_log.id;


--
-- Name: role_permissions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.role_permissions (
    id integer NOT NULL,
    role_id integer,
    resource_type character varying(50) NOT NULL,
    permission character varying(50) NOT NULL,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: role_permissions_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.role_permissions_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: role_permissions_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.role_permissions_id_seq OWNED BY public.role_permissions.id;


--
-- Name: roles; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.roles (
    id integer NOT NULL,
    tenant_id integer,
    name character varying(100) NOT NULL,
    description text,
    is_system boolean DEFAULT false,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: roles_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.roles_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: roles_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.roles_id_seq OWNED BY public.roles.id;


--
-- Name: sandbox_images; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.sandbox_images (
    id integer NOT NULL,
    name character varying(200) NOT NULL,
    tag character varying(100) DEFAULT 'latest'::character varying NOT NULL,
    digest character varying(100),
    description text,
    is_enabled boolean DEFAULT true NOT NULL,
    created_by integer,
    created_at timestamp without time zone DEFAULT now(),
    updated_at timestamp without time zone DEFAULT now()
);


--
-- Name: TABLE sandbox_images; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.sandbox_images IS '可执行 skill 沙箱镜像白名单：skill_exec_configs 只能引用本表；构建仍手工，平台管引用/版本/合法性';


--
-- Name: COLUMN sandbox_images.digest; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.sandbox_images.digest IS 'sha256:…；非空则 docker run 按 name@digest 锁版本，NULL=开发期按 name:tag';


--
-- Name: COLUMN sandbox_images.is_enabled; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.sandbox_images.is_enabled IS '下架开关：FALSE 时引用它的 skill 拒绝执行并报清晰错误';


--
-- Name: sandbox_images_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.sandbox_images_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: sandbox_images_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.sandbox_images_id_seq OWNED BY public.sandbox_images.id;


--
-- Name: skill_assets; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.skill_assets (
    id integer NOT NULL,
    skill_id integer NOT NULL,
    stage character varying(10) NOT NULL,
    kind character varying(20) NOT NULL,
    path character varying(500) NOT NULL,
    content bytea,
    storage_ref character varying(500),
    sha256 character(64) NOT NULL,
    size_bytes integer NOT NULL,
    source_repo character varying(300),
    source_commit character varying(64),
    created_by_agent boolean DEFAULT false NOT NULL,
    created_at timestamp without time zone DEFAULT now(),
    updated_at timestamp without time zone DEFAULT now(),
    CONSTRAINT skill_assets_check CHECK (((content IS NOT NULL) OR (storage_ref IS NOT NULL))),
    CONSTRAINT skill_assets_kind_check CHECK (((kind)::text = ANY ((ARRAY['script'::character varying, 'reference'::character varying, 'asset'::character varying, 'data'::character varying])::text[]))),
    CONSTRAINT skill_assets_stage_check CHECK (((stage)::text = ANY ((ARRAY['draft'::character varying, 'published'::character varying])::text[])))
);


--
-- Name: TABLE skill_assets; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.skill_assets IS '可执行 skill 资产（脚本/参考/素材/数据）：行级双 stage，publish/approve 事务内 draft→published 快照；物化见 app/services/skill_materializer.py';


--
-- Name: COLUMN skill_assets.sha256; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.skill_assets.sha256 IS '内容 sha256（原始字节，不 strip）；物化写后校验 + snapshot_hash 聚合输入';


--
-- Name: COLUMN skill_assets.source_commit; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.skill_assets.source_commit IS '导入时项目仓 HEAD（scripts/import_skill_assets.py 记录），双真源漂移排查锚点';


--
-- Name: COLUMN skill_assets.created_by_agent; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.skill_assets.created_by_agent IS 'P6 锚点：NL 创建流水线生成的资产标记；P8a 只就位列';


--
-- Name: skill_assets_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.skill_assets_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: skill_assets_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.skill_assets_id_seq OWNED BY public.skill_assets.id;


--
-- Name: skill_exec_configs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.skill_exec_configs (
    id integer NOT NULL,
    skill_id integer NOT NULL,
    stage character varying(10) NOT NULL,
    image_id integer NOT NULL,
    timeout_sec integer DEFAULT 120 NOT NULL,
    writable_subdirs jsonb DEFAULT '[]'::jsonb NOT NULL,
    warm_pool boolean DEFAULT false NOT NULL,
    created_at timestamp without time zone DEFAULT now(),
    updated_at timestamp without time zone DEFAULT now(),
    needs_network boolean DEFAULT false NOT NULL,
    artifact_exclude jsonb,
    CONSTRAINT skill_exec_configs_stage_check CHECK (((stage)::text = ANY ((ARRAY['draft'::character varying, 'published'::character varying])::text[]))),
    CONSTRAINT skill_exec_configs_timeout_sec_check CHECK (((timeout_sec >= 1) AND (timeout_sec <= 3600)))
);


--
-- Name: TABLE skill_exec_configs; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.skill_exec_configs IS '可执行 skill 运行配置（P8a）：随 P5 状态机行级双 stage 快照；运行时只读 published。跑什么由调用时的 command 决定（entrypoint 已于 039 删除）；能不能出网由 needs_network 决定（needs_llm 及模型网关已于 040 删除）';


--
-- Name: COLUMN skill_exec_configs.writable_subdirs; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.skill_exec_configs.writable_subdirs IS '需 rw 的相对子目录（如 [".report_state"]）；宿主侧固定 $SKILL_STATE_BASE/<skill_id>/<sub>，跨物化版本持久';


--
-- Name: COLUMN skill_exec_configs.needs_network; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.skill_exec_configs.needs_network IS '容器是否放通出网：false=--network none（默认）；true=可出网。语义边界：本开关只管「要不要出网」，与「出网干什么」无关——平台不再猜用途（旧 needs_llm 曾兼管注入 OPENAI_* 凭据，已随 040 删除）。出网目标的凭据由用户 per-skill env 提供（skill_user_envs），平台不代持。';


--
-- Name: skill_exec_configs_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.skill_exec_configs_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: skill_exec_configs_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.skill_exec_configs_id_seq OWNED BY public.skill_exec_configs.id;


--
-- Name: skill_runs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.skill_runs (
    id bigint NOT NULL,
    skill_id integer,
    skill_name character varying(200),
    app_id integer,
    user_id integer,
    tenant_id integer,
    chat_session_detail_id bigint,
    started_at timestamp without time zone DEFAULT now() NOT NULL,
    finished_at timestamp without time zone,
    duration_ms integer,
    status character varying(20) NOT NULL,
    error_detail text,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    kind character varying(10) DEFAULT 'execute'::character varying NOT NULL
);


--
-- Name: TABLE skill_runs; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.skill_runs IS 'Skill 沙箱执行记录。积分按次计费的唯一依据 —— execute_skill 没有 tools 行，
     不会进 tool_executions。';


--
-- Name: COLUMN skill_runs.skill_name; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.skill_runs.skill_name IS '冗余一份名字：skill 可能被删或改名，而账单要能解释「当时跑的是什么」。
     只存 skill_id 的话，删掉 skill 之后历史账单就成了一串无意义的数字。';


--
-- Name: COLUMN skill_runs.tenant_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.skill_runs.tenant_id IS '落库时从 user 推导后冗余，与 chat_session_detail.tenant_id 同口径（迁移 061）';


--
-- Name: COLUMN skill_runs.chat_session_detail_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.skill_runs.chat_session_detail_id IS '产生这次运行的对话轮次。NULL = 不属于任何轮次（API 直调等），不是漏记';


--
-- Name: COLUMN skill_runs.status; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.skill_runs.status IS 'success / failed / timeout。**失败不计费**（§4.2），所以这一列是计费过滤条件';


--
-- Name: skill_runs_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.skill_runs_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: skill_runs_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.skill_runs_id_seq OWNED BY public.skill_runs.id;


--
-- Name: skill_user_envs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.skill_user_envs (
    id integer NOT NULL,
    skill_id integer NOT NULL,
    user_id integer NOT NULL,
    env jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp without time zone DEFAULT now(),
    updated_at timestamp without time zone DEFAULT now()
);


--
-- Name: TABLE skill_user_envs; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.skill_user_envs IS 'skill 的 per-user 环境变量（041）：一个用户对一个 skill 一份 env，不审核、不加密、仅属主可读值；每次 execute_skill 以 -e 注入，绝不烧进预热池容器';


--
-- Name: COLUMN skill_user_envs.env; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.skill_user_envs.env IS '{KEY: value} 明文。键名 schema 来自该 skill 的 .env.example / .env.template 资产（占位符文件；真 .env 永不导入）；SKILL_* 前缀为平台保留名，应用层拒绝写入';


--
-- Name: skill_user_envs_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.skill_user_envs_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: skill_user_envs_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.skill_user_envs_id_seq OWNED BY public.skill_user_envs.id;


--
-- Name: skills; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.skills (
    id integer NOT NULL,
    name character varying(100) NOT NULL,
    display_name character varying(200),
    description text NOT NULL,
    content text NOT NULL,
    published_content text,
    requires jsonb,
    is_active boolean DEFAULT true NOT NULL,
    user_id integer,
    visibility character varying(20) DEFAULT 'tenant'::character varying NOT NULL,
    owner_dept_id integer,
    owner_tenant_id integer,
    created_at timestamp without time zone DEFAULT now(),
    updated_at timestamp without time zone DEFAULT now(),
    status character varying(20) DEFAULT 'draft'::character varying NOT NULL,
    reviewed_by integer,
    reviewed_at timestamp without time zone,
    is_managed boolean DEFAULT false NOT NULL,
    CONSTRAINT skills_status_check CHECK (((status)::text = ANY ((ARRAY['draft'::character varying, 'pending_review'::character varying, 'rejected'::character varying, 'published'::character varying])::text[]))),
    CONSTRAINT skills_visibility_check CHECK (((visibility)::text = ANY ((ARRAY['private'::character varying, 'dept'::character varying, 'tenant'::character varying, 'public'::character varying])::text[])))
);


--
-- Name: TABLE skills; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.skills IS 'Skill：可复用的提示词契约（SKILL.md），全 DB 真源 + UI 编辑';


--
-- Name: COLUMN skills.content; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.skills.content IS 'SKILL.md 正文草稿（编辑写这里）';


--
-- Name: COLUMN skills.published_content; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.skills.published_content IS '已发布正文；运行时注入只读本列，NULL=从未发布不注入';


--
-- Name: COLUMN skills.requires; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.skills.requires IS '可见性门控 {"tools":[...],"workflows":[...]}：应用缺依赖时该 skill 不注入；不授予任何权限';


--
-- Name: COLUMN skills.status; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.skills.status IS '审核状态：draft/pending_review/rejected/published；只管审核生命周期，启停看 is_active，注入只读 published_content';


--
-- Name: COLUMN skills.reviewed_by; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.skills.reviewed_by IS '最近一次审核动作（approve/reject/self_publish）的操作人';


--
-- Name: COLUMN skills.reviewed_at; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.skills.reviewed_at IS '最近一次审核动作时间';


--
-- Name: COLUMN skills.is_managed; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.skills.is_managed IS '平台维护的内置 skill：真源在代码仓 builtin_skills/，随镜像同步。TRUE 时禁止一切写操作（改动会被下次同步静默覆盖；删除会让部署少一个平台能力），但不限制绑定到应用。只有 scripts/sync_builtin_skills.py 能设置，API 入参不暴露';


--
-- Name: skills_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.skills_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: skills_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.skills_id_seq OWNED BY public.skills.id;


--
-- Name: sop_category; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.sop_category (
    id integer NOT NULL,
    name text NOT NULL
);


--
-- Name: sop_category_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.sop_category_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: sop_category_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.sop_category_id_seq OWNED BY public.sop_category.id;


--
-- Name: sop_detail; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.sop_detail (
    id integer NOT NULL,
    subcategory_id integer NOT NULL,
    step_number text NOT NULL,
    image_url text,
    content text NOT NULL,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL,
    vector_status text DEFAULT 'pending'::text NOT NULL,
    embedding double precision[]
);


--
-- Name: sop_detail_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.sop_detail_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: sop_detail_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.sop_detail_id_seq OWNED BY public.sop_detail.id;


--
-- Name: sop_subcategory; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.sop_subcategory (
    id integer NOT NULL,
    category_id integer,
    name text NOT NULL,
    vector_status text DEFAULT 'pending'::text NOT NULL,
    embedding_model text DEFAULT 'bge'::text,
    type character varying(20) DEFAULT 'process'::character varying NOT NULL,
    CONSTRAINT check_sop_subcategory_type CHECK (((type)::text = ANY ((ARRAY['process'::character varying, 'iso'::character varying])::text[])))
);


--
-- Name: sop_subcategory_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.sop_subcategory_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: sop_subcategory_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.sop_subcategory_id_seq OWNED BY public.sop_subcategory.id;


--
-- Name: system_logs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.system_logs (
    id integer NOT NULL,
    action text NOT NULL,
    details text,
    user_id integer,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: system_logs_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.system_logs_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: system_logs_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.system_logs_id_seq OWNED BY public.system_logs.id;


--
-- Name: system_settings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.system_settings (
    id integer NOT NULL,
    llm_model text,
    updated_at timestamp without time zone DEFAULT now() NOT NULL,
    platform_name character varying,
    platform_logo character varying,
    platform_subtitle character varying,
    smtp_config jsonb,
    login_left_panel_html text,
    theme_primary_color character varying(20),
    theme_gray_scale character varying(20),
    theme_mode character varying(20) DEFAULT 'light'::character varying,
    theme_secondary_color character varying(20)
);


--
-- Name: system_settings_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.system_settings_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: system_settings_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.system_settings_id_seq OWNED BY public.system_settings.id;


--
-- Name: task_datasets; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.task_datasets (
    task_id character varying(255) NOT NULL,
    dataset_id character varying(255) NOT NULL,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: TABLE task_datasets; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.task_datasets IS '任务-数据集关联表，记录任务与数据集的多对多关系';


--
-- Name: COLUMN task_datasets.task_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.task_datasets.task_id IS '任务ID，外键关联 tasks.id';


--
-- Name: COLUMN task_datasets.dataset_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.task_datasets.dataset_id IS '数据集ID，外键关联 datasets.id';


--
-- Name: tasks; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.tasks (
    id character varying(255) NOT NULL,
    type character varying(50) NOT NULL,
    status character varying(20) DEFAULT 'pending'::character varying NOT NULL,
    error_detail text,
    result jsonb,
    progress integer DEFAULT 0,
    duration integer,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    started_at timestamp with time zone,
    completed_at timestamp with time zone
);


--
-- Name: TABLE tasks; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.tasks IS '异步任务表，用于管理耗时任务（知识图谱构建、文件分块、文件上传等）';


--
-- Name: COLUMN tasks.id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.tasks.id IS '任务唯一标识符 (UUID)';


--
-- Name: COLUMN tasks.type; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.tasks.type IS '任务类型：graph-知识图谱构建, chunk-文件分块, upload-文件上传';


--
-- Name: COLUMN tasks.status; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.tasks.status IS '任务状态：pending-待处理, processing-处理中, done-完成, warning-部分失败, failed-失败';


--
-- Name: COLUMN tasks.error_detail; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.tasks.error_detail IS '任务失败或警告时的错误详情';


--
-- Name: COLUMN tasks.result; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.tasks.result IS '任务执行结果，JSON格式存储';


--
-- Name: COLUMN tasks.progress; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.tasks.progress IS '任务进度百分比 (0-100)';


--
-- Name: COLUMN tasks.duration; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.tasks.duration IS '任务执行耗时（秒）';


--
-- Name: task_statistics; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.task_statistics AS
 SELECT type,
    status,
    count(*) AS task_count,
    avg(duration) AS avg_duration,
    max(duration) AS max_duration,
    min(duration) AS min_duration
   FROM public.tasks
  WHERE (completed_at IS NOT NULL)
  GROUP BY type, status;


--
-- Name: VIEW task_statistics; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON VIEW public.task_statistics IS '任务统计视图，按类型和状态汇总任务数量和耗时';


--
-- Name: tenant; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.tenant (
    id integer NOT NULL,
    name character varying(255) NOT NULL,
    code character varying(100) NOT NULL,
    status character varying(20) DEFAULT 'active'::character varying,
    max_users integer DEFAULT 100,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: tenant_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.tenant_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: tenant_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.tenant_id_seq OWNED BY public.tenant.id;


--
-- Name: tool_executions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.tool_executions (
    id bigint NOT NULL,
    tool_id integer NOT NULL,
    app_id integer,
    user_id integer,
    status character varying(20) NOT NULL,
    input_args json,
    output_summary text,
    error_type character varying(100),
    error_detail text,
    error_stack_trace text,
    execution_time_ms integer,
    created_at timestamp without time zone,
    chat_session_detail_id bigint
);


--
-- Name: TABLE tool_executions; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.tool_executions IS '工具执行记录表';


--
-- Name: COLUMN tool_executions.status; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.tool_executions.status IS '执行状态：success, failed';


--
-- Name: COLUMN tool_executions.input_args; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.tool_executions.input_args IS '输入参数（JSONB）';


--
-- Name: COLUMN tool_executions.output_summary; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.tool_executions.output_summary IS '输出摘要（仅成功时记录）';


--
-- Name: COLUMN tool_executions.error_detail; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.tool_executions.error_detail IS '错误详情（仅失败时记录）';


--
-- Name: COLUMN tool_executions.chat_session_detail_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.tool_executions.chat_session_detail_id IS '产生这次调用的对话轮次（chat_session_detail.id）。NULL = 不属于任何轮次
     （企微/定时任务/API 直调），不是漏记。计费按轮次结算时靠这一列归集。';


--
-- Name: tool_executions_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.tool_executions_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: tool_executions_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.tool_executions_id_seq OWNED BY public.tool_executions.id;


--
-- Name: tool_statistics; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.tool_statistics (
    id integer NOT NULL,
    tool_id integer NOT NULL,
    app_id integer,
    stat_date timestamp without time zone NOT NULL,
    total_calls integer NOT NULL,
    success_calls integer NOT NULL,
    failed_calls integer NOT NULL,
    avg_execution_time_ms integer,
    min_execution_time_ms integer,
    max_execution_time_ms integer,
    created_at timestamp without time zone,
    updated_at timestamp without time zone
);


--
-- Name: TABLE tool_statistics; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.tool_statistics IS '工具统计汇总表';


--
-- Name: COLUMN tool_statistics.app_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.tool_statistics.app_id IS '应用ID（NULL表示全局统计）';


--
-- Name: COLUMN tool_statistics.stat_date; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.tool_statistics.stat_date IS '统计日期';


--
-- Name: tool_statistics_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.tool_statistics_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: tool_statistics_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.tool_statistics_id_seq OWNED BY public.tool_statistics.id;


--
-- Name: tools; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.tools (
    id integer NOT NULL,
    name character varying(100) NOT NULL,
    display_name character varying(200) NOT NULL,
    description text,
    tool_type character varying(50) NOT NULL,
    category character varying(50),
    icon character varying(200),
    default_config json,
    is_enabled boolean NOT NULL,
    is_system boolean NOT NULL,
    version character varying(50),
    author character varying(100),
    documentation_url text,
    created_at timestamp without time zone,
    updated_at timestamp without time zone
);


--
-- Name: TABLE tools; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.tools IS 'Agent 工具表';


--
-- Name: COLUMN tools.name; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.tools.name IS '工具唯一标识';


--
-- Name: COLUMN tools.display_name; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.tools.display_name IS '工具展示名称';


--
-- Name: COLUMN tools.tool_type; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.tools.tool_type IS '工具类型：native（原生）, mcp（MCP工具）';


--
-- Name: COLUMN tools.default_config; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.tools.default_config IS '工具默认配置（JSONB）';


--
-- Name: COLUMN tools.is_enabled; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.tools.is_enabled IS '是否启用（管理员可停用）';


--
-- Name: tools_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.tools_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: tools_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.tools_id_seq OWNED BY public.tools.id;


--
-- Name: user_preferences; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_preferences (
    id integer NOT NULL,
    user_id integer NOT NULL,
    llm_model character varying(255),
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: user_preferences_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.user_preferences_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: user_preferences_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.user_preferences_id_seq OWNED BY public.user_preferences.id;


--
-- Name: user_roles; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_roles (
    id integer NOT NULL,
    user_id integer,
    role_id integer,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: user_roles_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.user_roles_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: user_roles_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.user_roles_id_seq OWNED BY public.user_roles.id;


--
-- Name: users; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.users (
    id integer NOT NULL,
    username character varying(64) NOT NULL,
    nickname character varying(64),
    password character varying(128) NOT NULL,
    email character varying(128) NOT NULL,
    tenant_id integer,
    dept_id integer,
    status character varying(20) DEFAULT 'active'::character varying,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    wechat_id character varying(255) DEFAULT ''::character varying,
    api_key character varying(255)
);


--
-- Name: COLUMN users.api_key; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.users.api_key IS 'API密钥，用于访问只需要api_key的接口（如chat等）';


--
-- Name: users_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.users_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: users_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.users_id_seq OWNED BY public.users.id;


--
-- Name: workflow_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.workflow_events (
    id bigint NOT NULL,
    run_id bigint NOT NULL,
    seq bigint NOT NULL,
    ts timestamp with time zone DEFAULT now() NOT NULL,
    event_type character varying(40) NOT NULL,
    payload jsonb DEFAULT '{}'::jsonb NOT NULL
);


--
-- Name: TABLE workflow_events; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.workflow_events IS 'append-only 工作流事件流；30 天保留策略由独立 cron 处理';


--
-- Name: COLUMN workflow_events.seq; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.workflow_events.seq IS '同一 run 内单调递增；append_event 用 pg_advisory_xact_lock(run_id) 保证';


--
-- Name: COLUMN workflow_events.event_type; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.workflow_events.event_type IS 'run.queued / run.started / node.started / node.progress / node.succeeded / node.failed / run.succeeded / run.failed / run.cancelled / interrupt / text.chunk';


--
-- Name: workflow_events_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.workflow_events_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: workflow_events_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.workflow_events_id_seq OWNED BY public.workflow_events.id;


--
-- Name: workflow_node_executions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.workflow_node_executions (
    id bigint NOT NULL,
    run_id bigint NOT NULL,
    node_name character varying(80) NOT NULL,
    node_index integer NOT NULL,
    status character varying(20) DEFAULT 'running'::character varying NOT NULL,
    inputs jsonb DEFAULT '{}'::jsonb NOT NULL,
    outputs jsonb DEFAULT '{}'::jsonb NOT NULL,
    error jsonb DEFAULT '{}'::jsonb NOT NULL,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    started_at timestamp with time zone DEFAULT now() NOT NULL,
    completed_at timestamp with time zone,
    elapsed_ms integer,
    CONSTRAINT workflow_node_executions_status_check CHECK (((status)::text = ANY ((ARRAY['queued'::character varying, 'running'::character varying, 'succeeded'::character varying, 'failed'::character varying, 'cancelled'::character varying, 'skipped'::character varying])::text[])))
);


--
-- Name: TABLE workflow_node_executions; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.workflow_node_executions IS '工作流每节点的执行记录';


--
-- Name: COLUMN workflow_node_executions.metadata; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.workflow_node_executions.metadata IS '自由字段：tokens / cost / polygon_count / bytes 等';


--
-- Name: workflow_node_executions_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.workflow_node_executions_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: workflow_node_executions_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.workflow_node_executions_id_seq OWNED BY public.workflow_node_executions.id;


--
-- Name: workflow_runs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.workflow_runs (
    id bigint NOT NULL,
    tenant_id character varying(64),
    user_id integer,
    app_id integer,
    conversation_id integer,
    triggering_message_id integer,
    kind character varying(64) NOT NULL,
    status character varying(20) DEFAULT 'queued'::character varying NOT NULL,
    inputs jsonb DEFAULT '{}'::jsonb NOT NULL,
    outputs jsonb DEFAULT '{}'::jsonb NOT NULL,
    error jsonb DEFAULT '{}'::jsonb NOT NULL,
    graph jsonb DEFAULT '{}'::jsonb NOT NULL,
    worker_id character varying(64),
    attempts integer DEFAULT 0 NOT NULL,
    next_retry_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    started_at timestamp with time zone,
    completed_at timestamp with time zone,
    heartbeat_at timestamp with time zone,
    CONSTRAINT workflow_runs_status_check CHECK (((status)::text = ANY ((ARRAY['queued'::character varying, 'running'::character varying, 'succeeded'::character varying, 'failed'::character varying, 'cancelled'::character varying, 'interrupted'::character varying])::text[])))
);


--
-- Name: TABLE workflow_runs; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.workflow_runs IS '长任务实例表：每条 row = 一次工作流执行';


--
-- Name: COLUMN workflow_runs.kind; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.workflow_runs.kind IS '点分多级 kind，如 cad.annotate_copper / research.insurance';


--
-- Name: COLUMN workflow_runs.status; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.workflow_runs.status IS 'queued / running / succeeded / failed / cancelled / interrupted';


--
-- Name: COLUMN workflow_runs.graph; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.workflow_runs.graph IS '运行时不可变快照（Dify 范式），保证图迭代后仍可解释历史 run';


--
-- Name: COLUMN workflow_runs.worker_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.workflow_runs.worker_id IS '抢占该 run 的 dispatcher worker_id（hostname-pid-uuid）';


--
-- Name: COLUMN workflow_runs.heartbeat_at; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.workflow_runs.heartbeat_at IS 'runner 心跳时间，janitor 据此识别孤儿';


--
-- Name: workflow_runs_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.workflow_runs_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: workflow_runs_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.workflow_runs_id_seq OWNED BY public.workflow_runs.id;


--
-- Name: app_skills id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_skills ALTER COLUMN id SET DEFAULT nextval('public.app_skills_id_seq'::regclass);


--
-- Name: app_tools id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_tools ALTER COLUMN id SET DEFAULT nextval('public.app_tools_id_seq'::regclass);


--
-- Name: apps id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.apps ALTER COLUMN id SET DEFAULT nextval('public.apps_id_seq'::regclass);


--
-- Name: billing_rate_audit id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.billing_rate_audit ALTER COLUMN id SET DEFAULT nextval('public.billing_rate_audit_id_seq'::regclass);


--
-- Name: billing_rates id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.billing_rates ALTER COLUMN id SET DEFAULT nextval('public.billing_rates_id_seq'::regclass);


--
-- Name: chat_session id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.chat_session ALTER COLUMN id SET DEFAULT nextval('public.chat_session_id_seq'::regclass);


--
-- Name: chat_session_detail id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.chat_session_detail ALTER COLUMN id SET DEFAULT nextval('public.chat_session_detail_id_seq'::regclass);


--
-- Name: credit_transactions id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.credit_transactions ALTER COLUMN id SET DEFAULT nextval('public.credit_transactions_id_seq'::regclass);


--
-- Name: dept id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.dept ALTER COLUMN id SET DEFAULT nextval('public.dept_id_seq'::regclass);


--
-- Name: knowledge_category id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.knowledge_category ALTER COLUMN id SET DEFAULT nextval('public.knowledge_category_id_seq'::regclass);


--
-- Name: knowledge_file_contents id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.knowledge_file_contents ALTER COLUMN id SET DEFAULT nextval('public.knowledge_file_contents_id_seq'::regclass);


--
-- Name: knowledge_file_tags id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.knowledge_file_tags ALTER COLUMN id SET DEFAULT nextval('public.knowledge_file_tags_id_seq'::regclass);


--
-- Name: knowledge_files id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.knowledge_files ALTER COLUMN id SET DEFAULT nextval('public.knowledge_files_id_seq'::regclass);


--
-- Name: knowledge_segments id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.knowledge_segments ALTER COLUMN id SET DEFAULT nextval('public.knowledge_segments_id_seq'::regclass);


--
-- Name: knowledge_tags id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.knowledge_tags ALTER COLUMN id SET DEFAULT nextval('public.knowledge_tags_id_seq'::regclass);


--
-- Name: password_reset_tokens id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.password_reset_tokens ALTER COLUMN id SET DEFAULT nextval('public.password_reset_tokens_id_seq'::regclass);


--
-- Name: products id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.products ALTER COLUMN id SET DEFAULT nextval('public.products_id_seq'::regclass);


--
-- Name: review_log id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.review_log ALTER COLUMN id SET DEFAULT nextval('public.review_log_id_seq'::regclass);


--
-- Name: role_permissions id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.role_permissions ALTER COLUMN id SET DEFAULT nextval('public.role_permissions_id_seq'::regclass);


--
-- Name: roles id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.roles ALTER COLUMN id SET DEFAULT nextval('public.roles_id_seq'::regclass);


--
-- Name: sandbox_images id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sandbox_images ALTER COLUMN id SET DEFAULT nextval('public.sandbox_images_id_seq'::regclass);


--
-- Name: skill_assets id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.skill_assets ALTER COLUMN id SET DEFAULT nextval('public.skill_assets_id_seq'::regclass);


--
-- Name: skill_exec_configs id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.skill_exec_configs ALTER COLUMN id SET DEFAULT nextval('public.skill_exec_configs_id_seq'::regclass);


--
-- Name: skill_runs id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.skill_runs ALTER COLUMN id SET DEFAULT nextval('public.skill_runs_id_seq'::regclass);


--
-- Name: skill_user_envs id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.skill_user_envs ALTER COLUMN id SET DEFAULT nextval('public.skill_user_envs_id_seq'::regclass);


--
-- Name: skills id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.skills ALTER COLUMN id SET DEFAULT nextval('public.skills_id_seq'::regclass);


--
-- Name: sop_category id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sop_category ALTER COLUMN id SET DEFAULT nextval('public.sop_category_id_seq'::regclass);


--
-- Name: sop_detail id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sop_detail ALTER COLUMN id SET DEFAULT nextval('public.sop_detail_id_seq'::regclass);


--
-- Name: sop_subcategory id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sop_subcategory ALTER COLUMN id SET DEFAULT nextval('public.sop_subcategory_id_seq'::regclass);


--
-- Name: system_logs id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.system_logs ALTER COLUMN id SET DEFAULT nextval('public.system_logs_id_seq'::regclass);


--
-- Name: system_settings id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.system_settings ALTER COLUMN id SET DEFAULT nextval('public.system_settings_id_seq'::regclass);


--
-- Name: tenant id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tenant ALTER COLUMN id SET DEFAULT nextval('public.tenant_id_seq'::regclass);


--
-- Name: tool_executions id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tool_executions ALTER COLUMN id SET DEFAULT nextval('public.tool_executions_id_seq'::regclass);


--
-- Name: tool_statistics id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tool_statistics ALTER COLUMN id SET DEFAULT nextval('public.tool_statistics_id_seq'::regclass);


--
-- Name: tools id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tools ALTER COLUMN id SET DEFAULT nextval('public.tools_id_seq'::regclass);


--
-- Name: user_preferences id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_preferences ALTER COLUMN id SET DEFAULT nextval('public.user_preferences_id_seq'::regclass);


--
-- Name: user_roles id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_roles ALTER COLUMN id SET DEFAULT nextval('public.user_roles_id_seq'::regclass);


--
-- Name: users id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users ALTER COLUMN id SET DEFAULT nextval('public.users_id_seq'::regclass);


--
-- Name: workflow_events id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workflow_events ALTER COLUMN id SET DEFAULT nextval('public.workflow_events_id_seq'::regclass);


--
-- Name: workflow_node_executions id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workflow_node_executions ALTER COLUMN id SET DEFAULT nextval('public.workflow_node_executions_id_seq'::regclass);


--
-- Name: workflow_runs id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workflow_runs ALTER COLUMN id SET DEFAULT nextval('public.workflow_runs_id_seq'::regclass);


--
-- Name: app_skills app_skills_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_skills
    ADD CONSTRAINT app_skills_pkey PRIMARY KEY (id);


--
-- Name: app_tools app_tools_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_tools
    ADD CONSTRAINT app_tools_pkey PRIMARY KEY (id);


--
-- Name: apps apps_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.apps
    ADD CONSTRAINT apps_pkey PRIMARY KEY (id);


--
-- Name: billing_rate_audit billing_rate_audit_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.billing_rate_audit
    ADD CONSTRAINT billing_rate_audit_pkey PRIMARY KEY (id);


--
-- Name: billing_rates billing_rates_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.billing_rates
    ADD CONSTRAINT billing_rates_pkey PRIMARY KEY (id);


--
-- Name: credit_accounts credit_accounts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.credit_accounts
    ADD CONSTRAINT credit_accounts_pkey PRIMARY KEY (tenant_id);


--
-- Name: credit_transactions credit_transactions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.credit_transactions
    ADD CONSTRAINT credit_transactions_pkey PRIMARY KEY (id);


--
-- Name: datasets datasets_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.datasets
    ADD CONSTRAINT datasets_pkey PRIMARY KEY (id);


--
-- Name: dept dept_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.dept
    ADD CONSTRAINT dept_pkey PRIMARY KEY (id);


--
-- Name: app_skills idx_app_skill_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_skills
    ADD CONSTRAINT idx_app_skill_unique UNIQUE (app_id, skill_id);


--
-- Name: knowledge_category knowledge_category_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.knowledge_category
    ADD CONSTRAINT knowledge_category_pkey PRIMARY KEY (id);


--
-- Name: knowledge_file_contents knowledge_file_contents_file_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.knowledge_file_contents
    ADD CONSTRAINT knowledge_file_contents_file_id_key UNIQUE (file_id);


--
-- Name: knowledge_file_contents knowledge_file_contents_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.knowledge_file_contents
    ADD CONSTRAINT knowledge_file_contents_pkey PRIMARY KEY (id);


--
-- Name: knowledge_file_tags knowledge_file_tags_file_id_tag_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.knowledge_file_tags
    ADD CONSTRAINT knowledge_file_tags_file_id_tag_id_key UNIQUE (file_id, tag_id);


--
-- Name: knowledge_file_tags knowledge_file_tags_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.knowledge_file_tags
    ADD CONSTRAINT knowledge_file_tags_pkey PRIMARY KEY (id);


--
-- Name: knowledge_files knowledge_files_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.knowledge_files
    ADD CONSTRAINT knowledge_files_pkey PRIMARY KEY (id);


--
-- Name: knowledge_segments knowledge_segments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.knowledge_segments
    ADD CONSTRAINT knowledge_segments_pkey PRIMARY KEY (id);


--
-- Name: knowledge_tags knowledge_tags_name_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.knowledge_tags
    ADD CONSTRAINT knowledge_tags_name_key UNIQUE (name);


--
-- Name: knowledge_tags knowledge_tags_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.knowledge_tags
    ADD CONSTRAINT knowledge_tags_pkey PRIMARY KEY (id);


--
-- Name: password_reset_tokens password_reset_tokens_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.password_reset_tokens
    ADD CONSTRAINT password_reset_tokens_pkey PRIMARY KEY (id);


--
-- Name: password_reset_tokens password_reset_tokens_token_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.password_reset_tokens
    ADD CONSTRAINT password_reset_tokens_token_key UNIQUE (token);


--
-- Name: products products_sn_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.products
    ADD CONSTRAINT products_sn_unique UNIQUE (sn);


--
-- Name: review_log review_log_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.review_log
    ADD CONSTRAINT review_log_pkey PRIMARY KEY (id);


--
-- Name: role_permissions role_permissions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.role_permissions
    ADD CONSTRAINT role_permissions_pkey PRIMARY KEY (id);


--
-- Name: roles roles_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.roles
    ADD CONSTRAINT roles_pkey PRIMARY KEY (id);


--
-- Name: sandbox_images sandbox_images_name_tag_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sandbox_images
    ADD CONSTRAINT sandbox_images_name_tag_key UNIQUE (name, tag);


--
-- Name: sandbox_images sandbox_images_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sandbox_images
    ADD CONSTRAINT sandbox_images_pkey PRIMARY KEY (id);


--
-- Name: skill_assets skill_assets_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.skill_assets
    ADD CONSTRAINT skill_assets_pkey PRIMARY KEY (id);


--
-- Name: skill_assets skill_assets_skill_id_stage_path_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.skill_assets
    ADD CONSTRAINT skill_assets_skill_id_stage_path_key UNIQUE (skill_id, stage, path);


--
-- Name: skill_exec_configs skill_exec_configs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.skill_exec_configs
    ADD CONSTRAINT skill_exec_configs_pkey PRIMARY KEY (id);


--
-- Name: skill_exec_configs skill_exec_configs_skill_id_stage_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.skill_exec_configs
    ADD CONSTRAINT skill_exec_configs_skill_id_stage_key UNIQUE (skill_id, stage);


--
-- Name: skill_runs skill_runs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.skill_runs
    ADD CONSTRAINT skill_runs_pkey PRIMARY KEY (id);


--
-- Name: skill_user_envs skill_user_envs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.skill_user_envs
    ADD CONSTRAINT skill_user_envs_pkey PRIMARY KEY (id);


--
-- Name: skill_user_envs skill_user_envs_skill_id_user_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.skill_user_envs
    ADD CONSTRAINT skill_user_envs_skill_id_user_id_key UNIQUE (skill_id, user_id);


--
-- Name: skills skills_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.skills
    ADD CONSTRAINT skills_pkey PRIMARY KEY (id);


--
-- Name: sop_category sop_category_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sop_category
    ADD CONSTRAINT sop_category_pkey PRIMARY KEY (id);


--
-- Name: sop_detail sop_detail_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sop_detail
    ADD CONSTRAINT sop_detail_pkey PRIMARY KEY (id);


--
-- Name: sop_subcategory sop_subcategory_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sop_subcategory
    ADD CONSTRAINT sop_subcategory_pkey PRIMARY KEY (id);


--
-- Name: system_logs system_logs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.system_logs
    ADD CONSTRAINT system_logs_pkey PRIMARY KEY (id);


--
-- Name: task_datasets task_datasets_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.task_datasets
    ADD CONSTRAINT task_datasets_pkey PRIMARY KEY (task_id, dataset_id);


--
-- Name: tasks tasks_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tasks
    ADD CONSTRAINT tasks_pkey PRIMARY KEY (id);


--
-- Name: tenant tenant_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tenant
    ADD CONSTRAINT tenant_pkey PRIMARY KEY (id);


--
-- Name: tool_executions tool_executions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tool_executions
    ADD CONSTRAINT tool_executions_pkey PRIMARY KEY (id);


--
-- Name: tool_statistics tool_statistics_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tool_statistics
    ADD CONSTRAINT tool_statistics_pkey PRIMARY KEY (id);


--
-- Name: tools tools_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tools
    ADD CONSTRAINT tools_pkey PRIMARY KEY (id);


--
-- Name: dept uk_dept_tenant_code; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.dept
    ADD CONSTRAINT uk_dept_tenant_code UNIQUE (tenant_id, code);


--
-- Name: role_permissions uk_role_permissions_unique_new; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.role_permissions
    ADD CONSTRAINT uk_role_permissions_unique_new UNIQUE (role_id, resource_type, permission);


--
-- Name: roles uk_roles_tenant_name; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.roles
    ADD CONSTRAINT uk_roles_tenant_name UNIQUE (tenant_id, name);


--
-- Name: tenant uk_tenant_code; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tenant
    ADD CONSTRAINT uk_tenant_code UNIQUE (code);


--
-- Name: user_roles uk_user_roles_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_roles
    ADD CONSTRAINT uk_user_roles_unique UNIQUE (user_id, role_id);


--
-- Name: billing_rates uq_billing_rate; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.billing_rates
    ADD CONSTRAINT uq_billing_rate UNIQUE (rate_type, ref_key);


--
-- Name: user_preferences user_preferences_user_id_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_preferences
    ADD CONSTRAINT user_preferences_user_id_unique UNIQUE (user_id);


--
-- Name: user_roles user_roles_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_roles
    ADD CONSTRAINT user_roles_pkey PRIMARY KEY (id);


--
-- Name: users users_api_key_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_api_key_key UNIQUE (api_key);


--
-- Name: users users_email_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_email_unique UNIQUE (email);


--
-- Name: users users_id_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_id_unique UNIQUE (id);


--
-- Name: users users_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_pkey PRIMARY KEY (id);


--
-- Name: users users_username_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_username_unique UNIQUE (username);


--
-- Name: workflow_events workflow_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workflow_events
    ADD CONSTRAINT workflow_events_pkey PRIMARY KEY (id);


--
-- Name: workflow_node_executions workflow_node_executions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workflow_node_executions
    ADD CONSTRAINT workflow_node_executions_pkey PRIMARY KEY (id);


--
-- Name: workflow_runs workflow_runs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workflow_runs
    ADD CONSTRAINT workflow_runs_pkey PRIMARY KEY (id);


--
-- Name: idx_app_skills_app; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_app_skills_app ON public.app_skills USING btree (app_id);


--
-- Name: idx_app_tool_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_app_tool_unique ON public.app_tools USING btree (app_id, tool_id);


--
-- Name: idx_app_tools_app_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_app_tools_app_id ON public.app_tools USING btree (app_id);


--
-- Name: idx_app_tools_tool_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_app_tools_tool_id ON public.app_tools USING btree (tool_id);


--
-- Name: idx_apps_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_apps_status ON public.apps USING btree (status);


--
-- Name: idx_chat_session_detail_workflow_run; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_chat_session_detail_workflow_run ON public.chat_session_detail USING btree (workflow_run_id) WHERE (workflow_run_id IS NOT NULL);


--
-- Name: idx_credit_accounts_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_credit_accounts_tenant ON public.credit_accounts USING btree (tenant_id);


--
-- Name: idx_credit_tx_tenant_time; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_credit_tx_tenant_time ON public.credit_transactions USING btree (tenant_id, created_at DESC);


--
-- Name: idx_credit_tx_type_time; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_credit_tx_type_time ON public.credit_transactions USING btree (tx_type, created_at DESC);


--
-- Name: idx_credit_tx_user_time; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_credit_tx_user_time ON public.credit_transactions USING btree (user_id, created_at DESC);


--
-- Name: idx_csd_session_tokens; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_csd_session_tokens ON public.chat_session_detail USING btree (session_id) WHERE (total_tokens IS NOT NULL);


--
-- Name: INDEX idx_csd_session_tokens; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON INDEX public.idx_csd_session_tokens IS '会话详情要按 session 汇总用量；部分索引只覆盖有用量的行，存量 NULL 行不进索引';


--
-- Name: idx_csd_tenant_time; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_csd_tenant_time ON public.chat_session_detail USING btree (tenant_id, submitted_at) WHERE (tenant_id IS NOT NULL);


--
-- Name: INDEX idx_csd_tenant_time; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON INDEX public.idx_csd_tenant_time IS '账单页主查询：某租户某时间段的消耗。部分索引跳过无租户归属的行';


--
-- Name: idx_datasets_embedding; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_datasets_embedding ON public.datasets USING ivfflat (embedding_vector public.vector_cosine_ops) WITH (lists='100');


--
-- Name: idx_datasets_owner_dept; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_datasets_owner_dept ON public.datasets USING btree (owner_dept_id);


--
-- Name: idx_datasets_owner_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_datasets_owner_tenant ON public.datasets USING btree (owner_tenant_id);


--
-- Name: idx_datasets_user_dept_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_datasets_user_dept_tenant ON public.datasets USING btree (user_id, owner_dept_id, owner_tenant_id);


--
-- Name: idx_datasets_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_datasets_user_id ON public.datasets USING btree (user_id);


--
-- Name: idx_datasets_visibility; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_datasets_visibility ON public.datasets USING btree (visibility);


--
-- Name: idx_dept_parent_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_dept_parent_id ON public.dept USING btree (parent_id);


--
-- Name: idx_dept_path; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_dept_path ON public.dept USING btree (path);


--
-- Name: idx_dept_tenant_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_dept_tenant_id ON public.dept USING btree (tenant_id);


--
-- Name: idx_embedding_aliyun; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_embedding_aliyun ON public.knowledge_segments USING hnsw (((embedding_vector)::public.vector(1536)) public.vector_l2_ops) WHERE ((embedding_model)::text = 'aliyun-text-embedding-v2'::text);


--
-- Name: INDEX idx_embedding_aliyun; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON INDEX public.idx_embedding_aliyun IS '阿里云 text-embedding-v2 模型的向量索引，用于加速向量相似度搜索';


--
-- Name: idx_embedding_aliyun_v4; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_embedding_aliyun_v4 ON public.knowledge_segments USING hnsw (((embedding_vector)::public.vector(1536)) public.vector_l2_ops) WHERE ((embedding_model)::text = 'aliyun-text-embedding-v4'::text);


--
-- Name: INDEX idx_embedding_aliyun_v4; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON INDEX public.idx_embedding_aliyun_v4 IS 'aliyun-text-embedding-v4 模型的 HNSW 向量索引，用于加速向量相似度检索';


--
-- Name: idx_embedding_e5; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_embedding_e5 ON public.knowledge_segments USING hnsw (((embedding_vector)::public.vector(1024)) public.vector_l2_ops) WHERE ((embedding_model)::text = 'e5-large'::text);


--
-- Name: idx_embedding_openai; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_embedding_openai ON public.knowledge_segments USING hnsw (((embedding_vector)::public.vector(1536)) public.vector_l2_ops) WHERE ((embedding_model)::text = 'openai-text-embedding-3-large'::text);


--
-- Name: INDEX idx_embedding_openai; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON INDEX public.idx_embedding_openai IS 'OpenAI text-embedding-3-large（降维至 1536）的 HNSW 向量索引；索引条件需与 get_embedding_model_for_storage() 保持一致';


--
-- Name: idx_embedding_qwen; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_embedding_qwen ON public.knowledge_segments USING hnsw (((embedding_vector)::public.vector(1536)) public.vector_l2_ops) WHERE ((embedding_model)::text = 'qwen'::text);


--
-- Name: idx_knowledge_file_contents_file_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_knowledge_file_contents_file_id ON public.knowledge_file_contents USING btree (file_id);


--
-- Name: idx_knowledge_file_contents_gin; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_knowledge_file_contents_gin ON public.knowledge_file_contents USING gin (content_data);


--
-- Name: idx_knowledge_file_contents_hash; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_knowledge_file_contents_hash ON public.knowledge_file_contents USING btree (content_hash);


--
-- Name: idx_knowledge_file_tags_file_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_knowledge_file_tags_file_id ON public.knowledge_file_tags USING btree (file_id);


--
-- Name: idx_knowledge_file_tags_tag_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_knowledge_file_tags_tag_id ON public.knowledge_file_tags USING btree (tag_id);


--
-- Name: idx_knowledge_files_dataset_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_knowledge_files_dataset_id ON public.knowledge_files USING btree (dataset_id);


--
-- Name: idx_knowledge_files_dataset_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_knowledge_files_dataset_user ON public.knowledge_files USING btree (dataset_id, user_id);


--
-- Name: idx_knowledge_files_object_key; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_knowledge_files_object_key ON public.knowledge_files USING btree (object_key);


--
-- Name: idx_knowledge_files_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_knowledge_files_status ON public.knowledge_files USING btree (status);


--
-- Name: idx_knowledge_files_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_knowledge_files_user_id ON public.knowledge_files USING btree (user_id);


--
-- Name: idx_password_reset_tokens_expires_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_password_reset_tokens_expires_at ON public.password_reset_tokens USING btree (expires_at);


--
-- Name: idx_password_reset_tokens_token; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_password_reset_tokens_token ON public.password_reset_tokens USING btree (token);


--
-- Name: idx_password_reset_tokens_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_password_reset_tokens_user_id ON public.password_reset_tokens USING btree (user_id);


--
-- Name: idx_products_embedding_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_products_embedding_status ON public.products USING btree (embedding_status);


--
-- Name: idx_rate_audit_ref; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_rate_audit_ref ON public.billing_rate_audit USING btree (rate_type, ref_key, changed_at DESC);


--
-- Name: idx_review_log_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_review_log_created ON public.review_log USING btree (created_at);


--
-- Name: idx_review_log_target; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_review_log_target ON public.review_log USING btree (target_type, target_id);


--
-- Name: idx_role_permissions_role_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_role_permissions_role_id ON public.role_permissions USING btree (role_id);


--
-- Name: idx_roles_tenant_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_roles_tenant_id ON public.roles USING btree (tenant_id);


--
-- Name: idx_segment_text_gin; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_segment_text_gin ON public.knowledge_segments USING gin (segment_text public.gin_trgm_ops);


--
-- Name: INDEX idx_segment_text_gin; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON INDEX public.idx_segment_text_gin IS 'segment_text 字段的 GIN 索引，用于加速混合检索中的文本搜索（ILIKE 模糊匹配）';


--
-- Name: idx_skill_assets_skill; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_skill_assets_skill ON public.skill_assets USING btree (skill_id, stage);


--
-- Name: idx_skill_runs_skill_time; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_skill_runs_skill_time ON public.skill_runs USING btree (skill_id, started_at);


--
-- Name: idx_skill_runs_tenant_time; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_skill_runs_tenant_time ON public.skill_runs USING btree (tenant_id, started_at) WHERE (tenant_id IS NOT NULL);


--
-- Name: idx_skill_runs_turn; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_skill_runs_turn ON public.skill_runs USING btree (chat_session_detail_id) WHERE (chat_session_detail_id IS NOT NULL);


--
-- Name: idx_skills_is_managed; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_skills_is_managed ON public.skills USING btree (is_managed) WHERE is_managed;


--
-- Name: idx_skills_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_skills_status ON public.skills USING btree (status);


--
-- Name: idx_skills_tenant_name; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_skills_tenant_name ON public.skills USING btree (COALESCE(owner_tenant_id, 0), name);


--
-- Name: idx_skills_visibility; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_skills_visibility ON public.skills USING btree (visibility);


--
-- Name: idx_sop_subcategory_type; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sop_subcategory_type ON public.sop_subcategory USING btree (type);


--
-- Name: idx_system_logs_action; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_system_logs_action ON public.system_logs USING btree (action);


--
-- Name: idx_system_logs_created_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_system_logs_created_at ON public.system_logs USING btree (created_at);


--
-- Name: idx_task_datasets_dataset_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_task_datasets_dataset_id ON public.task_datasets USING btree (dataset_id);


--
-- Name: idx_task_datasets_task_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_task_datasets_task_id ON public.task_datasets USING btree (task_id);


--
-- Name: idx_tasks_created_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_tasks_created_at ON public.tasks USING btree (created_at DESC);


--
-- Name: idx_tasks_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_tasks_status ON public.tasks USING btree (status);


--
-- Name: idx_tasks_type; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_tasks_type ON public.tasks USING btree (type);


--
-- Name: idx_tool_app_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_tool_app_created ON public.tool_executions USING btree (tool_id, app_id, created_at);


--
-- Name: idx_tool_app_date_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_tool_app_date_unique ON public.tool_statistics USING btree (tool_id, app_id, stat_date);


--
-- Name: idx_tool_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_tool_date ON public.tool_statistics USING btree (tool_id, stat_date);


--
-- Name: idx_tool_exec_turn; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_tool_exec_turn ON public.tool_executions USING btree (chat_session_detail_id) WHERE (chat_session_detail_id IS NOT NULL);


--
-- Name: INDEX idx_tool_exec_turn; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON INDEX public.idx_tool_exec_turn IS '按轮次归集工具调用；部分索引只覆盖属于轮次的行，存量 NULL 行不进索引';


--
-- Name: idx_tool_executions_app_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_tool_executions_app_id ON public.tool_executions USING btree (app_id);


--
-- Name: idx_tool_executions_composite; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_tool_executions_composite ON public.tool_executions USING btree (tool_id, app_id, created_at);


--
-- Name: idx_tool_executions_created_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_tool_executions_created_at ON public.tool_executions USING btree (created_at);


--
-- Name: idx_tool_executions_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_tool_executions_status ON public.tool_executions USING btree (status);


--
-- Name: idx_tool_executions_tool_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_tool_executions_tool_id ON public.tool_executions USING btree (tool_id);


--
-- Name: idx_tool_statistics_app_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_tool_statistics_app_id ON public.tool_statistics USING btree (app_id);


--
-- Name: idx_tool_statistics_composite; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_tool_statistics_composite ON public.tool_statistics USING btree (tool_id, stat_date);


--
-- Name: idx_tool_statistics_stat_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_tool_statistics_stat_date ON public.tool_statistics USING btree (stat_date);


--
-- Name: idx_tool_statistics_tool_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_tool_statistics_tool_id ON public.tool_statistics USING btree (tool_id);


--
-- Name: idx_tools_category; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_tools_category ON public.tools USING btree (category);


--
-- Name: idx_tools_is_enabled; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_tools_is_enabled ON public.tools USING btree (is_enabled);


--
-- Name: idx_tools_name; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_tools_name ON public.tools USING btree (name);


--
-- Name: idx_tools_tool_type; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_tools_tool_type ON public.tools USING btree (tool_type);


--
-- Name: idx_user_roles_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_user_roles_user_id ON public.user_roles USING btree (user_id);


--
-- Name: idx_users_api_key; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_users_api_key ON public.users USING btree (api_key);


--
-- Name: idx_users_dept_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_users_dept_id ON public.users USING btree (dept_id);


--
-- Name: idx_users_tenant_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_users_tenant_id ON public.users USING btree (tenant_id);


--
-- Name: idx_workflow_events_run_seq; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_workflow_events_run_seq ON public.workflow_events USING btree (run_id, seq);


--
-- Name: idx_workflow_node_executions_run_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_workflow_node_executions_run_index ON public.workflow_node_executions USING btree (run_id, node_index);


--
-- Name: idx_workflow_runs_conversation; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_workflow_runs_conversation ON public.workflow_runs USING btree (conversation_id, created_at DESC);


--
-- Name: idx_workflow_runs_kind_status_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_workflow_runs_kind_status_created ON public.workflow_runs USING btree (kind, status, created_at);


--
-- Name: idx_workflow_runs_tenant_user_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_workflow_runs_tenant_user_status ON public.workflow_runs USING btree (tenant_id, user_id, status);


--
-- Name: ix_app_tools_app_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_app_tools_app_id ON public.app_tools USING btree (app_id);


--
-- Name: ix_app_tools_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_app_tools_id ON public.app_tools USING btree (id);


--
-- Name: ix_app_tools_tool_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_app_tools_tool_id ON public.app_tools USING btree (tool_id);


--
-- Name: ix_dss_dataset; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX ix_dss_dataset ON public.dataset_segment_stats USING btree (dataset_id);


--
-- Name: ix_tool_executions_app_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_tool_executions_app_id ON public.tool_executions USING btree (app_id);


--
-- Name: ix_tool_executions_created_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_tool_executions_created_at ON public.tool_executions USING btree (created_at);


--
-- Name: ix_tool_executions_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_tool_executions_id ON public.tool_executions USING btree (id);


--
-- Name: ix_tool_executions_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_tool_executions_status ON public.tool_executions USING btree (status);


--
-- Name: ix_tool_executions_tool_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_tool_executions_tool_id ON public.tool_executions USING btree (tool_id);


--
-- Name: ix_tool_executions_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_tool_executions_user_id ON public.tool_executions USING btree (user_id);


--
-- Name: ix_tool_statistics_app_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_tool_statistics_app_id ON public.tool_statistics USING btree (app_id);


--
-- Name: ix_tool_statistics_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_tool_statistics_id ON public.tool_statistics USING btree (id);


--
-- Name: ix_tool_statistics_stat_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_tool_statistics_stat_date ON public.tool_statistics USING btree (stat_date);


--
-- Name: ix_tool_statistics_tool_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_tool_statistics_tool_id ON public.tool_statistics USING btree (tool_id);


--
-- Name: ix_tools_category; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_tools_category ON public.tools USING btree (category);


--
-- Name: ix_tools_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_tools_id ON public.tools USING btree (id);


--
-- Name: ix_tools_is_enabled; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_tools_is_enabled ON public.tools USING btree (is_enabled);


--
-- Name: ix_tools_name; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX ix_tools_name ON public.tools USING btree (name);


--
-- Name: ix_tools_tool_type; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_tools_tool_type ON public.tools USING btree (tool_type);


--
-- Name: uq_credit_tx_idempotency; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_credit_tx_idempotency ON public.credit_transactions USING btree (idempotency_key) WHERE (idempotency_key IS NOT NULL);


--
-- Name: INDEX uq_credit_tx_idempotency; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON INDEX public.uq_credit_tx_idempotency IS '同一个 key 只能落一条。前端每次打开充值框生成一个 UUID，
     重复提交撞索引 → 接口返回已存在的那条，而不是再充一次';


--
-- Name: uq_credit_tx_turn_consume; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_credit_tx_turn_consume ON public.credit_transactions USING btree (chat_session_detail_id) WHERE (((tx_type)::text = 'consume'::text) AND (chat_session_detail_id IS NOT NULL));


--
-- Name: INDEX uq_credit_tx_turn_consume; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON INDEX public.uq_credit_tx_turn_consume IS '一轮对话只能产生一条消耗流水。重试 / 重复回调时靠它兜底，
     避免同一轮被收两次钱 —— 这类重复扣费用户一定会发现，而且很难解释';


--
-- Name: users trg_auto_generate_api_key; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_auto_generate_api_key BEFORE INSERT ON public.users FOR EACH ROW EXECUTE FUNCTION public.auto_generate_api_key();


--
-- Name: TRIGGER trg_auto_generate_api_key ON users; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TRIGGER trg_auto_generate_api_key ON public.users IS '在插入新用户时自动生成 api_key';


--
-- Name: datasets trg_auto_reset_dataset_embedding_model; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_auto_reset_dataset_embedding_model AFTER UPDATE ON public.datasets FOR EACH ROW EXECUTE FUNCTION public.auto_reset_dataset_embedding_model();


--
-- Name: chat_session_detail trg_set_answered_at_and_duration_on_answer_update; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_set_answered_at_and_duration_on_answer_update BEFORE INSERT OR UPDATE ON public.chat_session_detail FOR EACH ROW EXECUTE FUNCTION public.set_answered_at_and_duration_on_answer_update();


--
-- Name: chat_session_detail trg_set_submitted_at_on_question_update; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_set_submitted_at_on_question_update BEFORE INSERT OR UPDATE ON public.chat_session_detail FOR EACH ROW EXECUTE FUNCTION public.set_submitted_at_on_question_update();


--
-- Name: tasks trg_tasks_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_tasks_updated_at BEFORE UPDATE ON public.tasks FOR EACH ROW EXECUTE FUNCTION public.update_tasks_updated_at();


--
-- Name: datasets trigger_update_datasets_timestamp; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trigger_update_datasets_timestamp BEFORE UPDATE ON public.datasets FOR EACH ROW EXECUTE FUNCTION public.update_datasets_updated_at();


--
-- Name: users trigger_update_knowledge_files_on_user_change; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trigger_update_knowledge_files_on_user_change AFTER UPDATE ON public.users FOR EACH ROW EXECUTE FUNCTION public.update_knowledge_files_on_user_change();


--
-- Name: app_tools update_app_tools_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_app_tools_updated_at BEFORE UPDATE ON public.app_tools FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: tool_statistics update_tool_statistics_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_tool_statistics_updated_at BEFORE UPDATE ON public.tool_statistics FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: tools update_tools_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_tools_updated_at BEFORE UPDATE ON public.tools FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: app_skills app_skills_app_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_skills
    ADD CONSTRAINT app_skills_app_id_fkey FOREIGN KEY (app_id) REFERENCES public.apps(id) ON DELETE CASCADE;


--
-- Name: app_skills app_skills_skill_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_skills
    ADD CONSTRAINT app_skills_skill_id_fkey FOREIGN KEY (skill_id) REFERENCES public.skills(id) ON DELETE CASCADE;


--
-- Name: app_tools app_tools_app_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_tools
    ADD CONSTRAINT app_tools_app_id_fkey FOREIGN KEY (app_id) REFERENCES public.apps(id) ON DELETE CASCADE;


--
-- Name: app_tools app_tools_tool_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_tools
    ADD CONSTRAINT app_tools_tool_id_fkey FOREIGN KEY (tool_id) REFERENCES public.tools(id) ON DELETE CASCADE;


--
-- Name: chat_session_detail chat_session_detail_workflow_run_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.chat_session_detail
    ADD CONSTRAINT chat_session_detail_workflow_run_id_fkey FOREIGN KEY (workflow_run_id) REFERENCES public.workflow_runs(id) ON DELETE SET NULL;


--
-- Name: datasets datasets_owner_dept_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.datasets
    ADD CONSTRAINT datasets_owner_dept_id_fkey FOREIGN KEY (owner_dept_id) REFERENCES public.dept(id);


--
-- Name: datasets datasets_owner_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.datasets
    ADD CONSTRAINT datasets_owner_tenant_id_fkey FOREIGN KEY (owner_tenant_id) REFERENCES public.tenant(id);


--
-- Name: datasets datasets_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.datasets
    ADD CONSTRAINT datasets_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id);


--
-- Name: dept dept_parent_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.dept
    ADD CONSTRAINT dept_parent_id_fkey FOREIGN KEY (parent_id) REFERENCES public.dept(id) ON DELETE CASCADE;


--
-- Name: dept dept_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.dept
    ADD CONSTRAINT dept_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenant(id) ON DELETE CASCADE;


--
-- Name: knowledge_category fk_knowledge_category_user_id; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.knowledge_category
    ADD CONSTRAINT fk_knowledge_category_user_id FOREIGN KEY (user_id) REFERENCES public.users(id);


--
-- Name: task_datasets fk_task_datasets_task_id; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.task_datasets
    ADD CONSTRAINT fk_task_datasets_task_id FOREIGN KEY (task_id) REFERENCES public.tasks(id) ON DELETE CASCADE;


--
-- Name: knowledge_file_contents knowledge_file_contents_file_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.knowledge_file_contents
    ADD CONSTRAINT knowledge_file_contents_file_id_fkey FOREIGN KEY (file_id) REFERENCES public.knowledge_files(id) ON DELETE CASCADE;


--
-- Name: knowledge_file_tags knowledge_file_tags_file_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.knowledge_file_tags
    ADD CONSTRAINT knowledge_file_tags_file_id_fkey FOREIGN KEY (file_id) REFERENCES public.knowledge_files(id) ON DELETE CASCADE;


--
-- Name: knowledge_file_tags knowledge_file_tags_tag_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.knowledge_file_tags
    ADD CONSTRAINT knowledge_file_tags_tag_id_fkey FOREIGN KEY (tag_id) REFERENCES public.knowledge_tags(id) ON DELETE CASCADE;


--
-- Name: knowledge_files knowledge_files_category_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.knowledge_files
    ADD CONSTRAINT knowledge_files_category_id_fkey FOREIGN KEY (category_id) REFERENCES public.knowledge_category(id);


--
-- Name: knowledge_files knowledge_files_dataset_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.knowledge_files
    ADD CONSTRAINT knowledge_files_dataset_id_fkey FOREIGN KEY (dataset_id) REFERENCES public.datasets(id);


--
-- Name: knowledge_files knowledge_files_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.knowledge_files
    ADD CONSTRAINT knowledge_files_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id);


--
-- Name: knowledge_segments knowledge_segments_file_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.knowledge_segments
    ADD CONSTRAINT knowledge_segments_file_id_fkey FOREIGN KEY (file_id) REFERENCES public.knowledge_files(id);


--
-- Name: password_reset_tokens password_reset_tokens_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.password_reset_tokens
    ADD CONSTRAINT password_reset_tokens_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: review_log review_log_reviewer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.review_log
    ADD CONSTRAINT review_log_reviewer_id_fkey FOREIGN KEY (reviewer_id) REFERENCES public.users(id);


--
-- Name: role_permissions role_permissions_role_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.role_permissions
    ADD CONSTRAINT role_permissions_role_id_fkey FOREIGN KEY (role_id) REFERENCES public.roles(id) ON DELETE CASCADE;


--
-- Name: roles roles_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.roles
    ADD CONSTRAINT roles_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenant(id) ON DELETE CASCADE;


--
-- Name: sandbox_images sandbox_images_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sandbox_images
    ADD CONSTRAINT sandbox_images_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id);


--
-- Name: skill_assets skill_assets_skill_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.skill_assets
    ADD CONSTRAINT skill_assets_skill_id_fkey FOREIGN KEY (skill_id) REFERENCES public.skills(id) ON DELETE CASCADE;


--
-- Name: skill_exec_configs skill_exec_configs_image_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.skill_exec_configs
    ADD CONSTRAINT skill_exec_configs_image_id_fkey FOREIGN KEY (image_id) REFERENCES public.sandbox_images(id);


--
-- Name: skill_exec_configs skill_exec_configs_skill_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.skill_exec_configs
    ADD CONSTRAINT skill_exec_configs_skill_id_fkey FOREIGN KEY (skill_id) REFERENCES public.skills(id) ON DELETE CASCADE;


--
-- Name: skill_user_envs skill_user_envs_skill_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.skill_user_envs
    ADD CONSTRAINT skill_user_envs_skill_id_fkey FOREIGN KEY (skill_id) REFERENCES public.skills(id) ON DELETE CASCADE;


--
-- Name: skill_user_envs skill_user_envs_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.skill_user_envs
    ADD CONSTRAINT skill_user_envs_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: skills skills_reviewed_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.skills
    ADD CONSTRAINT skills_reviewed_by_fkey FOREIGN KEY (reviewed_by) REFERENCES public.users(id);


--
-- Name: skills skills_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.skills
    ADD CONSTRAINT skills_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id);


--
-- Name: sop_subcategory sop_subcategory_category_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sop_subcategory
    ADD CONSTRAINT sop_subcategory_category_id_fkey FOREIGN KEY (category_id) REFERENCES public.sop_category(id) ON DELETE CASCADE;


--
-- Name: tool_executions tool_executions_app_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tool_executions
    ADD CONSTRAINT tool_executions_app_id_fkey FOREIGN KEY (app_id) REFERENCES public.apps(id) ON DELETE SET NULL;


--
-- Name: tool_executions tool_executions_tool_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tool_executions
    ADD CONSTRAINT tool_executions_tool_id_fkey FOREIGN KEY (tool_id) REFERENCES public.tools(id) ON DELETE CASCADE;


--
-- Name: tool_executions tool_executions_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tool_executions
    ADD CONSTRAINT tool_executions_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: tool_statistics tool_statistics_app_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tool_statistics
    ADD CONSTRAINT tool_statistics_app_id_fkey FOREIGN KEY (app_id) REFERENCES public.apps(id) ON DELETE CASCADE;


--
-- Name: tool_statistics tool_statistics_tool_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tool_statistics
    ADD CONSTRAINT tool_statistics_tool_id_fkey FOREIGN KEY (tool_id) REFERENCES public.tools(id) ON DELETE CASCADE;


--
-- Name: user_roles user_roles_role_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_roles
    ADD CONSTRAINT user_roles_role_id_fkey FOREIGN KEY (role_id) REFERENCES public.roles(id) ON DELETE CASCADE;


--
-- Name: user_roles user_roles_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_roles
    ADD CONSTRAINT user_roles_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: users users_dept_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_dept_id_fkey FOREIGN KEY (dept_id) REFERENCES public.dept(id) ON DELETE SET NULL;


--
-- Name: users users_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenant(id) ON DELETE SET NULL;


--
-- Name: workflow_events workflow_events_run_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workflow_events
    ADD CONSTRAINT workflow_events_run_id_fkey FOREIGN KEY (run_id) REFERENCES public.workflow_runs(id) ON DELETE CASCADE;


--
-- Name: workflow_node_executions workflow_node_executions_run_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workflow_node_executions
    ADD CONSTRAINT workflow_node_executions_run_id_fkey FOREIGN KEY (run_id) REFERENCES public.workflow_runs(id) ON DELETE CASCADE;


--
-- PostgreSQL database dump complete
--

\unrestrict dEH654jICKosgMjp3SoC1CjNTxO70EaCG5CV4iWvEthMaNa2KbfE0pjfv2tZdhQ

