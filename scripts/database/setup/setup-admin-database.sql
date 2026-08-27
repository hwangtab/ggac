-- ⛔ 실행 금지 표시 — Supabase(PostgreSQL) 전용, 2026-08-26 Turso 컷오버로 사문화됐다.
--
-- 이 파일을 Supabase SQL Editor나 psql에 붙여넣지 마라. 운영 데이터의 권위는
-- 이제 Turso(SQLite)이고 앱은 Supabase를 어디에서도 읽지 않는다 — 실행하면
-- **버려진 사본만 바뀌고 화면은 그대로다.** 조용한 성공이 제일 나쁘다.
-- RLS·auth.uid()·DO $$ 같은 Postgres 전용 문법이라 Turso에 그대로 옮길 수도 없다.
-- 스키마 정본은 src/db/schema/ 이고, 변경은 drizzle-kit 마이그레이션으로 한다
-- (npm run db:generate → src/db/migrations/, 적용 절차는 scripts/turso/README.md).
--
-- Admin Database Setup Script
-- Run this in the Supabase SQL Editor to ensure all admin features work

-- 1. Ensure all required columns exist in member_profiles
DO $$ 
BEGIN
  -- Add is_suspended column if it doesn't exist
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                 WHERE table_name = 'member_profiles' AND column_name = 'is_suspended') THEN
    ALTER TABLE public.member_profiles ADD COLUMN is_suspended BOOLEAN DEFAULT FALSE;
  END IF;

  -- Add suspension_reason column if it doesn't exist
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                 WHERE table_name = 'member_profiles' AND column_name = 'suspension_reason') THEN
    ALTER TABLE public.member_profiles ADD COLUMN suspension_reason TEXT;
  END IF;

  -- Add suspension_until column if it doesn't exist
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                 WHERE table_name = 'member_profiles' AND column_name = 'suspension_until') THEN
    ALTER TABLE public.member_profiles ADD COLUMN suspension_until TIMESTAMP WITH TIME ZONE;
  END IF;

  -- Add profile_completeness_score column if it doesn't exist
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                 WHERE table_name = 'member_profiles' AND column_name = 'profile_completeness_score') THEN
    ALTER TABLE public.member_profiles ADD COLUMN profile_completeness_score INTEGER DEFAULT 0 
      CHECK (profile_completeness_score >= 0 AND profile_completeness_score <= 100);
  END IF;

  -- Add verification_status column if it doesn't exist
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                 WHERE table_name = 'member_profiles' AND column_name = 'verification_status') THEN
    ALTER TABLE public.member_profiles ADD COLUMN verification_status JSONB 
      DEFAULT '{"email": false, "phone": false, "identity": false}';
  END IF;

  -- Add membership_type column if it doesn't exist
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                 WHERE table_name = 'member_profiles' AND column_name = 'membership_type') THEN
    ALTER TABLE public.member_profiles ADD COLUMN membership_type VARCHAR(50) DEFAULT 'regular' 
      CHECK (membership_type IN ('regular', 'premium', 'lifetime'));
  END IF;

  -- Add engagement_score column if it doesn't exist
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                 WHERE table_name = 'member_profiles' AND column_name = 'engagement_score') THEN
    ALTER TABLE public.member_profiles ADD COLUMN engagement_score INTEGER DEFAULT 0 
      CHECK (engagement_score >= 0);
  END IF;

  -- Add approved_by column if it doesn't exist
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                 WHERE table_name = 'member_profiles' AND column_name = 'approved_by') THEN
    ALTER TABLE public.member_profiles ADD COLUMN approved_by UUID 
      REFERENCES public.member_profiles(id) ON DELETE SET NULL;
  END IF;

  -- Add rejected_by column if it doesn't exist
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                 WHERE table_name = 'member_profiles' AND column_name = 'rejected_by') THEN
    ALTER TABLE public.member_profiles ADD COLUMN rejected_by UUID 
      REFERENCES public.member_profiles(id) ON DELETE SET NULL;
  END IF;

  -- Add last_login_at column if it doesn't exist
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                 WHERE table_name = 'member_profiles' AND column_name = 'last_login_at') THEN
    ALTER TABLE public.member_profiles ADD COLUMN last_login_at TIMESTAMP WITH TIME ZONE;
  END IF;

  -- Add is_artist column if it doesn't exist
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                 WHERE table_name = 'member_profiles' AND column_name = 'is_artist') THEN
    ALTER TABLE public.member_profiles ADD COLUMN is_artist BOOLEAN DEFAULT FALSE;
  END IF;

  -- Add artist_id column if it doesn't exist
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                 WHERE table_name = 'member_profiles' AND column_name = 'artist_id') THEN
    ALTER TABLE public.member_profiles ADD COLUMN artist_id TEXT;
  END IF;

