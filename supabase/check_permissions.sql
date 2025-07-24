-- Supabase PostgreSQL 버전 호환 권한 확인 쿼리
-- 2025-07-24: Permission Check Queries

-- 1. 기본 사용자 정보 확인
SELECT 
    current_user as current_user,
    session_user as session_user,
    current_database() as current_database;

-- 2. 현재 사용자의 기본 권한 확인
SELECT 
    rolname as user_name,
    rolsuper as is_superuser,
    rolcreaterole as can_create_roles,
    rolcreatedb as can_create_databases,
    rolcanlogin as can_login,
    rolreplication as can_replicate
FROM pg_roles 
WHERE rolname = current_user;

-- 3. supabase_admin 역할 존재 여부 확인
SELECT EXISTS(
    SELECT 1 FROM pg_roles WHERE rolname = 'supabase_admin'
) as supabase_admin_role_exists;

-- 4. 현재 사용자가 supabase_admin 권한을 가지고 있는지 확인
SELECT pg_has_role(current_user, 'supabase_admin', 'member') as has_supabase_admin_role;

-- 5. 현재 사용자가 속한 모든 역할 확인 (수정된 버전)
SELECT DISTINCT r.rolname as inherited_role
FROM pg_roles r
WHERE r.oid IN (
    SELECT m.roleid 
    FROM pg_auth_members m 
    WHERE m.member = (SELECT oid FROM pg_roles WHERE rolname = current_user)
);

-- 6. 테이블 및 스키마 권한 확인
SELECT 
    table_name,
    privilege_type
FROM information_schema.table_privileges 
WHERE grantee = current_user 
AND table_schema = 'public' 
AND table_name = 'posts';

-- 7. 함수 생성 권한 확인
SELECT has_schema_privilege(current_user, 'public', 'CREATE') as can_create_in_public_schema;

-- 8. 현재 연결 정보
SELECT 
    usename as connected_user,
    application_name,
    client_addr,
    backend_start
FROM pg_stat_activity 
WHERE pid = pg_backend_pid();