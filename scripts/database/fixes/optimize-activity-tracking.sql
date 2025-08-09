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