END $$;

-- 2. Create member_status_history table if it doesn't exist
CREATE TABLE IF NOT EXISTS public.member_status_history (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  member_id UUID REFERENCES public.member_profiles(id) ON DELETE CASCADE NOT NULL,
  changed_by UUID REFERENCES public.member_profiles(id) ON DELETE SET NULL,
  action VARCHAR(50) NOT NULL CHECK (action IN ('approve', 'reject', 'activate', 'deactivate', 'suspend', 'unsuspend', 'promote', 'demote', 'update')),
  previous_status JSONB,
  new_status JSONB,
  reason TEXT,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  ip_address INET,
  user_agent TEXT
);

-- 3. Create member_login_history table if it doesn't exist
CREATE TABLE IF NOT EXISTS public.member_login_history (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  member_id UUID REFERENCES public.member_profiles(id) ON DELETE CASCADE NOT NULL,
  login_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  ip_address INET,
  user_agent TEXT,
  success BOOLEAN DEFAULT TRUE,
  failure_reason TEXT
);

-- 4. Create member_bulk_operations table if it doesn't exist
CREATE TABLE IF NOT EXISTS public.member_bulk_operations (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  operation_type VARCHAR(50) NOT NULL CHECK (operation_type IN ('bulk_approve', 'bulk_reject', 'bulk_activate', 'bulk_deactivate', 'bulk_suspend', 'bulk_export')),
  performed_by UUID REFERENCES public.member_profiles(id) ON DELETE SET NULL NOT NULL,
  member_ids UUID[] NOT NULL,
  parameters JSONB DEFAULT '{}',
  results JSONB DEFAULT '{}',
  status VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending', 'in_progress', 'completed', 'failed', 'cancelled')),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  started_at TIMESTAMP WITH TIME ZONE,
  completed_at TIMESTAMP WITH TIME ZONE,
  error_message TEXT
);

-- 5. Enable Row Level Security for new tables
ALTER TABLE public.member_status_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.member_login_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.member_bulk_operations ENABLE ROW LEVEL SECURITY;

-- 6. Create RLS policies for member_status_history
DROP POLICY IF EXISTS "Admins can view all status history" ON public.member_status_history;
CREATE POLICY "Admins can view all status history" ON public.member_status_history 
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.member_profiles 
      WHERE member_profiles.id = auth.uid() 
      AND member_profiles.is_admin = true
      AND member_profiles.is_active = true
      AND member_profiles.registration_status = 'approved'
    )
  );

DROP POLICY IF EXISTS "System can insert status history" ON public.member_status_history;
CREATE POLICY "System can insert status history" ON public.member_status_history 
  FOR INSERT WITH CHECK (true);

-- 7. Create RLS policies for member_login_history
DROP POLICY IF EXISTS "Members can view own login history" ON public.member_login_history;
CREATE POLICY "Members can view own login history" ON public.member_login_history 
  FOR SELECT USING (member_id = auth.uid());

DROP POLICY IF EXISTS "Admins can view all login history" ON public.member_login_history;
CREATE POLICY "Admins can view all login history" ON public.member_login_history 
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.member_profiles 
      WHERE member_profiles.id = auth.uid() 
      AND member_profiles.is_admin = true
      AND member_profiles.is_active = true
      AND member_profiles.registration_status = 'approved'
    )
  );

DROP POLICY IF EXISTS "System can insert login history" ON public.member_login_history;
CREATE POLICY "System can insert login history" ON public.member_login_history 
  FOR INSERT WITH CHECK (true);

