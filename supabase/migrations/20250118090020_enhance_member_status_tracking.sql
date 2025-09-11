-- Enhanced Member Status Management Migration
-- Adds comprehensive status tracking and audit capabilities

-- Add new columns to member_profiles table
ALTER TABLE public.member_profiles 
ADD COLUMN IF NOT EXISTS last_login_at TIMESTAMP WITH TIME ZONE,
ADD COLUMN IF NOT EXISTS approved_by UUID REFERENCES public.member_profiles(id),
ADD COLUMN IF NOT EXISTS rejected_by UUID REFERENCES public.member_profiles(id),
ADD COLUMN IF NOT EXISTS suspension_reason TEXT,
ADD COLUMN IF NOT EXISTS suspension_until TIMESTAMP WITH TIME ZONE,
ADD COLUMN IF NOT EXISTS is_suspended BOOLEAN DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS profile_completeness_score INTEGER DEFAULT 0 CHECK (profile_completeness_score >= 0 AND profile_completeness_score <= 100),
ADD COLUMN IF NOT EXISTS verification_status JSONB DEFAULT '{"email": false, "phone": false, "identity": false}',
ADD COLUMN IF NOT EXISTS membership_type VARCHAR(50) DEFAULT 'regular' CHECK (membership_type IN ('regular', 'premium', 'lifetime')),
ADD COLUMN IF NOT EXISTS engagement_score INTEGER DEFAULT 0 CHECK (engagement_score >= 0),
ADD COLUMN IF NOT EXISTS is_member BOOLEAN DEFAULT TRUE;

-- Create member_status_history table for audit trail
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

-- Create member_login_history table for activity tracking
CREATE TABLE IF NOT EXISTS public.member_login_history (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  member_id UUID REFERENCES public.member_profiles(id) ON DELETE CASCADE NOT NULL,
  login_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  ip_address INET,
  user_agent TEXT,
  success BOOLEAN DEFAULT TRUE,
  failure_reason TEXT
);

-- Create member_bulk_operations table for tracking bulk actions
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

-- Enable Row Level Security for new tables
ALTER TABLE public.member_status_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.member_login_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.member_bulk_operations ENABLE ROW LEVEL SECURITY;

-- RLS policies for member_status_history
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

CREATE POLICY "System can insert status history" ON public.member_status_history 
  FOR INSERT WITH CHECK (true);

-- RLS policies for member_login_history
CREATE POLICY "Members can view own login history" ON public.member_login_history 
  FOR SELECT USING (member_id = auth.uid());

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

CREATE POLICY "System can insert login history" ON public.member_login_history 
  FOR INSERT WITH CHECK (true);

-- RLS policies for member_bulk_operations
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

-- Create indexes for performance
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

-- Create function to automatically log status changes
CREATE OR REPLACE FUNCTION public.log_member_status_change()
RETURNS TRIGGER AS $$
BEGIN
  -- Only log if relevant fields have changed
  IF OLD.registration_status != NEW.registration_status OR 
     OLD.is_active != NEW.is_active OR 
     OLD.is_suspended != NEW.is_suspended OR
     OLD.is_admin != NEW.is_admin OR
     OLD.is_artist != NEW.is_artist THEN
    
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
        WHEN OLD.is_suspended = false AND NEW.is_suspended = true THEN 'suspend'
        WHEN OLD.is_suspended = true AND NEW.is_suspended = false THEN 'unsuspend'
        ELSE 'update'
      END,
      json_build_object(
        'registration_status', OLD.registration_status,
        'is_active', OLD.is_active,
        'is_suspended', OLD.is_suspended,
        'is_admin', OLD.is_admin,
        'is_artist', OLD.is_artist
      ),
      json_build_object(
        'registration_status', NEW.registration_status,
        'is_active', NEW.is_active,
        'is_suspended', NEW.is_suspended,
        'is_admin', NEW.is_admin,
        'is_artist', NEW.is_artist
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

-- Create trigger for automatic status change logging
DROP TRIGGER IF EXISTS member_status_change_trigger ON public.member_profiles;
CREATE TRIGGER member_status_change_trigger
    AFTER UPDATE ON public.member_profiles
    FOR EACH ROW
    EXECUTE FUNCTION public.log_member_status_change();

-- Create function to calculate profile completeness
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

-- Create function to update profile completeness automatically
CREATE OR REPLACE FUNCTION public.update_profile_completeness()
RETURNS TRIGGER AS $$
BEGIN
    NEW.profile_completeness_score := public.calculate_profile_completeness(NEW.id);
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Create trigger for automatic profile completeness calculation
DROP TRIGGER IF EXISTS profile_completeness_trigger ON public.member_profiles;
CREATE TRIGGER profile_completeness_trigger
    BEFORE UPDATE ON public.member_profiles
    FOR EACH ROW
    EXECUTE FUNCTION public.update_profile_completeness();

-- Update existing records to have initial completeness scores
UPDATE public.member_profiles 
SET profile_completeness_score = public.calculate_profile_completeness(id)
WHERE profile_completeness_score = 0;

-- Add comments for documentation
COMMENT ON COLUMN public.member_profiles.last_login_at IS 'Timestamp of last successful login';
COMMENT ON COLUMN public.member_profiles.approved_by IS 'ID of admin who approved the member';
COMMENT ON COLUMN public.member_profiles.rejected_by IS 'ID of admin who rejected the member';
COMMENT ON COLUMN public.member_profiles.suspension_reason IS 'Reason for suspension if suspended';
COMMENT ON COLUMN public.member_profiles.suspension_until IS 'Suspension end date for temporary suspensions';
COMMENT ON COLUMN public.member_profiles.is_suspended IS 'Whether member is currently suspended';
COMMENT ON COLUMN public.member_profiles.profile_completeness_score IS 'Score from 0-100 indicating profile completeness';
COMMENT ON COLUMN public.member_profiles.verification_status IS 'JSON object tracking verification status of email, phone, identity';
COMMENT ON COLUMN public.member_profiles.membership_type IS 'Type of membership (regular, premium, lifetime)';
COMMENT ON COLUMN public.member_profiles.engagement_score IS 'Score indicating member engagement level';

COMMENT ON TABLE public.member_status_history IS 'Audit log of all member status changes';
COMMENT ON TABLE public.member_login_history IS 'Log of member login attempts and activities';
COMMENT ON TABLE public.member_bulk_operations IS 'Log of bulk operations performed on members';
