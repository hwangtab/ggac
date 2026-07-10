-- Phase 0 DB 교정 (2026-07-10 전수감사 Task 6) — 모든 구문 idempotent
--
-- 1) RLS auth_rls_initplan 교정: 정책 표현식의 auth.uid()/auth.role() 직접 호출을
--    (select auth.uid())로 래핑해 행마다 재평가되던 것을 쿼리당 1회(InitPlan)로 축소.
--    performance advisor WARN 41건 대상. 재실행 시 이미 래핑된 정책은 건너뛴다.
-- 2) FK 커버 인덱스 7개 생성 (advisor unindexed_foreign_keys)
-- 3) post_likes 중복 인덱스 2개 삭제 (advisor duplicate_index)
-- 4) toggle_post_like: 동시 토글 시 unique_violation으로 500이 나던 회귀 복구
--    (20260506 hardening이 구버전의 핸들러를 삭제) — 동시 삽입 경합은 토글
--    의미론에 따라 "좋아요 취소"로 수렴시킨다. 기존 본인 확인 가드는 유지.
-- 5) public_profiles 뷰 security_invoker 전환 (security advisor 유일 ERROR).
--    앱 소비처(/api/profiles)는 service role 직접 조회로 선행 전환됨.
-- 6) SECURITY DEFINER RPC의 anon EXECUTE 회수 11개 — 특히 toggle_post_like는
--    anon 호출 시 auth.uid()가 NULL이라 본인 확인 가드를 통과해 임의 사용자
--    명의의 좋아요 위조가 가능했다. get_post_comments_keyset(익명 댓글 열람이
--    anon 클라이언트로 호출)과 check_admin_user(RLS 정책 4개가 내부 사용)는 유지.

-- ============================================================
-- 1) RLS initplan 교정
-- ============================================================
DO $$
DECLARE
  pol record;
  new_qual text;
  new_check text;
  cmd text;
BEGIN
  FOR pol IN
    SELECT c.relname AS tablename,
           p.polname,
           pg_get_expr(p.polqual, p.polrelid) AS qual,
           pg_get_expr(p.polwithcheck, p.polrelid) AS withcheck
    FROM pg_policy p
    JOIN pg_class c ON c.oid = p.polrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND (
        coalesce(pg_get_expr(p.polqual, p.polrelid), '') LIKE '%auth.uid()%'
        OR coalesce(pg_get_expr(p.polqual, p.polrelid), '') LIKE '%auth.role()%'
        OR coalesce(pg_get_expr(p.polwithcheck, p.polrelid), '') LIKE '%auth.uid()%'
        OR coalesce(pg_get_expr(p.polwithcheck, p.polrelid), '') LIKE '%auth.role()%'
      )
      -- 이미 래핑된 정책 제외 (pg_get_expr는 래핑을 '( SELECT auth.uid() AS uid)'로 정규화)
      AND coalesce(pg_get_expr(p.polqual, p.polrelid), '') NOT LIKE '%SELECT auth.%'
      AND coalesce(pg_get_expr(p.polwithcheck, p.polrelid), '') NOT LIKE '%SELECT auth.%'
  LOOP
    new_qual := replace(
      replace(pol.qual, 'auth.uid()', '(select auth.uid())'),
      'auth.role()', '(select auth.role())'
    );
    new_check := replace(
      replace(pol.withcheck, 'auth.uid()', '(select auth.uid())'),
      'auth.role()', '(select auth.role())'
    );

    cmd := format('ALTER POLICY %I ON public.%I', pol.polname, pol.tablename);
    IF pol.qual IS NOT NULL THEN
      cmd := cmd || format(' USING (%s)', new_qual);
    END IF;
    IF pol.withcheck IS NOT NULL THEN
      cmd := cmd || format(' WITH CHECK (%s)', new_check);
    END IF;

    EXECUTE cmd;
    RAISE NOTICE 'initplan-wrapped policy: %.%', pol.tablename, pol.polname;
  END LOOP;
END $$;

-- ============================================================
-- 2) FK 커버 인덱스
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_notifications_related_user_id
  ON public.notifications (related_user_id);
CREATE INDEX IF NOT EXISTS idx_member_profiles_approved_by
  ON public.member_profiles (approved_by);
CREATE INDEX IF NOT EXISTS idx_member_profiles_rejected_by
  ON public.member_profiles (rejected_by);
