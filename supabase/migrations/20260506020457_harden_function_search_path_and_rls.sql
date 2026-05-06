-- Supabase Security Advisor: WARN 카테고리 일부 해소
--   A) function_search_path_mutable 82건
--   B) rls_policy_always_true 4건

-- ============================================================
-- A) public 스키마의 search_path 미설정 함수 일괄 보정
-- ============================================================
-- search_path가 설정되지 않은 함수는 호출 시 다른 스키마의 동명 객체로
-- 가로채기(search_path injection) 위험이 있다.
-- 모든 public 함수에 SET search_path = public, pg_temp 적용.
-- 이미 설정된 함수는 건너뛴다 (idempotent).
DO $$
DECLARE
  fn record;
BEGIN
  FOR fn IN
    SELECT
      p.proname,
      pg_get_function_identity_arguments(p.oid) AS args
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND (
        p.proconfig IS NULL
        OR NOT EXISTS (
          SELECT 1 FROM unnest(p.proconfig) AS c
          WHERE c LIKE 'search_path=%'
        )
      )
  LOOP
    EXECUTE format(
      'ALTER FUNCTION public.%I(%s) SET search_path = public, pg_temp',
      fn.proname, fn.args
    );
  END LOOP;
END $$;


-- ============================================================
-- B) RLS WITH CHECK true 정책 제거
-- ============================================================
-- 4개 audit/log 테이블에 anon/authenticated가 직접 INSERT 가능했던
-- "WITH CHECK true" 정책 제거. 합법적 INSERT 경로:
--   - service_role 클라이언트 (RLS bypass)
--   - postgres-owned SECURITY DEFINER 함수
--     (create_notification, create_bulk_notification, log_user_activity,
--      execute_advanced_search, safe_execute_query 등) — 모두 RLS bypass
-- 트리거 함수(notify_new_comment, notify_member_status_change)도
-- 직접 INSERT 대신 create_notification SECURITY DEFINER를 호출하므로 영향 없음.
DROP POLICY IF EXISTS "System can insert error logs" ON public.error_logs;
DROP POLICY IF EXISTS "System can insert login history" ON public.member_login_history;
DROP POLICY IF EXISTS "System can insert status history" ON public.member_status_history;
DROP POLICY IF EXISTS "Service role can insert notifications" ON public.notifications;
