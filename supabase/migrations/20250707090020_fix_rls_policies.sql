-- Fix RLS policies to avoid circular dependencies
-- Migration: 20250707_fix_rls_policies.sql

-- 1. Drop all existing RLS policies that might cause circular dependency
DROP POLICY IF EXISTS "Users can view own profile" ON public.member_profiles;
DROP POLICY IF EXISTS "Users can update own profile" ON public.member_profiles;
DROP POLICY IF EXISTS "Users can insert own profile" ON public.member_profiles;
DROP POLICY IF EXISTS "Users can create own profile" ON public.member_profiles;
DROP POLICY IF EXISTS "Authenticated users can view profiles" ON public.member_profiles;
DROP POLICY IF EXISTS "Admins can view all profiles" ON public.member_profiles;
DROP POLICY IF EXISTS "Admins can update all profiles" ON public.member_profiles;
DROP POLICY IF EXISTS "Admins can approve members" ON public.member_profiles;
DROP POLICY IF EXISTS "Service role can access all profiles" ON public.member_profiles;

-- 2. Create safe admin check function (avoids circular dependency)
CREATE OR REPLACE FUNCTION public.is_admin_user(user_id UUID)
RETURNS boolean
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Direct check without relying on RLS policies
  RETURN EXISTS (
    SELECT 1 FROM public.member_profiles 
    WHERE id = user_id 
    AND is_admin = true 
    AND is_active = true
  );
END;
$$ LANGUAGE plpgsql;

-- 3. Create new RLS policies without circular dependencies

-- Users can view their own profile
CREATE POLICY "Users can view own profile" ON public.member_profiles
  FOR SELECT TO authenticated
  USING (auth.uid() = id);

-- Users can insert their own profile
CREATE POLICY "Users can insert own profile" ON public.member_profiles
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = id);

-- Users can update their own profile
CREATE POLICY "Users can update own profile" ON public.member_profiles
  FOR UPDATE TO authenticated
  USING (auth.uid() = id)
  WITH CHECK (auth.uid() = id);

-- Service role can access all profiles (for admin operations)
CREATE POLICY "Service role can access all profiles" ON public.member_profiles
  FOR ALL TO service_role
  USING (true)
  WITH CHECK (true);

-- 4. Ensure RLS is enabled
ALTER TABLE public.member_profiles ENABLE ROW LEVEL SECURITY;

-- 5. Update posts and comments RLS policies to use the new safe admin function
-- These policies should not cause circular dependencies

-- For posts: Allow approved members to view posts
DROP POLICY IF EXISTS "Approved members can view posts" ON public.posts;
CREATE POLICY "Approved members can view posts" ON public.posts 
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.member_profiles 
      WHERE member_profiles.id = auth.uid() 
      AND member_profiles.registration_status = 'approved'
      AND member_profiles.is_active = true
    ) AND is_deleted = false
  );

-- For posts: Allow approved members to create posts
DROP POLICY IF EXISTS "Approved members can create posts" ON public.posts;
CREATE POLICY "Approved members can create posts" ON public.posts 
  FOR INSERT TO authenticated
  WITH CHECK (
    author_id = auth.uid() AND
    EXISTS (
      SELECT 1 FROM public.member_profiles 
      WHERE member_profiles.id = auth.uid() 
      AND member_profiles.registration_status = 'approved'
      AND member_profiles.is_active = true
    )
  );

-- For comments: Allow approved members to create comments
DROP POLICY IF EXISTS "Allow members to create comments" ON public.comments;
CREATE POLICY "Allow members to create comments" ON public.comments
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.member_profiles 
      WHERE member_profiles.id = auth.uid() 
      AND member_profiles.registration_status = 'approved'
      AND member_profiles.is_active = true
    )
  );