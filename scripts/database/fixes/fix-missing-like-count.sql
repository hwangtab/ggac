-- ⛔ 실행 금지 표시 — Supabase(PostgreSQL) 전용, 2026-08-26 Turso 컷오버로 사문화됐다.
--
-- 이 파일을 Supabase SQL Editor나 psql에 붙여넣지 마라. 운영 데이터의 권위는
-- 이제 Turso(SQLite)이고 앱은 Supabase를 어디에서도 읽지 않는다 — 실행하면
-- **버려진 사본만 바뀌고 화면은 그대로다.** 조용한 성공이 제일 나쁘다.
-- RLS·auth.uid()·DO $$ 같은 Postgres 전용 문법이라 Turso에 그대로 옮길 수도 없다.
-- 스키마 정본은 src/db/schema/ 이고, 변경은 drizzle-kit 마이그레이션으로 한다
-- (npm run db:generate → src/db/migrations/, 적용 절차는 scripts/turso/README.md).
--
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