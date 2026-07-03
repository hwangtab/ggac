-- 클래스 B: SECURITY DEFINER 함수 6종의 anon EXECUTE 회수
--
-- 배경: 아래 6개 함수는 SECURITY DEFINER인데 생성 시 REVOKE가 누락되어
-- 기본 PUBLIC(anon 포함) EXECUTE가 열려 있었다. "auth.uid() NULL = service_role"
-- 오가정 때문에 비인증 anon이 PostgREST rpc로 직접 호출해 관리자 알림 생성·
-- 타인 명의 활동/세션 위조·관리자 계정 탐지가 가능했다.
--
-- 조치: PUBLIC, anon에서만 EXECUTE 회수. authenticated는 유지한다
-- (정당한 서버 호출부는 대부분 authenticated 롤 createSupabaseServer()이며,
-- service_role 호출은 별도 grantee로 유지된다). 함수 본문(NULL-caller 로직)은
-- 건드리지 않는다 — service_role 호출이 auth.uid()=NULL이라 뒤집으면 파손된다.
--
-- 시그니처는 pg_get_function_identity_arguments로 확인한 실제 인자 타입을 사용한다.

REVOKE EXECUTE ON FUNCTION public.create_notification(uuid, notification_type, character varying, text, jsonb, uuid, uuid, timestamp with time zone) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.create_bulk_notification(uuid[], notification_type, character varying, text, jsonb, timestamp with time zone) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.toggle_comment_like(uuid, uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.log_user_activity(uuid, activity_action_type, activity_target_type, uuid, jsonb, inet, text, uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.manage_user_session(uuid, character varying, character varying, inet, text, jsonb) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.is_admin_user(uuid) FROM PUBLIC, anon;
