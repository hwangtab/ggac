-- 이전 마이그레이션(20260506020457)에서 error_logs의 INSERT 정책을 제거한 결과
-- 정책이 0개가 되어 rls_enabled_no_policy 어드바이저가 발생.
-- admin이 에러 로그를 조회할 수 있도록 SELECT 정책을 추가한다.
-- (INSERT는 postgres-owned SECURITY DEFINER 함수가 RLS bypass로 처리)
DROP POLICY IF EXISTS "Admins can read error_logs" ON public.error_logs;
CREATE POLICY "Admins can read error_logs"
  ON public.error_logs FOR SELECT
  TO authenticated
  USING (public.check_admin_user());
