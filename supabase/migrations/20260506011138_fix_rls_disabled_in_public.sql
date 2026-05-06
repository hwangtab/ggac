-- Supabase Security Advisor: rls_disabled_in_public 5건 해결
-- 영향 테이블: system_settings, system_settings_history,
--              member_profiles_normalize_log, artists_backup_20241218,
--              artists_backup_full_20241218
--
-- 모든 쓰기는 service_role 또는 SECURITY DEFINER RPC를 통해서만 이뤄지며,
-- 관리자 직접 조회는 check_admin_user()로 게이트한다.

-- ============================================================
-- 1. system_settings
-- ============================================================
DROP POLICY IF EXISTS "All users can view non-sensitive settings" ON public.system_settings;
DROP POLICY IF EXISTS "Admin fallback read only" ON public.system_settings;
DROP POLICY IF EXISTS "Authenticated users can read settings" ON public.system_settings;
DROP POLICY IF EXISTS "Only functions can modify settings" ON public.system_settings;

ALTER TABLE public.system_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins can read system_settings" ON public.system_settings;
CREATE POLICY "Admins can read system_settings"
  ON public.system_settings FOR SELECT
  TO authenticated
  USING (public.check_admin_user());

REVOKE ALL ON public.system_settings FROM anon;


-- ============================================================
-- 2. system_settings_history (트리거 INSERT 전용)
-- ============================================================
ALTER TABLE public.system_settings_history ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins can read system_settings_history" ON public.system_settings_history;
CREATE POLICY "Admins can read system_settings_history"
  ON public.system_settings_history FOR SELECT
  TO authenticated
  USING (public.check_admin_user());

REVOKE INSERT, UPDATE, DELETE ON public.system_settings_history FROM anon, authenticated;
REVOKE ALL ON public.system_settings_history FROM anon;


-- ============================================================
-- 3. member_profiles_normalize_log (일회성 마이그레이션 로그)
-- ============================================================
ALTER TABLE public.member_profiles_normalize_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins can read member_profiles_normalize_log" ON public.member_profiles_normalize_log;
CREATE POLICY "Admins can read member_profiles_normalize_log"
  ON public.member_profiles_normalize_log FOR SELECT
  TO authenticated
  USING (public.check_admin_user());

REVOKE INSERT, UPDATE, DELETE ON public.member_profiles_normalize_log FROM anon, authenticated;
REVOKE ALL ON public.member_profiles_normalize_log FROM anon;


-- ============================================================
-- 4. artists_backup_20241218 (1년 전 일회성 백업)
-- ============================================================
ALTER TABLE public.artists_backup_20241218 ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins can read artists_backup_20241218" ON public.artists_backup_20241218;
CREATE POLICY "Admins can read artists_backup_20241218"
  ON public.artists_backup_20241218 FOR SELECT
  TO authenticated
  USING (public.check_admin_user());

REVOKE INSERT, UPDATE, DELETE ON public.artists_backup_20241218 FROM anon, authenticated;
REVOKE ALL ON public.artists_backup_20241218 FROM anon;


-- ============================================================
-- 5. artists_backup_full_20241218 (1년 전 일회성 백업)
-- ============================================================
ALTER TABLE public.artists_backup_full_20241218 ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins can read artists_backup_full_20241218" ON public.artists_backup_full_20241218;
CREATE POLICY "Admins can read artists_backup_full_20241218"
  ON public.artists_backup_full_20241218 FOR SELECT
  TO authenticated
  USING (public.check_admin_user());

REVOKE INSERT, UPDATE, DELETE ON public.artists_backup_full_20241218 FROM anon, authenticated;
REVOKE ALL ON public.artists_backup_full_20241218 FROM anon;
