-- ⛔ 실행 금지 표시 — Supabase(PostgreSQL) 전용, 2026-08-26 Turso 컷오버로 사문화됐다.
--
-- 이 파일을 Supabase SQL Editor나 psql에 붙여넣지 마라. 운영 데이터의 권위는
-- 이제 Turso(SQLite)이고 앱은 Supabase를 어디에서도 읽지 않는다 — 실행하면
-- **버려진 사본만 바뀌고 화면은 그대로다.** 조용한 성공이 제일 나쁘다.
-- RLS·auth.uid()·DO $$ 같은 Postgres 전용 문법이라 Turso에 그대로 옮길 수도 없다.
-- 스키마 정본은 src/db/schema/ 이고, 변경은 drizzle-kit 마이그레이션으로 한다
-- (npm run db:generate → src/db/migrations/, 적용 절차는 scripts/turso/README.md).
--
-- 활동 추적 시스템 데이터베이스 최적화
-- Performance optimization for activity tracking system

-- 1. 인덱스 최적화
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_user_activities_user_created 
ON user_activities(user_id, created_at DESC);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_user_activities_action_created 
ON user_activities(action_type, created_at DESC);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_user_sessions_user_login 
ON user_sessions(user_id, login_at DESC);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_user_sessions_active 
ON user_sessions(is_active, last_activity DESC) WHERE is_active = true;

-- 2. 통계 뷰 최적화
REFRESH MATERIALIZED VIEW CONCURRENTLY weekly_activity_stats;

-- 3. 자동 정리 작업 (선택사항)
-- DELETE FROM user_activities WHERE created_at < NOW() - INTERVAL '6 months';

-- 4. 분석 결과
ANALYZE user_activities;
ANALYZE user_sessions;

-- 성능 모니터링 쿼리
SELECT 
  schemaname,
  tablename,
  attname,
  n_distinct,
  correlation
FROM pg_stats 
WHERE tablename IN ('user_activities', 'user_sessions')
ORDER BY tablename, attname;
