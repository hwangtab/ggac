-- Migration 2: Ensure missing RPCs exist (idempotent safety net)
-- =============================================================================
-- The functions get_user_activity_stats and get_real_time_activity_feed were
-- originally created in migration 20250719090020_create_activity_tracking_system.
-- However, if that migration was only partially applied (e.g. it failed mid-way
-- due to an enum or table creation error), these functions may be missing.
--
-- This migration uses CREATE OR REPLACE with the exact same body to guarantee
-- they exist. It is safe to run even if the originals are already present.
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- get_user_activity_stats: Activity statistics per user over a date range
-- Exact copy from 20250719090020 to ensure idempotent existence.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION get_user_activity_stats(
  p_user_id UUID DEFAULT NULL,
  p_start_date DATE DEFAULT CURRENT_DATE - INTERVAL '30 days',
  p_end_date DATE DEFAULT CURRENT_DATE
)
RETURNS TABLE(
  action_type activity_action_type,
  total_count BIGINT,
  unique_days BIGINT,
  avg_per_day NUMERIC,
  first_activity TIMESTAMP WITH TIME ZONE,
  last_activity TIMESTAMP WITH TIME ZONE
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    ua.action_type,
    COUNT(*) as total_count,
    COUNT(DISTINCT DATE(ua.created_at)) as unique_days,
    ROUND(COUNT(*)::NUMERIC / GREATEST(COUNT(DISTINCT DATE(ua.created_at)), 1), 2) as avg_per_day,
    MIN(ua.created_at) as first_activity,
    MAX(ua.created_at) as last_activity
  FROM user_activities ua
  WHERE (p_user_id IS NULL OR ua.user_id = p_user_id)
    AND DATE(ua.created_at) BETWEEN p_start_date AND p_end_date
  GROUP BY ua.action_type
  ORDER BY total_count DESC;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- -----------------------------------------------------------------------------
-- get_real_time_activity_feed: Recent activity feed with human-readable time
-- Exact copy from 20250719090020 to ensure idempotent existence.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION get_real_time_activity_feed(
  p_limit INTEGER DEFAULT 50,
  p_action_types activity_action_type[] DEFAULT NULL
)
RETURNS TABLE(
  id UUID,
  user_id UUID,
  user_name TEXT,
  action_type activity_action_type,
  target_type activity_target_type,
  target_id UUID,
  metadata JSONB,
  created_at TIMESTAMP WITH TIME ZONE,
  time_ago_text TEXT
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    ua.id,
    ua.user_id,
    mp.display_name as user_name,
    ua.action_type,
    ua.target_type,
    ua.target_id,
    ua.metadata,
    ua.created_at,
    CASE
      WHEN ua.created_at > NOW() - INTERVAL '1 minute' THEN '방금 전'
      WHEN ua.created_at > NOW() - INTERVAL '1 hour' THEN EXTRACT(EPOCH FROM (NOW() - ua.created_at))::INTEGER / 60 || '분 전'
      WHEN ua.created_at > NOW() - INTERVAL '1 day' THEN EXTRACT(EPOCH FROM (NOW() - ua.created_at))::INTEGER / 3600 || '시간 전'
      ELSE EXTRACT(EPOCH FROM (NOW() - ua.created_at))::INTEGER / 86400 || '일 전'
    END as time_ago_text
  FROM user_activities ua
  JOIN member_profiles mp ON ua.user_id = mp.id
  WHERE (p_action_types IS NULL OR ua.action_type = ANY(p_action_types))
    AND ua.created_at > NOW() - INTERVAL '24 hours'
  ORDER BY ua.created_at DESC
  LIMIT p_limit;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMIT;
