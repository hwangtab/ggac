-- Migration 1: Fix broken functions
-- =============================================================================
-- Issues fixed:
--   1. log_profile_photo_change() trigger uses enum value 'profile_update' but
--      the activity_action_type enum defines 'profile_updated'. This causes the
--      trigger to fail with an invalid enum value error every time a user changes
--      their profile photo.
--   2. get_artist_photo_stats() references "WHERE is_active = true" on the
--      artists table, but that table has no is_active column (it was never added).
--      This causes the function to error on every call.
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- Fix 1: log_profile_photo_change() - correct enum value
-- The column name was already fixed from 'action_details' to 'metadata' in
-- migration 20260415090010, but the enum value was left as 'profile_update'
-- instead of the correct 'profile_updated'.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION log_profile_photo_change()
RETURNS TRIGGER AS $$
BEGIN
  -- 프로필 사진이 추가된 경우
  IF OLD.profile_photo_url IS NULL AND NEW.profile_photo_url IS NOT NULL THEN
    INSERT INTO user_activities (user_id, action_type, metadata)
    VALUES (NEW.id, 'profile_updated',
      jsonb_build_object(
        'type', 'photo_added',
        'photo_url', NEW.profile_photo_url,
        'metadata', NEW.profile_photo_metadata
      )
    );
  -- 프로필 사진이 변경된 경우
  ELSIF OLD.profile_photo_url IS NOT NULL AND NEW.profile_photo_url IS NOT NULL
        AND OLD.profile_photo_url != NEW.profile_photo_url THEN
    INSERT INTO user_activities (user_id, action_type, metadata)
    VALUES (NEW.id, 'profile_updated',
      jsonb_build_object(
        'type', 'photo_changed',
        'old_photo_url', OLD.profile_photo_url,
        'new_photo_url', NEW.profile_photo_url,
        'metadata', NEW.profile_photo_metadata
      )
    );
  -- 프로필 사진이 삭제된 경우
  ELSIF OLD.profile_photo_url IS NOT NULL AND NEW.profile_photo_url IS NULL THEN
    INSERT INTO user_activities (user_id, action_type, metadata)
    VALUES (NEW.id, 'profile_updated',
      jsonb_build_object(
        'type', 'photo_removed',
        'old_photo_url', OLD.profile_photo_url
      )
    );
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- -----------------------------------------------------------------------------
-- Fix 2: get_artist_photo_stats() - remove reference to non-existent is_active
-- The artists table never had an is_active column. Remove the WHERE clause so
-- the function counts all artists (matching the table's actual schema).
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION get_artist_photo_stats()
RETURNS TABLE (
  total_artists BIGINT,
  artists_with_photo BIGINT,
  photo_percentage NUMERIC(5,2)
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    COUNT(*) as total_artists,
    COUNT(a.profile_photo_url) as artists_with_photo,
    ROUND(
      (COUNT(a.profile_photo_url) * 100.0 / NULLIF(COUNT(*), 0))::NUMERIC,
      2
    ) as photo_percentage
  FROM artists a;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMIT;