CREATE INDEX IF NOT EXISTS idx_board_agendas_proposed_by
  ON public.board_agendas (proposed_by);
CREATE INDEX IF NOT EXISTS idx_board_documents_uploaded_by
  ON public.board_documents (uploaded_by);
CREATE INDEX IF NOT EXISTS idx_board_meetings_created_by
  ON public.board_meetings (created_by);
CREATE INDEX IF NOT EXISTS idx_board_minutes_author_id
  ON public.board_minutes (author_id);

-- ============================================================
-- 3) 중복 인덱스 삭제 (idx_post_likes_post_id / idx_post_likes_post_id_user_id와 동일)
-- ============================================================
DROP INDEX IF EXISTS public.idx_post_likes_count;
DROP INDEX IF EXISTS public.idx_post_likes_optimized;

-- ============================================================
-- 4) toggle_post_like 동시성 복구 (+기존 본인 확인 가드 유지)
-- ============================================================
CREATE OR REPLACE FUNCTION public.toggle_post_like(p_post_id uuid, p_user_id uuid)
RETURNS TABLE(liked boolean, like_count integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  existing_like_id UUID;
  v_final_like_count INTEGER;
  v_is_liked BOOLEAN := false;
BEGIN
  -- 본인만 좋아요 토글 가능 (service_role은 auth.uid()=NULL)
  IF auth.uid() IS NOT NULL AND auth.uid() <> p_user_id THEN
    RAISE EXCEPTION '본인의 좋아요만 변경할 수 있습니다.';
  END IF;

  SELECT id INTO existing_like_id
  FROM post_likes
  WHERE post_id = p_post_id AND user_id = p_user_id;

  IF existing_like_id IS NOT NULL THEN
    DELETE FROM post_likes WHERE id = existing_like_id;
    v_is_liked := false;
  ELSE
    BEGIN
      INSERT INTO post_likes (post_id, user_id, created_at)
      VALUES (p_post_id, p_user_id, NOW());
      v_is_liked := true;
    EXCEPTION WHEN unique_violation THEN
      -- 동시 요청이 먼저 삽입한 경우(더블클릭 등): 토글 의미론대로 취소로 수렴
      DELETE FROM post_likes WHERE post_id = p_post_id AND user_id = p_user_id;
      v_is_liked := false;
    END;
  END IF;

  UPDATE posts
  SET like_count = (
    SELECT COUNT(*)
    FROM post_likes
    WHERE post_likes.post_id = p_post_id
  )
  WHERE posts.id = p_post_id
  RETURNING posts.like_count INTO v_final_like_count;

  RETURN QUERY SELECT v_is_liked, v_final_like_count;
END;
$function$;

-- ============================================================
-- 5) public_profiles 뷰: SECURITY DEFINER(생성자 권한) → invoker 전환
-- ============================================================
ALTER VIEW public.public_profiles SET (security_invoker = true);

-- ============================================================
-- 6) SECURITY DEFINER RPC의 anon EXECUTE 회수
--    (authenticated·service_role 경로는 유지 — 앱의 모든 호출처가 세션 또는
--     service role 클라이언트임을 코드 전수 확인함)
-- ============================================================
REVOKE EXECUTE ON FUNCTION public.get_system_settings(boolean) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.update_system_setting(public.system_setting_category, character varying, jsonb) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.reset_system_setting(public.system_setting_category, character varying) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.toggle_post_like(uuid, uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.upsert_user_setting(public.setting_category, character varying, jsonb) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.reset_user_settings(public.setting_category, character varying) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.get_user_settings(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.get_user_likes(uuid, integer, integer) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.mark_notification_read(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.mark_all_notifications_read() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.is_active_member(uuid) FROM PUBLIC, anon;

-- CREATE OR REPLACE(4번)가 toggle_post_like의 기존 GRANT를 보존하지만,
-- 표준 경로를 명시해 재실행에도 결정적이게 한다.
GRANT EXECUTE ON FUNCTION public.get_system_settings(boolean) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.update_system_setting(public.system_setting_category, character varying, jsonb) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.reset_system_setting(public.system_setting_category, character varying) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.toggle_post_like(uuid, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.upsert_user_setting(public.setting_category, character varying, jsonb) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.reset_user_settings(public.setting_category, character varying) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_user_settings(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_user_likes(uuid, integer, integer) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.mark_notification_read(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.mark_all_notifications_read() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.is_active_member(uuid) TO authenticated, service_role;
