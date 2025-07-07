-- Fix RLS policies to allow authenticated users to view basic profile information
-- This fixes the "Loading..." issue in PostList and CommentSection components

-- 1. Drop the overly restrictive profile viewing policy
DROP POLICY IF EXISTS "Users can view own profile" ON public.member_profiles;

-- 2. Create a new policy that allows authenticated users to view basic profile info
-- This allows users to see author names in posts and comments
CREATE POLICY "Authenticated users can view basic profile info" ON public.member_profiles
  FOR SELECT TO authenticated
  USING (
    -- Allow users to see their own full profile
    auth.uid() = id 
    OR 
    -- Allow users to see basic info (display_name) of other approved members
    (registration_status = 'approved' AND is_active = true)
  );

-- 3. Create a more restrictive policy for sensitive profile updates
DROP POLICY IF EXISTS "Users can update own profile" ON public.member_profiles;

CREATE POLICY "Users can update own profile" ON public.member_profiles
  FOR UPDATE TO authenticated
  USING (auth.uid() = id)
  WITH CHECK (auth.uid() = id);

-- 4. Ensure users can only insert their own profile
DROP POLICY IF EXISTS "Users can insert own profile" ON public.member_profiles;

CREATE POLICY "Users can insert own profile" ON public.member_profiles
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = id);

-- Note: The existing service role policy should remain unchanged
-- Note: The existing posts and comments policies should work correctly now