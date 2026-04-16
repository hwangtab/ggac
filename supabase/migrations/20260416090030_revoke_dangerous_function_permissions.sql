-- Migration 3: Revoke dangerous function permissions
-- =============================================================================
-- Several functions created in 20250719090030 and 20250719090040 accept
-- arbitrary SQL text, build queries via string concatenation, and execute them
-- with SECURITY DEFINER (running as the function owner / superuser). They were
-- granted EXECUTE to the "authenticated" role, meaning any logged-in user can
-- run arbitrary SQL against the database.
--
-- Affected functions:
--   - execute_advanced_search(TEXT, JSONB)        (from 090030 & 090040)
--   - execute_advanced_search_json(TEXT, TEXT[])   (from 090030)
--   - safe_execute_query(TEXT, TEXT, TEXT, TEXT, TEXT[])  (from 090030)
--   - search_posts_advanced(...)                  (from 090040, dynamic SQL)
--   - count_posts_advanced(...)                   (from 090040, dynamic SQL)
--   - cleanup_error_logs()                        (from 090030, SECURITY DEFINER)
--
-- This migration:
--   1. Revokes EXECUTE from PUBLIC and authenticated for all dangerous functions.
--   2. The functions remain in the database for admin/service-role use, but
--      ordinary authenticated users can no longer invoke them via PostgREST.
-- =============================================================================

BEGIN;

-- -------------------------------------------------------------------------
-- execute_advanced_search: two overloaded signatures exist
-- Signature from 090030: (TEXT, JSONB) RETURNS JSONB
-- Signature from 090040: (TEXT, JSONB) RETURNS TABLE(result JSONB)
-- Both are dangerous; revoke from both PUBLIC and authenticated.
-- -------------------------------------------------------------------------

-- Revoke the (TEXT, JSONB) -> JSONB variant (from 090030)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = 'execute_advanced_search'
  ) THEN
    REVOKE ALL ON FUNCTION execute_advanced_search(TEXT, JSONB) FROM PUBLIC;
    REVOKE ALL ON FUNCTION execute_advanced_search(TEXT, JSONB) FROM authenticated;
  END IF;
EXCEPTION WHEN undefined_function THEN
  NULL; -- function does not exist, skip
END
$$;

-- -------------------------------------------------------------------------
-- execute_advanced_search_json: (TEXT, TEXT[]) RETURNS JSONB
-- -------------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = 'execute_advanced_search_json'
  ) THEN
    REVOKE ALL ON FUNCTION execute_advanced_search_json(TEXT, TEXT[]) FROM PUBLIC;
    REVOKE ALL ON FUNCTION execute_advanced_search_json(TEXT, TEXT[]) FROM authenticated;
  END IF;
EXCEPTION WHEN undefined_function THEN
  NULL;
END
$$;

-- -------------------------------------------------------------------------
-- safe_execute_query: (TEXT, TEXT, TEXT, TEXT, TEXT[]) RETURNS TABLE
-- -------------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = 'safe_execute_query'
  ) THEN
    REVOKE ALL ON FUNCTION safe_execute_query(TEXT, TEXT, TEXT, TEXT, TEXT[]) FROM PUBLIC;
    REVOKE ALL ON FUNCTION safe_execute_query(TEXT, TEXT, TEXT, TEXT, TEXT[]) FROM authenticated;
  END IF;
EXCEPTION WHEN undefined_function THEN
  NULL;
END
$$;

-- -------------------------------------------------------------------------
-- search_posts_advanced: builds dynamic SQL from user inputs
-- -------------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = 'search_posts_advanced'
  ) THEN
    REVOKE ALL ON FUNCTION search_posts_advanced(JSONB, TEXT, TEXT[], TEXT, TEXT, INTEGER, INTEGER) FROM PUBLIC;
    REVOKE ALL ON FUNCTION search_posts_advanced(JSONB, TEXT, TEXT[], TEXT, TEXT, INTEGER, INTEGER) FROM authenticated;
  END IF;
EXCEPTION WHEN undefined_function THEN
  NULL;
END
$$;

-- -------------------------------------------------------------------------
-- count_posts_advanced: builds dynamic SQL from user inputs
-- -------------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = 'count_posts_advanced'
  ) THEN
    REVOKE ALL ON FUNCTION count_posts_advanced(JSONB, TEXT, TEXT[]) FROM PUBLIC;
    REVOKE ALL ON FUNCTION count_posts_advanced(JSONB, TEXT, TEXT[]) FROM authenticated;
  END IF;
EXCEPTION WHEN undefined_function THEN
  NULL;
END
$$;

-- -------------------------------------------------------------------------
-- cleanup_error_logs: SECURITY DEFINER, no need for authenticated access
-- -------------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = 'cleanup_error_logs'
  ) THEN
    REVOKE ALL ON FUNCTION cleanup_error_logs() FROM PUBLIC;
    REVOKE ALL ON FUNCTION cleanup_error_logs() FROM authenticated;
  END IF;
EXCEPTION WHEN undefined_function THEN
  NULL;
END
$$;

-- -------------------------------------------------------------------------
-- cleanup_old_activity_data: SECURITY DEFINER, deletes data, should be
-- admin/cron only
-- -------------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = 'cleanup_old_activity_data'
  ) THEN
    REVOKE ALL ON FUNCTION cleanup_old_activity_data() FROM PUBLIC;
    REVOKE ALL ON FUNCTION cleanup_old_activity_data() FROM authenticated;
  END IF;
EXCEPTION WHEN undefined_function THEN
  NULL;
END
$$;

COMMIT;
