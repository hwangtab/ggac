-- Fix Missing like_count Column in posts Table
-- This is the exact cause of the 500 error

-- Add like_count column to posts table
DO $$ 
BEGIN
  -- Add like_count column if it doesn't exist
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                 WHERE table_name = 'posts' AND column_name = 'like_count') THEN
    ALTER TABLE public.posts ADD COLUMN like_count INTEGER DEFAULT 0 
      CHECK (like_count >= 0);
    RAISE NOTICE 'Added like_count column to posts table';
  ELSE
    RAISE NOTICE 'like_count column already exists in posts table';
  END IF;
END $$;

-- Update existing posts to have like_count = 0
UPDATE public.posts 
SET like_count = 0 
WHERE like_count IS NULL;

-- Set up admin user (hwangtab@gmail.com)
DO $$
DECLARE
  admin_user_id UUID;
  admin_email TEXT := 'hwangtab@gmail.com';
BEGIN
  -- Find existing user by email
  SELECT id INTO admin_user_id
  FROM auth.users 
  WHERE email = admin_email
  LIMIT 1;

  -- If user exists, make them admin
  IF admin_user_id IS NOT NULL THEN
    UPDATE public.member_profiles 
    SET 
      is_admin = TRUE,
      is_active = TRUE,
      registration_status = 'approved'
    WHERE id = admin_user_id;
    
    RAISE NOTICE 'Admin user % has been set up with ID %', admin_email, admin_user_id;
  ELSE
    RAISE NOTICE 'User with email % not found. Please sign up first.', admin_email;
  END IF;
END $$;

-- Display success message
DO $$
BEGIN
  RAISE NOTICE '';
  RAISE NOTICE '🎉 Fixed the exact cause of 500 errors!';
  RAISE NOTICE '';
  RAISE NOTICE '✅ like_count column added to posts table';
  RAISE NOTICE '✅ hwangtab@gmail.com set as admin (if user exists)';
  RAISE NOTICE '';
  RAISE NOTICE 'Admin APIs should now work without 500 errors!';
END $$;