-- 8. Create RLS policies for member_bulk_operations
DROP POLICY IF EXISTS "Admins can manage bulk operations" ON public.member_bulk_operations;
CREATE POLICY "Admins can manage bulk operations" ON public.member_bulk_operations 
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM public.member_profiles 
      WHERE member_profiles.id = auth.uid() 
      AND member_profiles.is_admin = true
      AND member_profiles.is_active = true
      AND member_profiles.registration_status = 'approved'
    )
  );

-- 9. Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_member_status_history_member_id ON public.member_status_history(member_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_member_status_history_changed_by ON public.member_status_history(changed_by, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_member_status_history_action ON public.member_status_history(action, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_member_login_history_member_id ON public.member_login_history(member_id, login_at DESC);
CREATE INDEX IF NOT EXISTS idx_member_login_history_success ON public.member_login_history(success, login_at DESC);

CREATE INDEX IF NOT EXISTS idx_member_bulk_operations_performed_by ON public.member_bulk_operations(performed_by, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_member_bulk_operations_status ON public.member_bulk_operations(status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_member_profiles_last_login ON public.member_profiles(last_login_at DESC);
CREATE INDEX IF NOT EXISTS idx_member_profiles_suspension ON public.member_profiles(is_suspended, suspension_until);
CREATE INDEX IF NOT EXISTS idx_member_profiles_membership_type ON public.member_profiles(membership_type);
CREATE INDEX IF NOT EXISTS idx_member_profiles_engagement ON public.member_profiles(engagement_score DESC);

-- 10. Update existing records to have proper default values
UPDATE public.member_profiles 
SET 
  is_suspended = COALESCE(is_suspended, FALSE),
  profile_completeness_score = COALESCE(profile_completeness_score, 0),
  verification_status = COALESCE(verification_status, '{"email": false, "phone": false, "identity": false}'::jsonb),
  membership_type = COALESCE(membership_type, 'regular'),
  engagement_score = COALESCE(engagement_score, 0),
  is_artist = COALESCE(is_artist, FALSE)
WHERE 
  is_suspended IS NULL 
  OR profile_completeness_score IS NULL 
  OR verification_status IS NULL 
  OR membership_type IS NULL 
  OR engagement_score IS NULL
  OR is_artist IS NULL;

-- 11. Set up at least one admin user (you'll need to replace the email with an actual user)
-- This creates a test admin user - replace with your actual admin email
-- Note: This will only work if a user with this email already exists in auth.users

DO $$
DECLARE
  admin_user_id UUID;
  admin_email TEXT := 'admin@example.com'; -- REPLACE WITH ACTUAL ADMIN EMAIL
BEGIN
  -- Try to find existing user by email
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
    RAISE NOTICE 'User with email % not found. Please sign up first or update the email in this script.', admin_email;
  END IF;
END $$;

-- 12. Create function to calculate profile completeness (if not exists)
CREATE OR REPLACE FUNCTION public.calculate_profile_completeness(member_id UUID)
RETURNS INTEGER AS $$
DECLARE
    score INTEGER := 0;
    member_record RECORD;
BEGIN
    SELECT * INTO member_record FROM public.member_profiles WHERE id = member_id;
    
    IF member_record IS NULL THEN
        RETURN 0;
    END IF;
    
    -- Basic required fields (40 points)
    IF member_record.display_name IS NOT NULL AND LENGTH(member_record.display_name) > 0 THEN score := score + 10; END IF;
    IF member_record.email IS NOT NULL AND LENGTH(member_record.email) > 0 THEN score := score + 10; END IF;
    IF member_record.real_name IS NOT NULL AND LENGTH(member_record.real_name) > 0 THEN score := score + 10; END IF;
    IF member_record.registration_status = 'approved' THEN score := score + 10; END IF;
    
    -- Contact information (20 points)
    IF member_record.phone_number IS NOT NULL AND LENGTH(member_record.phone_number) > 0 THEN score := score + 10; END IF;
    IF member_record.birth_date IS NOT NULL THEN score := score + 10; END IF;
    
    -- Financial information (20 points)
    IF member_record.monthly_fee IS NOT NULL AND member_record.monthly_fee > 0 THEN score := score + 10; END IF;
    IF member_record.bank_name IS NOT NULL AND member_record.account_number IS NOT NULL THEN score := score + 10; END IF;
    
    -- Verification status (20 points)
    IF (member_record.verification_status->>'email')::boolean = true THEN score := score + 7; END IF;
    IF (member_record.verification_status->>'phone')::boolean = true THEN score := score + 7; END IF;
    IF (member_record.verification_status->>'identity')::boolean = true THEN score := score + 6; END IF;
    
    RETURN score;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 13. Create trigger function for automatic status change logging
CREATE OR REPLACE FUNCTION public.log_member_status_change()
RETURNS TRIGGER AS $$
BEGIN
  -- Only log if relevant fields have changed
  IF OLD.registration_status != NEW.registration_status OR 
     OLD.is_active != NEW.is_active OR 
     OLD.is_suspended != NEW.is_suspended OR
     OLD.is_admin != NEW.is_admin OR
     COALESCE(OLD.is_artist, false) != COALESCE(NEW.is_artist, false) THEN
    
    INSERT INTO public.member_status_history (
      member_id,
      changed_by,
      action,
      previous_status,
      new_status,
      reason,
      metadata
    ) VALUES (
      NEW.id,
      auth.uid(),
      CASE 
        WHEN OLD.registration_status = 'pending' AND NEW.registration_status = 'approved' THEN 'approve'
        WHEN OLD.registration_status = 'pending' AND NEW.registration_status = 'rejected' THEN 'reject'
        WHEN OLD.is_active = false AND NEW.is_active = true THEN 'activate'
        WHEN OLD.is_active = true AND NEW.is_active = false THEN 'deactivate'
        WHEN COALESCE(OLD.is_suspended, false) = false AND COALESCE(NEW.is_suspended, false) = true THEN 'suspend'
        WHEN COALESCE(OLD.is_suspended, false) = true AND COALESCE(NEW.is_suspended, false) = false THEN 'unsuspend'
        ELSE 'update'
      END,
      json_build_object(
        'registration_status', OLD.registration_status,
        'is_active', OLD.is_active,
        'is_suspended', COALESCE(OLD.is_suspended, false),
        'is_admin', OLD.is_admin,
        'is_artist', COALESCE(OLD.is_artist, false)
      ),
      json_build_object(
        'registration_status', NEW.registration_status,
        'is_active', NEW.is_active,
        'is_suspended', COALESCE(NEW.is_suspended, false),
        'is_admin', NEW.is_admin,
        'is_artist', COALESCE(NEW.is_artist, false)
      ),
      NEW.suspension_reason,
      json_build_object(
        'suspension_until', NEW.suspension_until,
        'updated_at', NOW()
      )
    );
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 14. Create trigger for automatic status change logging (drop and recreate to ensure it exists)
DROP TRIGGER IF EXISTS member_status_change_trigger ON public.member_profiles;
CREATE TRIGGER member_status_change_trigger
    AFTER UPDATE ON public.member_profiles
    FOR EACH ROW
    EXECUTE FUNCTION public.log_member_status_change();

-- Display summary of what was created
DO $$
DECLARE
  table_count INTEGER;
  admin_count INTEGER;
BEGIN
  -- Count admin tracking tables
  SELECT COUNT(*) INTO table_count
  FROM information_schema.tables 
  WHERE table_schema = 'public' 
  AND table_name IN ('member_status_history', 'member_login_history', 'member_bulk_operations');
  
  -- Count admin users
  SELECT COUNT(*) INTO admin_count
  FROM public.member_profiles 
  WHERE is_admin = true AND is_active = true AND registration_status = 'approved';
  
  RAISE NOTICE 'Setup completed!';
  RAISE NOTICE '- Admin tracking tables: %', table_count;
  RAISE NOTICE '- Active admin users: %', admin_count;
  RAISE NOTICE '';
  RAISE NOTICE 'Next steps:';
  RAISE NOTICE '1. Update the admin_email variable in this script with a real user email';
  RAISE NOTICE '2. Make sure that user has signed up through the normal signup flow';
  RAISE NOTICE '3. Re-run this script to grant admin privileges';
END $$;