#!/bin/bash
set -euo pipefail

# psql을 통한 직접 시스템 조사 스크립트
# 작업 로그에서 성공한 연결 정보 사용

PSQL="/opt/homebrew/opt/libpq/bin/psql"
PASS_URLENC='Hamagood1248%23'
POOLER="postgresql://postgres.btugywkltavbogdnhwpu:${PASS_URLENC}@aws-0-ap-northeast-2.pooler.supabase.com:6543/postgres?sslmode=require"

echo "=== psql 직접 연결을 통한 시스템 조사 ==="
echo ""

# 1. 연결 테스트
echo "1. 연결 확인"
"$PSQL" -Atc 'SELECT version();' "$POOLER" || {
  echo "❌ 연결 실패"
  exit 1
}
echo "✅ 연결 성공"
echo ""

# 2. 모든 스키마 조사
echo "2. 전체 스키마 및 테이블 조사"
"$PSQL" -At "$POOLER" <<'SQL'
SELECT schemaname, tablename 
FROM pg_tables 
WHERE schemaname NOT IN ('information_schema', 'pg_catalog', 'pg_toast')
ORDER BY schemaname, tablename;
SQL
echo ""

# 3. Supabase 관련 스키마 상세 조사
echo "3. Supabase 관련 스키마 상세 조사"
"$PSQL" -At "$POOLER" <<'SQL'
SELECT schemaname, tablename, tableowner
FROM pg_tables 
WHERE schemaname LIKE '%supabase%' 
   OR schemaname LIKE '%backup%'
   OR schemaname LIKE '%archive%'
   OR tablename LIKE '%backup%'
   OR tablename LIKE '%archive%'
   OR tablename LIKE '%log%'
   OR tablename LIKE '%migration%'
ORDER BY schemaname, tablename;
SQL
echo ""

# 4. supabase_migrations 스키마 확인
echo "4. supabase_migrations 스키마 조사"
"$PSQL" -At "$POOLER" <<'SQL'
SELECT version, name, inserted_at 
FROM supabase_migrations.schema_migrations 
ORDER BY inserted_at DESC 
LIMIT 10;
SQL
echo ""

# 5. WAL 및 백업 설정 조사
echo "5. WAL 및 백업 설정 조사"
"$PSQL" -At "$POOLER" <<'SQL'
SELECT name, setting, context, short_desc
FROM pg_settings 
WHERE name LIKE '%wal%' 
   OR name LIKE '%archive%'
   OR name LIKE '%backup%'
ORDER BY name;
SQL
echo ""

# 6. 데이터베이스 통계 조사
echo "6. 데이터베이스 통계"
"$PSQL" -At "$POOLER" <<'SQL'
SELECT datname, xact_commit, xact_rollback, 
       tup_inserted, tup_updated, tup_deleted
FROM pg_stat_database 
WHERE datname = 'postgres';
SQL
echo ""

# 7. posts 테이블 통계 상세 조사
echo "7. posts 테이블 활동 통계"
"$PSQL" -At "$POOLER" <<'SQL'
SELECT schemaname, tablename, n_tup_ins, n_tup_upd, n_tup_del, 
       n_live_tup, n_dead_tup, last_vacuum, last_autovacuum
FROM pg_stat_user_tables 
WHERE tablename = 'posts';
SQL
echo ""

# 8. 현재 활성 연결 및 최근 활동 조사
echo "8. 현재 활성 연결 및 최근 활동"
"$PSQL" -At "$POOLER" <<'SQL'
SELECT pid, usename, application_name, state, 
       query_start, state_change, query
FROM pg_stat_activity 
WHERE datname = 'postgres' 
  AND state != 'idle'
ORDER BY query_start DESC
LIMIT 5;
SQL
echo ""

# 9. 트랜잭션 로그 분석 (가능한 경우)
echo "9. 트랜잭션 로그 분석"
"$PSQL" -At "$POOLER" <<'SQL'
SELECT pg_current_wal_lsn(), 
       pg_wal_lsn_diff(pg_current_wal_lsn(), '0/0') as wal_bytes;
SQL
echo ""

# 10. 실제 게시물 ID들과 관련된 모든 참조 조사
echo "10. 실제 게시물 ID 참조 관계 조사"

# 복구 대상 게시물 ID들 (첫 5개만 테스트)
POST_IDS="'7922037f-168b-4c1a-ab0b-8668d462ee9b','e7fa6a8a-9569-48a2-b0d3-c29cd51a1e5e','0e307867-f023-4598-a817-946f56724b67','f8a8cff5-28c4-42ff-a016-ff893425d7da','9f5883a9-b77a-4707-bb41-be77f597b2d7'"

echo "10-1. post_likes 테이블에서 참조 확인"
"$PSQL" -At "$POOLER" <<SQL
SELECT post_id, user_id, created_at 
FROM post_likes 
WHERE post_id IN ($POST_IDS)
ORDER BY created_at;
SQL
echo ""

echo "10-2. notifications 테이블에서 참조 확인"
"$PSQL" -At "$POOLER" <<SQL
SELECT id, type, message, related_post_id, created_at, data
FROM notifications 
WHERE related_post_id IN ($POST_IDS)
ORDER BY created_at;
SQL
echo ""

echo "10-3. comments 테이블에서 참조 확인"
"$PSQL" -At "$POOLER" <<SQL
SELECT id, post_id, content, author_id, created_at
FROM comments 
WHERE post_id IN ($POST_IDS)
ORDER BY created_at;
SQL
echo ""

echo "10-4. post_attachments 테이블에서 참조 확인"
"$PSQL" -At "$POOLER" <<SQL
SELECT id, post_id, file_name, file_type, file_size, file_url, created_at
FROM post_attachments 
WHERE post_id IN ($POST_IDS)
ORDER BY created_at;
SQL
echo ""

# 11. 시스템 정보 수집
echo "11. PostgreSQL 시스템 정보"
"$PSQL" -At "$POOLER" <<'SQL'
SELECT 
  version() as pg_version,
  current_database() as database_name,
  current_user as current_user,
  inet_server_addr() as server_ip,
  inet_server_port() as server_port;
SQL
echo ""

echo "12. 테이블 크기 및 인덱스 정보"
"$PSQL" -At "$POOLER" <<'SQL'
SELECT 
  schemaname,
  tablename,
  pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename)) as total_size,
  pg_size_pretty(pg_relation_size(schemaname||'.'||tablename)) as table_size
FROM pg_tables 
WHERE schemaname = 'public' 
  AND tablename IN ('posts', 'post_likes', 'comments', 'notifications', 'post_attachments')
ORDER BY pg_total_relation_size(schemaname||'.'||tablename) DESC;
SQL

echo ""
echo "=== 조사 완료 ==="