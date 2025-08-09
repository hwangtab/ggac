-- Fix Admin Member API 500 Errors - Complete Database Schema Update
-- This script adds ALL missing columns that are causing 500 Internal Server Errors in member management

-- Add missing columns to member_profiles table
DO $$ 
BEGIN
  -- Add approved_by column if it doesn't exist
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                 WHERE table_name = 'member_profiles' AND column_name = 'approved_by') THEN
    ALTER TABLE public.member_profiles ADD COLUMN approved_by UUID REFERENCES public.member_profiles(id);
    RAISE NOTICE 'Added approved_by column';
  ELSE
    RAISE NOTICE 'approved_by column already exists';
  END IF;

  -- Add approved_at column if it doesn't exist
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                 WHERE table_name = 'member_profiles' AND column_name = 'approved_at') THEN
    ALTER TABLE public.member_profiles ADD COLUMN approved_at TIMESTAMP WITH TIME ZONE;
    RAISE NOTICE 'Added approved_at column';
  ELSE
    RAISE NOTICE 'approved_at column already exists';
  END IF;

  -- Add rejected_by column if it doesn't exist
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                 WHERE table_name = 'member_profiles' AND column_name = 'rejected_by') THEN
    ALTER TABLE public.member_profiles ADD COLUMN rejected_by UUID REFERENCES public.member_profiles(id);
    RAISE NOTICE 'Added rejected_by column';
  ELSE
    RAISE NOTICE 'rejected_by column already exists';
  END IF;

  -- Add is_suspended column if it doesn't exist
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                 WHERE table_name = 'member_profiles' AND column_name = 'is_suspended') THEN
    ALTER TABLE public.member_profiles ADD COLUMN is_suspended BOOLEAN DEFAULT FALSE;
    RAISE NOTICE 'Added is_suspended column';
  ELSE
    RAISE NOTICE 'is_suspended column already exists';
  END IF;

  -- Add suspension_reason column if it doesn't exist
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                 WHERE table_name = 'member_profiles' AND column_name = 'suspension_reason') THEN
    ALTER TABLE public.member_profiles ADD COLUMN suspension_reason TEXT;
    RAISE NOTICE 'Added suspension_reason column';
  ELSE
    RAISE NOTICE 'suspension_reason column already exists';
  END IF;

  -- Add suspension_until column if it doesn't exist
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                 WHERE table_name = 'member_profiles' AND column_name = 'suspension_until') THEN
    ALTER TABLE public.member_profiles ADD COLUMN suspension_until TIMESTAMP WITH TIME ZONE;
    RAISE NOTICE 'Added suspension_until column';
  ELSE
    RAISE NOTICE 'suspension_until column already exists';
  END IF;

END $$;

-- Update existing records to have proper default values (prevent NULL issues)
UPDATE public.member_profiles 
SET 
  is_suspended = COALESCE(is_suspended, FALSE)
WHERE 
  is_suspended IS NULL;

-- Create performance indexes for new columns
CREATE INDEX IF NOT EXISTS idx_member_profiles_approved_by 
  ON public.member_profiles(approved_by);

CREATE INDEX IF NOT EXISTS idx_member_profiles_approved_at 
  ON public.member_profiles(approved_at DESC);

CREATE INDEX IF NOT EXISTS idx_member_profiles_rejected_by 
  ON public.member_profiles(rejected_by);

CREATE INDEX IF NOT EXISTS idx_member_profiles_suspension 
  ON public.member_profiles(is_suspended, suspension_until);

-- Display what was fixed
DO $$
BEGIN
  RAISE NOTICE '';
  RAISE NOTICE '✅ Admin Member API 500 Error Fix Applied Successfully!';
  RAISE NOTICE '';
  RAISE NOTICE 'Fixed columns that were causing SQL errors:';
  RAISE NOTICE '- approved_by (stores admin who approved member)';
  RAISE NOTICE '- approved_at (stores approval timestamp)';
  RAISE NOTICE '- rejected_by (stores admin who rejected member)';
  RAISE NOTICE '- is_suspended (for member suspension status)';
  RAISE NOTICE '- suspension_reason (for suspension details)';
  RAISE NOTICE '- suspension_until (for temporary suspensions)';
  RAISE NOTICE '';
  RAISE NOTICE 'Next steps:';
  RAISE NOTICE '1. Test admin member approval/rejection - should now work without 500 errors';
  RAISE NOTICE '2. Test member suspension functionality';
  RAISE NOTICE '3. Verify admin dashboard member management works correctly';
END $$;