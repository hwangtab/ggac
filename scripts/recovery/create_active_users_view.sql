-- ⛔ 실행 금지 표시 — Supabase(PostgreSQL) 전용, 2026-08-26 Turso 컷오버로 사문화됐다.
--
-- 이 파일을 Supabase SQL Editor나 psql에 붙여넣지 마라. 운영 데이터의 권위는
-- 이제 Turso(SQLite)이고 앱은 Supabase를 어디에서도 읽지 않는다 — 실행하면
-- **버려진 사본만 바뀌고 화면은 그대로다.** 조용한 성공이 제일 나쁘다.
-- RLS·auth.uid()·DO $$ 같은 Postgres 전용 문법이라 Turso에 그대로 옮길 수도 없다.
-- 스키마 정본은 src/db/schema/ 이고, 변경은 drizzle-kit 마이그레이션으로 한다
-- (npm run db:generate → src/db/migrations/, 적용 절차는 scripts/turso/README.md).
--
-- Create active_users_view if missing (used by admin real-time monitor)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE c.relkind IN ('v','m') AND n.nspname='public' AND c.relname='active_users_view'
  ) THEN
    EXECUTE '
      CREATE VIEW public.active_users_view AS
      SELECT 
        us.user_id,
        mp.display_name,
        mp.email,
        us.last_activity,
        us.ip_address,
        COUNT(ua.id) AS activity_count_today,
        us.session_token,
        EXTRACT(EPOCH FROM (NOW() - us.last_activity)) / 60 AS minutes_since_activity
      FROM user_sessions us
      JOIN member_profiles mp ON us.user_id = mp.id
      LEFT JOIN user_activities ua ON ua.user_id = us.user_id 
        AND ua.created_at >= CURRENT_DATE
      WHERE us.is_active = TRUE 
        AND us.last_activity > NOW() - INTERVAL ''30 minutes''
      GROUP BY us.user_id, mp.display_name, mp.email, us.last_activity, 
               us.ip_address, us.session_token
      ORDER BY us.last_activity DESC;
    ';
  END IF;
END$$;

-- Grant read access to authenticated (RLS applies to underlying tables)
GRANT SELECT ON public.active_users_view TO authenticated;
