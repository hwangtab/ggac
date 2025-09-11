-- Migration: Create public_profiles view for safe data exposure
-- Date: 2025-07-11

-- 1. Create a view to expose public profile information safely.
-- This view includes only non-sensitive data that can be shared among members.
CREATE OR REPLACE VIEW public.public_profiles AS
SELECT
  id,
  display_name,
  email -- Assuming email can be public among members. If not, remove this line.
FROM
  public.member_profiles;

-- 2. Grant access to the new view for authenticated users.
-- This allows any logged-in user to see the public profiles of others.
GRANT SELECT ON public.public_profiles TO authenticated;

-- 3. Update RLS policies for the base 'member_profiles' table.
-- We need to ensure that while the public view is accessible, the original table remains secure.

-- Drop the overly restrictive select policy if it exists.
DROP POLICY IF EXISTS "Users can view own profile" ON public.member_profiles;

-- Re-create it to be explicit: users can ONLY select their own complete profile from the base table.
CREATE POLICY "Users can view their own full profile" ON public.member_profiles
  FOR SELECT TO authenticated
  USING (auth.uid() = id);

-- 4. Ensure RLS is enabled on the base table (it should be, but as a safeguard).
ALTER TABLE public.member_profiles ENABLE ROW LEVEL SECURITY;

-- 5. Add a policy to the view itself to ensure only active members can see public profiles.
-- This prevents non-members or users with pending approval from accessing the directory.
CREATE POLICY "Active members can view public profiles" ON public.public_profiles
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.member_profiles mp
      WHERE mp.id = auth.uid() AND mp.registration_status = 'approved' AND mp.is_active = true
    )
  );

COMMENT ON VIEW public.public_profiles IS 'A view of member profiles that exposes only public information for safe access by other members.';
COMMENT ON COLUMN public.public_profiles.display_name IS 'The publicly visible name of the user.';
