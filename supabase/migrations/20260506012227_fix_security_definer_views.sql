-- Supabase Security Advisor: security_definer_view 7건 해결
-- 대상 뷰:
--   active_users_view, artist_photos_with_storage, artists_with_photo,
--   notification_stats, posts_performance_indexes, user_settings_summary,
--   weekly_activity_stats
--
-- 핵심 변경:
--   1) security_invoker=true 로 전환 → 호출자 권한으로 실행, 하위 RLS 적용
--   2) anon/authenticated 의 불필요한 INSERT/UPDATE/DELETE/TRIGGER/REFERENCES/TRUNCATE 회수
--   3) 뷰별 SELECT 권한을 실제 사용 패턴에 맞게 조정

-- ============================================================
-- 1. security_invoker = true 적용
-- ============================================================
ALTER VIEW public.active_users_view SET (security_invoker = true);
ALTER VIEW public.artist_photos_with_storage SET (security_invoker = true);
ALTER VIEW public.artists_with_photo SET (security_invoker = true);
ALTER VIEW public.notification_stats SET (security_invoker = true);
ALTER VIEW public.posts_performance_indexes SET (security_invoker = true);
ALTER VIEW public.user_settings_summary SET (security_invoker = true);
ALTER VIEW public.weekly_activity_stats SET (security_invoker = true);

-- ============================================================
-- 2. 모든 뷰에서 비-SELECT 권한 회수 (defense in depth)
-- ============================================================
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.active_users_view FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.artist_photos_with_storage FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.artists_with_photo FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.notification_stats FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.posts_performance_indexes FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.user_settings_summary FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.weekly_activity_stats FROM anon, authenticated;

-- ============================================================
-- 3. 뷰별 SELECT 권한 최소화
-- ============================================================
-- session_token, IP 등 민감정보 → service_role 전용
REVOKE SELECT ON public.active_users_view FROM anon, authenticated;

-- admin 진단용, 코드 사용 없음 → service_role 전용
REVOKE SELECT ON public.artist_photos_with_storage FROM anon, authenticated;

-- artists_with_photo: 공개 데이터 → 기존 grants 유지

-- 본인 알림 통계 (RLS로 본인 것만 보임). anon은 차단
REVOKE SELECT ON public.notification_stats FROM anon;

-- admin 인덱스 진단용 → service_role 전용
REVOKE SELECT ON public.posts_performance_indexes FROM anon, authenticated;

-- 본인 설정 통계 (RLS로 본인 것만 보임). anon은 차단
REVOKE SELECT ON public.user_settings_summary FROM anon;

-- admin 분석용 (admin route에서 service_role로 접근) → service_role 전용
REVOKE SELECT ON public.weekly_activity_stats FROM anon, authenticated;
