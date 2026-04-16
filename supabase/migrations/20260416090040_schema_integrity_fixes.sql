-- Migration 4: Schema integrity fixes
-- =============================================================================
-- Issues addressed:
--
--   1. approved_by FK conflict (COMMENT-ONLY):
--      The init migration (20250106090010) creates approved_by referencing
--      auth.users(id). Then 20250118090020 does ADD COLUMN IF NOT EXISTS
--      approved_by referencing member_profiles(id) -- but because the column
--      already exists the ADD COLUMN is a no-op, so the FK target never changes.
--      Later, 20250721090030 and 20250721090040 again do ADD COLUMN IF NOT
--      EXISTS referencing auth.users(id) -- also no-ops. The actual FK target
--      is auth.users(id) (from init). This is correct because approved_by stores
--      an admin's user UUID which exists in auth.users. No DDL change needed;
--      we document this for future maintainers.
--
--   2. artists table missing is_active column:
--      The artists table was created in 20250106090020 without an is_active
--      column. Multiple functions reference artists.is_active but it never
--      existed. Migration 1 (20260416090010) already fixed
--      get_artist_photo_stats() by removing the WHERE clause. Here we add the
--      column itself so any future queries can filter by it, and default all
--      existing rows to true (all current artists are active).
--
--   3. Add comments documenting known FK status for approved_by, rejected_by.
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- Fix 1: Add missing is_active column to artists table
-- Default to true so all existing artists remain visible.
-- -----------------------------------------------------------------------------
ALTER TABLE artists ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT true;

CREATE INDEX IF NOT EXISTS idx_artists_is_active
  ON artists(is_active) WHERE is_active = true;

-- Update get_artist_photo_stats() to use the now-available is_active column.
-- This restores the original intent (only count active artists) now that the
-- column actually exists.
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
  FROM artists a
  WHERE a.is_active = true;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- -----------------------------------------------------------------------------
-- Fix 2: Document the approved_by FK situation
-- The column references auth.users(id) from the init migration. This is the
-- correct target. No DDL change needed.
-- -----------------------------------------------------------------------------
COMMENT ON COLUMN member_profiles.approved_by IS
  'UUID of the admin who approved the member. '
  'FK target: auth.users(id) (set in init migration 20250106090010). '
  'Note: migration 20250118090020 attempted to re-add this column referencing '
  'member_profiles(id) but ADD COLUMN IF NOT EXISTS was a no-op since the '
  'column already existed. The actual FK remains auth.users(id).';

-- Also document rejected_by which has a similar pattern
COMMENT ON COLUMN member_profiles.rejected_by IS
  'UUID of the admin who rejected the member. '
  'FK target: member_profiles(id) (added in migration 20250118090020). '
  'This was a new column so the FK was applied correctly.';

COMMIT;
