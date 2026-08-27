-- ⛔ 실행 금지 표시 — Supabase(PostgreSQL) 전용, 2026-08-26 Turso 컷오버로 사문화됐다.
--
-- 이 파일을 Supabase SQL Editor나 psql에 붙여넣지 마라. 운영 데이터의 권위는
-- 이제 Turso(SQLite)이고 앱은 Supabase를 어디에서도 읽지 않는다 — 실행하면
-- **버려진 사본만 바뀌고 화면은 그대로다.** 조용한 성공이 제일 나쁘다.
-- RLS·auth.uid()·DO $$ 같은 Postgres 전용 문법이라 Turso에 그대로 옮길 수도 없다.
-- 스키마 정본은 src/db/schema/ 이고, 변경은 drizzle-kit 마이그레이션으로 한다
-- (npm run db:generate → src/db/migrations/, 적용 절차는 scripts/turso/README.md).
--
-- Fix Admin API 500 Errors - Essential Database Schema Update
-- This script adds only the missing columns that are causing 500 Internal Server Errors

-- Add missing columns to member_profiles table
DO $$ 
BEGIN
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

  -- Add profile_completeness_score column if it doesn't exist
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                 WHERE table_name = 'member_profiles' AND column_name = 'profile_completeness_score') THEN
    ALTER TABLE public.member_profiles ADD COLUMN profile_completeness_score INTEGER DEFAULT 0 
      CHECK (profile_completeness_score >= 0 AND profile_completeness_score <= 100);
    RAISE NOTICE 'Added profile_completeness_score column';
  ELSE
    RAISE NOTICE 'profile_completeness_score column already exists';
  END IF;

  -- Add verification_status column if it doesn't exist
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                 WHERE table_name = 'member_profiles' AND column_name = 'verification_status') THEN
    ALTER TABLE public.member_profiles ADD COLUMN verification_status JSONB 
      DEFAULT '{"email": false, "phone": false, "identity": false}';
    RAISE NOTICE 'Added verification_status column';
  ELSE
    RAISE NOTICE 'verification_status column already exists';
  END IF;

  -- Add membership_type column if it doesn't exist
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                 WHERE table_name = 'member_profiles' AND column_name = 'membership_type') THEN
    ALTER TABLE public.member_profiles ADD COLUMN membership_type VARCHAR(50) DEFAULT 'regular' 
      CHECK (membership_type IN ('regular', 'premium', 'lifetime'));
    RAISE NOTICE 'Added membership_type column';
  ELSE
    RAISE NOTICE 'membership_type column already exists';
  END IF;

  -- Add engagement_score column if it doesn't exist
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                 WHERE table_name = 'member_profiles' AND column_name = 'engagement_score') THEN
    ALTER TABLE public.member_profiles ADD COLUMN engagement_score INTEGER DEFAULT 0 
      CHECK (engagement_score >= 0);
    RAISE NOTICE 'Added engagement_score column';
  ELSE
    RAISE NOTICE 'engagement_score column already exists';
  END IF;

  -- Add last_login_at column if it doesn't exist
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                 WHERE table_name = 'member_profiles' AND column_name = 'last_login_at') THEN
    ALTER TABLE public.member_profiles ADD COLUMN last_login_at TIMESTAMP WITH TIME ZONE;
    RAISE NOTICE 'Added last_login_at column';
  ELSE
    RAISE NOTICE 'last_login_at column already exists';
  END IF;

END $$;

-- Update existing records to have proper default values (prevent NULL issues)
UPDATE public.member_profiles 
SET 
  is_suspended = COALESCE(is_suspended, FALSE),
  profile_completeness_score = COALESCE(profile_completeness_score, 0),
  verification_status = COALESCE(verification_status, '{"email": false, "phone": false, "identity": false}'::jsonb),
  membership_type = COALESCE(membership_type, 'regular'),
  engagement_score = COALESCE(engagement_score, 0)
WHERE 
  is_suspended IS NULL 
  OR profile_completeness_score IS NULL 
  OR verification_status IS NULL 
  OR membership_type IS NULL 
  OR engagement_score IS NULL;

-- Create basic indexes for performance
CREATE INDEX IF NOT EXISTS idx_member_profiles_suspension 
  ON public.member_profiles(is_suspended, suspension_until);

CREATE INDEX IF NOT EXISTS idx_member_profiles_membership_type 
  ON public.member_profiles(membership_type);

CREATE INDEX IF NOT EXISTS idx_member_profiles_engagement 
  ON public.member_profiles(engagement_score DESC);

CREATE INDEX IF NOT EXISTS idx_member_profiles_last_login 
  ON public.member_profiles(last_login_at DESC);

-- Display what was fixed
DO $$
BEGIN
  RAISE NOTICE '';
  RAISE NOTICE '✅ Admin API 500 Error Fix Applied Successfully!';
  RAISE NOTICE '';
  RAISE NOTICE 'Fixed columns that were causing SQL errors:';
  RAISE NOTICE '- is_suspended (for member suspension status)';
  RAISE NOTICE '- suspension_reason (for suspension details)';
  RAISE NOTICE '- suspension_until (for temporary suspensions)';
  RAISE NOTICE '- profile_completeness_score (for completion tracking)';
  RAISE NOTICE '- verification_status (for verification tracking)';
  RAISE NOTICE '- membership_type (for membership categories)';
  RAISE NOTICE '- engagement_score (for activity tracking)';
  RAISE NOTICE '- last_login_at (for login tracking)';
  RAISE NOTICE '';
  RAISE NOTICE 'Next steps:';
  RAISE NOTICE '1. Test admin APIs again - they should now work without 500 errors';
  RAISE NOTICE '2. Admin dashboard should display real data';
  RAISE NOTICE '3. Member management functions should be operational';
END $$;