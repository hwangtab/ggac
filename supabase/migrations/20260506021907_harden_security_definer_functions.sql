-- Supabase Security Advisor: SECURITY DEFINER 함수 67건 정리
--
-- 두 가지 작업:
--   1) 사용자 ID 인자를 받지만 auth.uid() 검증이 없어 위변조 가능한 함수에
--      내부 인증 체크를 추가한다 (CREATE OR REPLACE).
--   2) 앱 코드에서 PostgREST RPC로 호출되지 않는 internal-only 함수의
--      EXECUTE 권한을 anon/authenticated/PUBLIC에서 회수한다.
--
-- service_role은 이러한 REVOKE의 영향을 받지 않으며, postgres-owned
-- SECURITY DEFINER 함수가 트리거 등에서 다른 함수를 호출할 때도 owner
-- 권한으로 실행되므로 영향이 없다.

-- ============================================================
-- 1) 사용자 ID 위변조 방지 검증 추가
-- ============================================================
-- 패턴: auth.uid()가 NULL이면 service_role 호출 → 통과
--       auth.uid()가 있으면 p_user_id와 일치해야 함
-- create_notification류는 admin 전용이므로 admin 체크로 대체

CREATE OR REPLACE FUNCTION public.toggle_post_like(p_post_id uuid, p_user_id uuid)
RETURNS TABLE(liked boolean, like_count integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
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
    INSERT INTO post_likes (post_id, user_id, created_at)
    VALUES (p_post_id, p_user_id, NOW());
    v_is_liked := true;
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


CREATE OR REPLACE FUNCTION public.toggle_comment_like(p_comment_id uuid, p_user_id uuid)
RETURNS TABLE(liked boolean, like_count integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  existing_like_id UUID;
  current_like_count INTEGER;
BEGIN
  IF auth.uid() IS NOT NULL AND auth.uid() <> p_user_id THEN
    RAISE EXCEPTION '본인의 좋아요만 변경할 수 있습니다.';
  END IF;

  SELECT id INTO existing_like_id
  FROM comment_likes
  WHERE comment_id = p_comment_id AND user_id = p_user_id;

  IF existing_like_id IS NOT NULL THEN
    DELETE FROM comment_likes WHERE id = existing_like_id;

    SELECT comments.like_count INTO current_like_count
    FROM comments WHERE id = p_comment_id;

    RETURN QUERY SELECT false, current_like_count;
  ELSE
    INSERT INTO comment_likes (comment_id, user_id)
    VALUES (p_comment_id, p_user_id);

    SELECT comments.like_count INTO current_like_count
    FROM comments WHERE id = p_comment_id;

    RETURN QUERY SELECT true, current_like_count;
  END IF;
END;
$function$;


CREATE OR REPLACE FUNCTION public.log_user_activity(
  p_user_id uuid,
  p_action_type activity_action_type,
  p_target_type activity_target_type DEFAULT NULL::activity_target_type,
  p_target_id uuid DEFAULT NULL::uuid,
  p_metadata jsonb DEFAULT '{}'::jsonb,
  p_ip_address inet DEFAULT NULL::inet,
  p_user_agent text DEFAULT NULL::text,
  p_session_id uuid DEFAULT NULL::uuid
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  activity_id UUID;
BEGIN
  IF auth.uid() IS NOT NULL AND auth.uid() <> p_user_id THEN
    RAISE EXCEPTION '본인의 활동 로그만 기록할 수 있습니다.';
  END IF;

  INSERT INTO user_activities (
    user_id, action_type, target_type, target_id,
    metadata, ip_address, user_agent, session_id
  ) VALUES (
    p_user_id, p_action_type, p_target_type, p_target_id,
    p_metadata, p_ip_address, p_user_agent, p_session_id
  ) RETURNING id INTO activity_id;

  INSERT INTO daily_activity_stats (activity_date, user_id, action_type, count)
  VALUES (CURRENT_DATE, p_user_id, p_action_type, 1)
  ON CONFLICT (activity_date, user_id, action_type)
  DO UPDATE SET
    count = daily_activity_stats.count + 1,
    last_updated = NOW();

  RETURN activity_id;
END;
$function$;


CREATE OR REPLACE FUNCTION public.manage_user_session(
  p_user_id uuid,
  p_session_token character varying,
  p_action character varying,
  p_ip_address inet DEFAULT NULL::inet,
  p_user_agent text DEFAULT NULL::text,
  p_metadata jsonb DEFAULT '{}'::jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  session_id UUID;
BEGIN
  IF auth.uid() IS NOT NULL AND auth.uid() <> p_user_id THEN
    RAISE EXCEPTION '본인의 세션만 관리할 수 있습니다.';
  END IF;

  IF p_action = 'start' THEN
    UPDATE user_sessions
    SET is_active = FALSE, logout_at = NOW()
    WHERE user_id = p_user_id AND is_active = TRUE;

    INSERT INTO user_sessions (
      user_id, session_token, ip_address, user_agent, metadata
    ) VALUES (
      p_user_id, p_session_token, p_ip_address, p_user_agent, p_metadata
    ) RETURNING id INTO session_id;

    PERFORM log_user_activity(
      p_user_id, 'login'::activity_action_type, 'system'::activity_target_type,
      NULL, p_metadata, p_ip_address, p_user_agent, session_id
    );

  ELSIF p_action = 'update' THEN
    UPDATE user_sessions
    SET last_activity = NOW(), metadata = p_metadata
    WHERE session_token = p_session_token AND is_active = TRUE
    RETURNING id INTO session_id;

  ELSIF p_action = 'end' THEN
    UPDATE user_sessions
    SET is_active = FALSE, logout_at = NOW()
    WHERE session_token = p_session_token AND is_active = TRUE
    RETURNING id INTO session_id;

    PERFORM log_user_activity(
      p_user_id, 'logout'::activity_action_type, 'system'::activity_target_type,
      NULL, p_metadata, p_ip_address, p_user_agent, session_id
    );
  END IF;

  RETURN session_id;
END;
$function$;


-- create_notification은 admin 전용. service_role 또는 admin만 호출 가능.
CREATE OR REPLACE FUNCTION public.create_notification(
  p_user_id uuid,
  p_type notification_type,
  p_title character varying,
  p_message text,
  p_data jsonb DEFAULT '{}'::jsonb,
  p_related_post_id uuid DEFAULT NULL::uuid,
  p_related_user_id uuid DEFAULT NULL::uuid,
  p_expires_at timestamp with time zone DEFAULT NULL::timestamp with time zone
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  notification_id UUID;
BEGIN
  -- service_role(auth.uid()=NULL)이거나 admin만 호출 가능.
  -- 트리거 함수(notify_new_comment, notify_member_status_change)는
  -- SECURITY INVOKER이므로 호출자 컨텍스트로 실행되며, 인증된 일반 사용자가
  -- 댓글/상태변경을 일으킬 때 알림 생성이 필요하므로 트리거 호출은 별도 허용한다.
  -- 트리거 컨텍스트에서의 호출은 허용 (notify_new_comment, notify_member_status_change)
  IF auth.uid() IS NOT NULL
     AND pg_trigger_depth() = 0
     AND NOT public.is_admin_user(auth.uid())
  THEN
    RAISE EXCEPTION '알림 생성은 관리자만 가능합니다.';
  END IF;

  INSERT INTO notifications (
    user_id, type, title, message, data, related_post_id, related_user_id, expires_at
  ) VALUES (
    p_user_id, p_type, p_title, p_message, p_data, p_related_post_id, p_related_user_id, p_expires_at
  ) RETURNING id INTO notification_id;

  RETURN notification_id;
END;
$function$;


CREATE OR REPLACE FUNCTION public.create_bulk_notification(
  p_user_ids uuid[],
  p_type notification_type,
  p_title character varying,
  p_message text,
  p_data jsonb DEFAULT '{}'::jsonb,
  p_expires_at timestamp with time zone DEFAULT NULL::timestamp with time zone
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  inserted_count INTEGER;
BEGIN
  -- bulk 알림은 admin 전용 (트리거에서 호출되지 않음)
  IF auth.uid() IS NOT NULL AND NOT public.is_admin_user(auth.uid()) THEN
    RAISE EXCEPTION '대량 알림 생성은 관리자만 가능합니다.';
  END IF;

  WITH inserted AS (
    INSERT INTO notifications (user_id, type, title, message, data, expires_at)
    SELECT unnest(p_user_ids), p_type, p_title, p_message, p_data, p_expires_at
    RETURNING id
  )
  SELECT COUNT(*) INTO inserted_count FROM inserted;

  RETURN inserted_count;
END;
$function$;


-- ============================================================
-- 2) Internal-only SECURITY DEFINER 함수의 EXECUTE 권한 회수
-- ============================================================
-- 다음 함수들은 앱 코드에서 호출되지 않거나, 호출되더라도 admin route에서
-- requireAdmin()(service_role)을 통해 호출된다. anon/authenticated가 직접
-- /rest/v1/rpc/<func>로 호출할 수 없도록 PUBLIC 권한을 회수한다.

-- 정리/유지보수 함수
REVOKE EXECUTE ON FUNCTION public.cleanup_error_logs() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.cleanup_expired_notifications() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.cleanup_expired_temp_attachments() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.cleanup_old_activity_data() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.cleanup_orphaned_artist_photos() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.cleanup_orphaned_profile_photos() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.fix_post_like_counts() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.verify_post_like_counts() FROM PUBLIC, anon, authenticated;

-- 버킷 ensure 함수
REVOKE EXECUTE ON FUNCTION public.ensure_artists_bucket_exists() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.ensure_attachments_bucket_exists() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.ensure_profiles_bucket_exists() FROM PUBLIC, anon, authenticated;

-- 트리거/내부 helper 함수
REVOKE EXECUTE ON FUNCTION public.update_post_like_count() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.trg_comments_recalc() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.trg_post_likes_recalc() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.update_profile_completeness() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.calculate_profile_completeness(uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.notify_new_post() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.recalc_post_comment_count(uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.recalc_post_like_count(uuid) FROM PUBLIC, anon, authenticated;

-- 어드민/온보딩 helper
REVOKE EXECUTE ON FUNCTION public.make_first_admin(text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.create_member_profile(uuid, text, text, text, text, date, integer, text, text, text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.create_user_profile(uuid, text, text) FROM PUBLIC, anon, authenticated;

-- 사진/스토리지 admin 도구 (admin route에서 service_role 사용)
REVOKE EXECUTE ON FUNCTION public.update_artist_photo(text, text, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.delete_artist_photo(text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.get_artist_photo_info(text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.get_artist_photo_stats() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.get_artist_storage_stats() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.get_artist_profile_files(text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.get_artist_by_member_id(uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.update_profile_photo(uuid, text, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.delete_profile_photo(uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.get_profile_photo_info(uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.get_profile_photo_stats() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.get_profile_storage_stats() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.get_user_profile_files(uuid) FROM PUBLIC, anon, authenticated;

-- 통계/분석 (admin route에서 service_role 사용)
REVOKE EXECUTE ON FUNCTION public.get_engagement_summary() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.get_post_view_stats(timestamp with time zone, timestamp with time zone) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.get_real_time_activity_feed(integer, activity_action_type[]) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.get_user_activity_stats(uuid, date, date) FROM PUBLIC, anon, authenticated;

-- 코드 미사용 함수
REVOKE EXECUTE ON FUNCTION public.get_popular_posts(integer, integer) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.get_post_likes(uuid, integer, integer) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.get_comment_likes(uuid, integer, integer) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.get_user_comment_likes(uuid, integer, integer) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.increment_post_view_count(uuid) FROM PUBLIC, anon, authenticated;

-- 동적 SQL 함수 (이전 마이그레이션에서 일부 처리됨, 멱등 안전망)
REVOKE EXECUTE ON FUNCTION public.execute_advanced_search(text, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.execute_advanced_search_json(text, text[]) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.safe_execute_query(text, text, text, text, text[]) FROM PUBLIC, anon, authenticated;

-- get_system_settings, update_system_setting, reset_system_setting:
-- 일반 사용자가 호출하지만 함수 내부에서 admin 체크를 한다.
-- 함수가 자체적으로 권한 검증을 하므로 EXECUTE 유지가 안전하지만,
-- 어드바이저 경고 해소를 위해 회수. admin route는 createSupabaseServer를
-- 사용하더라도 user-context client 권한이 필요하므로 회수 시 동작 영향
-- 가능성. **주의**: 회수하지 않고 advisor 경고로 남긴다.
