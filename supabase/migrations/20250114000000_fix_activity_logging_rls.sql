-- Fix Activity Logging RLS Policy Issue
-- Date: 2025-01-14
-- Problem: user_activities table has SELECT policy only, no INSERT policy
-- This causes log_user_activity function to fail with permission denied errors

-- Add INSERT policy for authenticated users to log their own activities
CREATE POLICY "Allow authenticated users to log activities" ON user_activities
  FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

-- Comment explaining why this is safe:
-- This policy allows authenticated users to insert activity logs only for themselves.
-- The log_user_activity function is SECURITY DEFINER, so it can bypass RLS,
-- but this explicit INSERT policy provides an additional layer of control
-- and makes the permission model clearer.

-- Verify the policy was created
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
    AND tablename = 'user_activities'
    AND policyname = 'Allow authenticated users to log activities'
  ) THEN
    RAISE NOTICE '✅ Activity logging INSERT policy created successfully';
  ELSE
    RAISE EXCEPTION '❌ Failed to create activity logging INSERT policy';
  END IF;
END $$;
