-- Add is_member column to member_profiles table
-- This migration adds the missing is_member column to track member status

-- Add the is_member column with default value false
ALTER TABLE public.member_profiles 
ADD COLUMN IF NOT EXISTS is_member BOOLEAN DEFAULT false;

-- Update existing records to set is_member = true for users with complete profile information
-- This assumes that users with phone_number and real_name are members
UPDATE public.member_profiles 
SET is_member = true 
WHERE phone_number IS NOT NULL AND real_name IS NOT NULL;

-- Create index on is_member column for better query performance
CREATE INDEX IF NOT EXISTS idx_member_profiles_is_member ON public.member_profiles(is_member);

-- Add comment to document the column purpose
COMMENT ON COLUMN public.member_profiles.is_member IS 'Indicates if the user is an active member of the cooperative';