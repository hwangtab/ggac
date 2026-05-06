-- 20260506021907 보강: create_notification의 트리거 컨텍스트 가드 강화
--
-- 기존 가드는 pg_trigger_depth() > 0 이면 인증된 일반 사용자도 임의의
-- p_type / p_title / p_message 로 알림을 만들 수 있는 통로를 열어두었다.
-- 현재 SECURITY INVOKER 트리거 중 일반 사용자 컨텍스트에서 호출되는 것은
-- notify_new_comment 뿐이며, 발급 type은 'post_reply' 하나다.
-- (notify_new_post → 공지는 admin이 작성, notify_member_status_change →
--  admin의 멤버 상태 변경, notify_new_post 일반 글은 댓글만 발생)
--
-- 따라서 트리거 컨텍스트라도 비-admin 사용자는 화이트리스트 type만 발급
-- 가능하도록 제한한다. 새로운 트리거 type이 추가되면 화이트리스트 갱신 필요.
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
  v_is_trigger BOOLEAN := pg_trigger_depth() > 0;
  v_caller UUID := auth.uid();
  v_is_admin BOOLEAN := v_caller IS NOT NULL AND public.is_admin_user(v_caller);
BEGIN
  -- service_role(auth.uid()=NULL) 또는 admin은 무제한 허용
  IF v_caller IS NULL OR v_is_admin THEN
    NULL;
  ELSIF v_is_trigger THEN
    -- 트리거 컨텍스트의 일반 사용자: type 화이트리스트로 제한
    IF p_type NOT IN ('post_reply'::notification_type) THEN
      RAISE EXCEPTION '해당 알림 유형(%)은 트리거에서 발급할 수 없습니다.', p_type;
    END IF;
  ELSE
    -- 직접 RPC 호출하는 일반 사용자는 차단
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
