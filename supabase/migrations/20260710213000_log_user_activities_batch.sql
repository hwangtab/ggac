-- Phase 3 T4b (2026-07-10 전수감사): 활동 로그 배치 RPC
--
-- /api/activities/batch-log가 로그당 log_user_activity RPC를 순차 호출해
-- 최대 100 왕복이던 것을(전수감사 API Medium 9 — "배치" 목적 무력화)
-- 배열 1왕복으로 대체한다. 단건 RPC와 동일하게 본인 확인 가드를 두고,
-- daily_activity_stats는 action_type별로 집계해 한 번에 upsert한다.

CREATE OR REPLACE FUNCTION public.log_user_activities_batch(
  p_user_id uuid,
  p_logs jsonb,
  p_ip_address inet DEFAULT NULL::inet,
  p_user_agent text DEFAULT NULL::text
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  inserted_count integer := 0;
BEGIN
  IF auth.uid() IS NOT NULL AND auth.uid() <> p_user_id THEN
    RAISE EXCEPTION '본인의 활동 로그만 기록할 수 있습니다.';
  END IF;

  IF p_logs IS NULL OR jsonb_typeof(p_logs) <> 'array' THEN
    RETURN 0;
  END IF;

  WITH ins AS (
    INSERT INTO user_activities (
      user_id, action_type, target_type, target_id,
      metadata, ip_address, user_agent, session_id
    )
    SELECT
      p_user_id,
      (e->>'action_type')::activity_action_type,
      NULLIF(e->>'target_type', '')::activity_target_type,
      NULLIF(e->>'target_id', '')::uuid,
      COALESCE(e->'metadata', '{}'::jsonb),
      p_ip_address,
      p_user_agent,
      NULLIF(e->>'session_id', '')::uuid
    FROM jsonb_array_elements(p_logs) AS e
    RETURNING action_type
  ),
  stats AS (
    INSERT INTO daily_activity_stats (activity_date, user_id, action_type, count)
    SELECT CURRENT_DATE, p_user_id, ins.action_type, count(*)
    FROM ins
    GROUP BY ins.action_type
    ON CONFLICT (activity_date, user_id, action_type)
    DO UPDATE SET
      count = daily_activity_stats.count + EXCLUDED.count,
      last_updated = NOW()
  )
  SELECT count(*) INTO inserted_count FROM ins;

  RETURN inserted_count;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.log_user_activities_batch(uuid, jsonb, inet, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.log_user_activities_batch(uuid, jsonb, inet, text) TO authenticated, service_role;
