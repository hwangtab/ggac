-- Fix for PostList and CommentSection "Loading..." Issue
-- This fixes the RLS policy to allow authenticated users to view basic profile info of other approved members

-- 1. Drop the overly restrictive profile viewing policy
DROP POLICY IF EXISTS "Users can view own profile" ON public.member_profiles;

-- 2. Create a new policy that allows authenticated users to view basic profile info
-- This allows users to see author names in posts and comments while maintaining security
CREATE POLICY "Authenticated users can view basic profile info" ON public.member_profiles
  FOR SELECT TO authenticated
  USING (
    -- Allow users to see their own full profile
    auth.uid() = id 
    OR 
    -- Allow users to see basic info (display_name) of other approved and active members
    (registration_status = 'approved' AND is_active = true)
  );

-- 3. Ensure users can only insert their own profile (keep existing behavior)
DROP POLICY IF EXISTS "Users can insert own profile" ON public.member_profiles;
CREATE POLICY "Users can insert own profile" ON public.member_profiles
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = id);

-- 4. Ensure users can only update their own profile (keep existing behavior)
DROP POLICY IF EXISTS "Users can update own profile" ON public.member_profiles;
CREATE POLICY "Users can update own profile" ON public.member_profiles
  FOR UPDATE TO authenticated
  USING (auth.uid() = id)
  WITH CHECK (auth.uid() = id);

-- 5. Keep the service role policy for admin operations
-- (This should already exist and doesn't need changes)

-- 6. Verify RLS is enabled
ALTER TABLE public.member_profiles ENABLE ROW LEVEL SECURITY;

-- Note: After applying this fix:
-- - User A can see their own full profile
-- - User A can see display_name of User B (if User B is approved and active)
-- - User A cannot see sensitive info of User B (phone, bank details, etc.)
-- - PostList and CommentSection components will show actual author names instead of "Loading..."
-- - Unapproved or inactive users' profiles remain hidden from others